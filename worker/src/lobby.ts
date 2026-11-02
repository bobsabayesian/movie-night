import { DurableObject } from 'cloudflare:workers';
import config from '../../shared/config.json';
import type {
  ClientMessage,
  Difficulty,
  GameState,
  Player,
  RoundOutcome,
  ServerMessage,
} from '../../shared/types';
import type { Env } from './env';
import { clarifyScene, generateScript } from './gemini';
import { type RoundRecord, putRound, roundKey } from './ledger';
import { anonymizeSpeakers, cleanRoles, clampParts, pickColor, validateName } from './validate';

interface Stored {
  state: GameState;
  /** token -> player id; never sent to clients */
  tokens: Record<string, string>;
  /** "Character N" label -> real character name; hidden from players, kept for the ledger */
  characterNames?: Record<string, string>;
  /** The round in progress; rewritten to R2 once when it resolves. */
  record?: RoundRecord;
  recordKey?: string;
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
  disabledStyles: [],
  disabledGenres: [],
  roundNo: 0,
});

const COLORS = config.colors.map((c) => c.hex);

export class LobbyDO extends DurableObject<Env> {
  private data: Stored = { state: freshState(''), tokens: {} };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get<Stored>('data')) ?? this.data;
      this.normalize();
      // A generation that was in flight when the isolate died will never finish.
      if (this.data.state.status === 'generating') {
        this.fail(new Error('interrupted'));
        await ctx.storage.put('data', this.data);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/info') {
      const taken = this.data.state.players.map((p) => p.color);
      return Response.json({ taken, ended: this.data.state.ended });
    }
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
    if (att?.playerId) await this.commit(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ---- message handling ----

  private async handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    const s = this.data.state;
    if (msg.type === 'join') return this.join(ws, msg.name, msg.color, msg.token);

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
      case 'setEnabled': {
        need(isAdmin);
        const all: string[] = msg.kind === 'style' ? config.styles : config.genres;
        if (!all.includes(msg.value)) throw new Error('Unknown option');
        const key = msg.kind === 'style' ? 'disabledStyles' : 'disabledGenres';
        const next = s[key].filter((v) => v !== msg.value);
        if (!msg.enabled) next.push(msg.value);
        if (next.length >= all.length) throw new Error('Keep at least one enabled');
        s[key] = next;
        break;
      }
      case 'submitPrompt':
        need(isPrompter && s.status === 'lobby' && !s.candidates);
        await this.submitPrompt(msg);
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
        if (speakers.some((sp) => !roles[sp])) throw new Error('Assign every character first');
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
        const points = s.promptData!.difficulty === 'hard' ? 2 : 1;
        winner.score += points;
        this.closeRound('won', winner.name, points);
        s.prompterId = winner.id; // winner chooses the next scene
        this.resetRound();
        break;
      }
      case 'skipRound':
        need(isPrompter && s.status === 'scoring' && !!this.player(msg.nextPrompterId));
        this.closeRound('nobody');
        s.prompterId = msg.nextPrompterId; // no points; the prompter hands over
        this.resetRound();
        break;
    }
    await this.commit();
  }

  private async join(ws: WebSocket, name: string, color: string | undefined, token?: string): Promise<void> {
    const s = this.data.state;
    const att = ws.deserializeAttachment() as Attachment;
    if (s.ended) return this.send(ws, { type: 'error', message: 'Session ended', fatal: true });

    const existingId = token ? this.data.tokens[token] : undefined;
    let player = existingId ? this.player(existingId) : undefined;
    if (player && player.isAdmin !== att.admin) player = undefined;

    // Lost the token (closed tab, cleared storage)? Reclaim an offline seat by name.
    let outToken = token ?? '';
    if (!player) {
      const want = String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
      const seat = s.players.find(
        (p) => p.name.toLowerCase() === want && p.isAdmin === att.admin && this.socketsFor(p.id).length === 0,
      );
      if (seat) {
        player = seat;
        outToken = crypto.randomUUID();
        this.data.tokens[outToken] = seat.id;
      }
    }

    if (!player) {
      const clean = validateName(
        name,
        s.players.map((p) => p.name),
      );
      if (!clean) {
        return this.send(ws, { type: 'error', message: 'Name is empty, too long, or taken' });
      }
      const taken = s.players.map((p) => p.color);
      if (taken.length >= COLORS.length) return this.send(ws, { type: 'error', message: 'The lobby is full' });
      const chosen = pickColor(color, COLORS, taken);
      if (!chosen) return this.send(ws, { type: 'error', message: 'Pick a color that is still free' });
      player = { id: crypto.randomUUID(), name: clean, score: 0, connected: true, isAdmin: att.admin, color: chosen };
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

  private async submitPrompt(msg: Extract<ClientMessage, { type: 'submitPrompt' }>): Promise<void> {
    const s = this.data.state;
    const scene = String(msg.scene ?? '').trim().slice(0, 200);
    const style = String(msg.style ?? '').trim().slice(0, 100);
    if (!scene || !style) throw new Error('Scene and style are required');
    const genre = config.genres.find((g) => g === msg.genre && !s.disabledGenres.includes(g));
    if (!genre) throw new Error('That genre is not available');
    const parts = clampParts(msg.parts, config.parts.min, config.parts.max, config.parts.default);
    const difficulty: Difficulty = msg.difficulty === 'hard' ? 'hard' : 'easy';
    s.promptData = { scene, style, difficulty, genre, parts };
    s.status = 'generating';
    s.error = null;
    await this.commit();
    try {
      const c = await clarifyScene(this.env, scene, style, genre);
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
      const script = await generateScript(this.env, s.promptData!);
      const { labelled, names } = anonymizeSpeakers(script);
      s.current_script = labelled;
      this.data.characterNames = names;
      s.roles = {};
      s.rolesAssigned = false;
      s.status = 'acting';
      this.openRound(names);
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

  /** Log the scene the moment it exists, so even unfinished rounds are on record. */
  private openRound(names: Record<string, string>): void {
    const s = this.data.state;
    const p = s.promptData!;
    s.roundNo += 1;
    const now = new Date();
    this.data.recordKey = roundKey(s.session_id, s.roundNo, now);
    this.data.record = {
      round: s.roundNo,
      session_id: s.session_id,
      started_at: now.toISOString(),
      chooser: this.player(s.prompterId ?? '')?.name ?? '',
      genre: p.genre,
      scene: p.scene,
      style: p.style,
      difficulty: p.difficulty,
      parts: p.parts,
      chosen: p.chosen,
      script_transcript: s.current_script,
      character_names: names,
      outcome: 'pending',
      winner: null,
      points: 0,
    };
    this.writeRound();
  }

  private closeRound(outcome: RoundOutcome, winner: string | null = null, points = 0): void {
    const rec = this.data.record;
    if (!rec) return;
    rec.outcome = outcome;
    rec.winner = winner;
    rec.points = points;
    this.writeRound();
    this.data.record = undefined;
    this.data.recordKey = undefined;
  }

  private writeRound(): void {
    const { record, recordKey } = this.data;
    if (!record || !recordKey) return;
    this.ctx.waitUntil(putRound(this.env, recordKey, record).catch((e) => console.error('round log failed', e)));
  }

  /** Fill in fields added after a lobby was created, so old stored state keeps working. */
  private normalize(): void {
    const s = this.data.state;
    s.disabledStyles ??= [];
    s.disabledGenres ??= [];
    s.roundNo ??= 0;
    for (const p of s.players) {
      if (!p.color) p.color = COLORS.find((c) => !s.players.some((o) => o.color === c)) ?? COLORS[0];
    }
  }

  private resetRound(): void {
    const s = this.data.state;
    this.closeRound('abandoned'); // no-op when the round was already resolved
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

  private async commit(closing?: WebSocket): Promise<void> {
    // Presence is derived from live sockets, so it can never go stale.
    for (const p of this.data.state.players) {
      p.connected = this.socketsFor(p.id).some((w) => w !== closing);
    }
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
