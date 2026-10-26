import { DurableObject } from 'cloudflare:workers';
import type { ClientMessage, GameState, Player, ServerMessage } from '../../shared/types';
import type { Env } from './env';
import { clarifyScene, generateScript } from './gemini';
import { writeLedger } from './ledger';
import { anonymizeSpeakers, cleanRoles, validateName } from './validate';

interface Stored {
  state: GameState;
  /** token -> player id; never sent to clients */
  tokens: Record<string, string>;
  /** "Character N" label -> real character name; hidden from players, kept for the ledger */
  characterNames?: Record<string, string>;
}

interface Attachment {
  admin: boolean;
  playerId: string | null;
}

const freshState = (sessionId: string): GameState => ({
  session_id: sessionId,
  status: 'lobby',
  players: [],
  prompterId: null,
  candidates: null,
  promptData: null,
  current_script: [],
  roles: {},
  rolesAssigned: false,
  error: null,
  ended: false,
});

export class LobbyDO extends DurableObject<Env> {
  private data: Stored = { state: freshState(''), tokens: {} };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get<Stored>('data')) ?? this.data;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }
    if (!this.data.state.session_id) {
      this.data.state.session_id = request.headers.get('x-lobby-id') ?? crypto.randomUUID();
      await this.save();
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const att: Attachment = { admin: request.headers.get('x-admin') === '1', playerId: null };
    server.serializeAttachment(att);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { type: 'error', message: 'Bad message' });
    }
    try {
      await this.handle(ws, msg);
    } catch (e) {
      this.send(ws, { type: 'error', message: e instanceof Error ? e.message : 'Server error' });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.playerId) {
      // Only mark offline if the player has no other live socket.
      const others = this.socketsFor(att.playerId).filter((s) => s !== ws);
      const p = this.player(att.playerId);
      if (p && others.length === 0) {
        p.connected = false;
        await this.commit();
      }
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ---- message handling ----

  private async handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    const s = this.data.state;
    if (msg.type === 'join') return this.join(ws, msg.name, msg.token);

    const att = ws.deserializeAttachment() as Attachment | null;
    const me = att?.playerId ? this.player(att.playerId) : undefined;
    if (!me) return this.send(ws, { type: 'error', message: 'Join first' });
    if (s.ended) return;

    const isAdmin = me.isAdmin;
    const isPrompter = s.prompterId === me.id;
    const need = (ok: boolean) => {
      if (!ok) throw new Error('Not allowed');
    };

    switch (msg.type) {
      case 'start':
        need(isAdmin && s.prompterId === null && !!this.player(msg.prompterId));
        s.prompterId = msg.prompterId;
        break;
      case 'setPrompter':
        need(isAdmin && !!this.player(msg.playerId));
        s.prompterId = msg.playerId;
        this.resetRound();
        break;
      case 'kick': {
        need(isAdmin && msg.playerId !== me.id && !!this.player(msg.playerId));
        for (const sock of this.socketsFor(msg.playerId)) {
          this.send(sock, { type: 'kicked' });
          sock.close(1000, 'kicked');
        }
        s.players = s.players.filter((p) => p.id !== msg.playerId);
        for (const [t, id] of Object.entries(this.data.tokens)) {
          if (id === msg.playerId) delete this.data.tokens[t];
        }
        for (const [sp, id] of Object.entries(s.roles)) if (id === msg.playerId) delete s.roles[sp];
        if (s.prompterId === msg.playerId) {
          s.prompterId = null;
          this.resetRound();
        }
        break;
      }
      case 'terminate':
        need(isAdmin);
        s.ended = true;
        await this.commit();
        for (const sock of this.ctx.getWebSockets()) sock.close(1000, 'terminated');
        return;
      case 'submitPrompt':
        need(isPrompter && s.status === 'lobby' && !s.candidates);
        await this.submitPrompt(msg.scene, msg.style);
        return;
      case 'pickCandidate':
        need(isPrompter && s.status === 'lobby' && !!s.candidates && !!s.promptData);
        if (!s.candidates![msg.index]) throw new Error('Invalid choice');
        s.promptData!.chosen = s.candidates![msg.index];
        s.candidates = null;
        await this.generate();
        return;
      case 'assignRoles': {
        need(isPrompter && s.status === 'acting');
        const speakers = [...new Set(s.current_script.map((l) => l.speaker))];
        const roles = cleanRoles(
          msg.roles,
          speakers,
          s.players.map((p) => p.id),
        );
        if (!roles) throw new Error('Invalid roles');
        s.roles = roles;
        s.rolesAssigned = true;
        break;
      }
      case 'finishActing':
        need(isPrompter && s.status === 'acting');
        s.status = 'scoring';
        break;
      case 'awardPoint': {
        need(isPrompter && s.status === 'scoring' && !!this.player(msg.playerId));
        const winner = this.player(msg.playerId)!;
        winner.score += 1;
        this.ctx.waitUntil(
          writeLedger(this.env, s.session_id, {
            prompt_data: s.promptData!,
            script_transcript: s.current_script,
            character_names: this.data.characterNames,
            winner: winner.name,
          }).catch((e) => console.error('ledger write failed', e)),
        );
        s.prompterId = winner.id; // winner chooses the next scene
        this.resetRound();
        break;
      }
    }
    await this.commit();
  }

  private async join(ws: WebSocket, name: string, token?: string): Promise<void> {
    const s = this.data.state;
    const att = ws.deserializeAttachment() as Attachment;
    if (s.ended) return this.send(ws, { type: 'error', message: 'Session ended', fatal: true });

    const existingId = token ? this.data.tokens[token] : undefined;
    let player = existingId ? this.player(existingId) : undefined;
    if (player && player.isAdmin !== att.admin) player = undefined;

    let outToken = token ?? '';
    if (!player) {
      const clean = validateName(
        name,
        s.players.map((p) => p.name),
      );
      if (!clean) {
        return this.send(ws, { type: 'error', message: 'Name is empty, too long, or taken' });
      }
      player = { id: crypto.randomUUID(), name: clean, score: 0, connected: true, isAdmin: att.admin };
      outToken = crypto.randomUUID();
      s.players.push(player);
      this.data.tokens[outToken] = player.id;
    }
    player.connected = true;
    att.playerId = player.id;
    ws.serializeAttachment(att);
    this.send(ws, { type: 'joined', playerId: player.id, token: outToken });
    await this.commit();
  }

  private async submitPrompt(scene: string, style: string): Promise<void> {
    const s = this.data.state;
    scene = String(scene ?? '').trim().slice(0, 200);
    style = String(style ?? '').trim().slice(0, 100);
    if (!scene || !style) throw new Error('Scene and style are required');
    s.promptData = { scene, style };
    s.status = 'generating';
    s.error = null;
    await this.commit();
    try {
      const c = await clarifyScene(this.env, scene, style);
      if (c.status === 'ambiguous' && c.candidates.length > 1) {
        s.candidates = c.candidates;
        s.status = 'lobby';
        await this.commit();
        return;
      }
      s.promptData.chosen = c.candidates[0];
      await this.generate();
    } catch (e) {
      this.fail(e);
      await this.commit();
    }
  }

  private async generate(): Promise<void> {
    const s = this.data.state;
    s.status = 'generating';
    await this.commit();
    try {
      const { scene, style, chosen } = s.promptData!;
      const script = await generateScript(this.env, scene, style, chosen);
      const { labelled, names } = anonymizeSpeakers(script);
      s.current_script = labelled;
      this.data.characterNames = names;
      s.roles = {};
      s.rolesAssigned = false;
      s.status = 'acting';
    } catch (e) {
      this.fail(e);
    }
    await this.commit();
  }

  private fail(e: unknown): void {
    const s = this.data.state;
    console.error('generation failed', e);
    s.status = 'lobby';
    s.candidates = null;
    s.error = 'The scene could not be generated. Try again.';
  }

  private resetRound(): void {
    const s = this.data.state;
    s.status = 'lobby';
    s.candidates = null;
    s.promptData = null;
    s.current_script = [];
    s.roles = {};
    s.rolesAssigned = false;
    s.error = null;
  }

  // ---- helpers ----

  private player(id: string): Player | undefined {
    return this.data.state.players.find((p) => p.id === id);
  }

  private socketsFor(playerId: string): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((w) => (w.deserializeAttachment() as Attachment | null)?.playerId === playerId);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closed */
    }
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put('data', this.data);
  }

  private async commit(): Promise<void> {
    await this.save();
    const out = JSON.stringify({ type: 'state', state: this.data.state } satisfies ServerMessage);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(out);
      } catch {
        /* ignore */
      }
    }
  }
}
