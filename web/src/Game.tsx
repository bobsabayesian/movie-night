import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { ClientMessage, GameState } from '../../shared/types';
import { AdminPanel } from './AdminPanel';
import { ScriptView } from './ScriptView';
import { useLobby } from './useLobby';

const nameKey = (id: string) => `scene-sync:${id}:name`;

export function Game({ lobbyId, admin }: { lobbyId: string; admin: boolean }) {
  const [name, setName] = useState<string | null>(() => sessionStorage.getItem(nameKey(lobbyId)));
  const [tab, setTab] = useState<'game' | 'admin'>('game');
  const { state, me, conn, error, send } = useLobby(lobbyId, name, admin);

  // A rejected join (e.g. name taken) sends the user back to the name form.
  useEffect(() => {
    if (name && !me && error) {
      sessionStorage.removeItem(nameKey(lobbyId));
      setName(null);
    }
  }, [error, me, name, lobbyId]);

  if (!name || (!me && conn !== 'connecting' && conn !== 'closed')) {
    return <NameForm error={error} onSubmit={(n) => { sessionStorage.setItem(nameKey(lobbyId), n); setName(n); }} />;
  }
  if (conn === 'kicked') return <Notice text="You were removed from the session." />;
  if (conn === 'ended') return <Notice text="The session has ended." />;
  if (!state || !me) return <Notice text="Connecting…" />;

  return (
    <div className="app">
      <Scoreboard state={state} me={me} />
      {admin && (
        <nav className="tabs">
          <button className={tab === 'game' ? 'on' : ''} onClick={() => setTab('game')}>Game</button>
          <button className={tab === 'admin' ? 'on' : ''} onClick={() => setTab('admin')}>Admin</button>
        </nav>
      )}
      {conn === 'closed' && <p className="muted">Reconnecting…</p>}
      {error && <p className="error">{error}</p>}
      {tab === 'admin' && admin ? (
        <AdminPanel state={state} me={me} lobbyId={lobbyId} send={send} />
      ) : (
        <Stage state={state} me={me} send={send} admin={admin} lobbyId={lobbyId} />
      )}
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <main className="card"><p>{text}</p></main>;
}

function NameForm({ error, onSubmit }: { error: string | null; onSubmit: (n: string) => void }) {
  const [v, setV] = useState('');
  return (
    <main className="card">
      <h1>Who are you?</h1>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSubmit(v.trim()); }}>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Your name" maxLength={24} autoFocus />
        <button type="submit">Join</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}

function Scoreboard({ state, me }: { state: GameState; me: string }) {
  return (
    <ul className="scores">
      {state.players.map((p) => (
        <li key={p.id} className={p.connected ? '' : 'off'}>
          <span>
            {p.name}
            {p.id === me && ' (you)'}
            {p.id === state.prompterId && ' 🎬'}
          </span>
          <b>{p.score}</b>
        </li>
      ))}
    </ul>
  );
}

interface StageProps {
  state: GameState;
  me: string;
  send: (m: ClientMessage) => void;
  admin: boolean;
  lobbyId: string;
}

function Stage({ state, me, send, admin, lobbyId }: StageProps) {
  const prompter = state.players.find((p) => p.id === state.prompterId);
  const isPrompter = state.prompterId === me;

  if (state.status === 'lobby') {
    if (!prompter) {
      return admin ? <StartPicker state={state} send={send} lobbyId={lobbyId} /> : <Waiting text="Waiting for the host to start…" />;
    }
    if (state.candidates) {
      return isPrompter ? (
        <section className="card">
          <h2>Which scene?</h2>
          {state.candidates.map((c, i) => (
            <button key={i} className="choice" onClick={() => send({ type: 'pickCandidate', index: i })}>
              <b>{c.title}</b>
              <span>{c.description}</span>
            </button>
          ))}
        </section>
      ) : (
        <Waiting text={`${prompter.name} is picking a scene…`} />
      );
    }
    return isPrompter ? <PromptForm send={send} /> : <Waiting text={`${prompter.name} is choosing a scene…`} />;
  }

  if (state.status === 'generating') return <Waiting text="Writing the script…" />;

  if (state.status === 'acting') {
    if (!state.rolesAssigned) {
      return isPrompter ? <CastForm state={state} send={send} /> : <Waiting text={`${prompter?.name} is casting the roles…`} />;
    }
    return (
      <>
        <ScriptView state={state} me={me} />
        {isPrompter && <button onClick={() => send({ type: 'finishActing' })}>Scene finished</button>}
      </>
    );
  }

  return (
    <>
      <ScriptView state={state} me={me} />
      {isPrompter ? (
        <section className="card">
          <h2>Who wins the round?</h2>
          {state.players.filter((p) => p.id !== me).map((p) => (
            <button key={p.id} className="choice" onClick={() => send({ type: 'awardPoint', playerId: p.id })}>
              {p.name}
            </button>
          ))}
        </section>
      ) : (
        <Waiting text={`${prompter?.name} is choosing the winner…`} />
      )}
    </>
  );
}

function Waiting({ text }: { text: string }) {
  return <p className="waiting">{text}</p>;
}

function StartPicker({ state, send, lobbyId }: { state: GameState; send: (m: ClientMessage) => void; lobbyId: string }) {
  const [pid, setPid] = useState('');
  const [qr, setQr] = useState('');
  useEffect(() => {
    QRCode.toDataURL(`${location.origin}/lobby/${lobbyId}`, { margin: 1, width: 320 }).then(setQr);
  }, [lobbyId]);
  return (
    <section className="card">
      <h2>Lobby</h2>
      {qr && <img className="qr" src={qr} alt="Join QR code" />}
      <p className="muted">{location.origin}/lobby/{lobbyId}</p>
      <select value={pid} onChange={(e) => setPid(e.target.value)}>
        <option value="">Choose the first prompter…</option>
        {state.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button disabled={!pid} onClick={() => send({ type: 'start', prompterId: pid })}>Start game</button>
    </section>
  );
}

function PromptForm({ send }: { send: (m: ClientMessage) => void }) {
  const [scene, setScene] = useState('');
  const [style, setStyle] = useState('');
  return (
    <form
      className="card"
      onSubmit={(e) => { e.preventDefault(); send({ type: 'submitPrompt', scene, style }); }}
    >
      <h2>Your scene</h2>
      <input value={scene} onChange={(e) => setScene(e.target.value)} placeholder="The diner scene from Pulp Fiction" maxLength={200} />
      <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="In the style of Shakespeare" maxLength={100} />
      <button type="submit" disabled={!scene.trim() || !style.trim()}>Generate</button>
    </form>
  );
}

function CastForm({ state, send }: { state: GameState; send: (m: ClientMessage) => void }) {
  const speakers = [...new Set(state.current_script.map((l) => l.speaker))];
  const [roles, setRoles] = useState<Record<string, string>>({});
  return (
    <section className="card">
      <h2>Cast the roles</h2>
      {speakers.map((sp) => (
        <label key={sp} className="row">
          <span>{sp}</span>
          <select value={roles[sp] ?? ''} onChange={(e) => setRoles({ ...roles, [sp]: e.target.value })}>
            <option value="">—</option>
            {state.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      ))}
      <button
        onClick={() => send({ type: 'assignRoles', roles: Object.fromEntries(Object.entries(roles).filter(([, v]) => v)) })}
      >
        Action!
      </button>
    </section>
  );
}
