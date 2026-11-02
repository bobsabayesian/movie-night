import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { ClientMessage, GameState } from '../../shared/types';
import { AdminPanel } from './AdminPanel';
import config, { enabledGenres, enabledStyles } from './config';
import { ScriptView } from './ScriptView';
import { useLobby } from './useLobby';

const nameKey = (id: string) => `scene-sync:${id}:name`;
const colorKey = (id: string) => `scene-sync:${id}:color`;

export function Game({ lobbyId, admin }: { lobbyId: string; admin: boolean }) {
  const [name, setName] = useState<string | null>(() => sessionStorage.getItem(nameKey(lobbyId)));
  const [color, setColor] = useState<string | null>(() => sessionStorage.getItem(colorKey(lobbyId)));
  const [tab, setTab] = useState<'game' | 'admin'>('game');
  const { state, me, conn, error, send } = useLobby(lobbyId, name, color, admin);

  // A rejected join (name taken, color taken) sends the user back to the join form.
  useEffect(() => {
    if (name && !me && error) {
      sessionStorage.removeItem(nameKey(lobbyId));
      sessionStorage.removeItem(colorKey(lobbyId));
      setName(null);
      setColor(null);
    }
  }, [error, me, name, lobbyId]);

  if (!name || (!me && conn !== 'connecting' && conn !== 'closed')) {
    return (
      <JoinForm
        lobbyId={lobbyId}
        error={error}
        onSubmit={(n, c) => {
          sessionStorage.setItem(nameKey(lobbyId), n);
          sessionStorage.setItem(colorKey(lobbyId), c);
          setName(n);
          setColor(c);
        }}
      />
    );
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

function JoinForm({ lobbyId, error, onSubmit }: { lobbyId: string; error: string | null; onSubmit: (name: string, color: string) => void }) {
  const [v, setV] = useState('');
  const [taken, setTaken] = useState<string[]>([]);
  const [color, setColor] = useState('');

  useEffect(() => {
    fetch(`/api/lobby/${lobbyId}/info`)
      .then((r) => r.json())
      .then((d: { taken: string[] }) => {
        setTaken(d.taken);
        setColor((c) => c || config.colors.find((x) => !d.taken.includes(x.hex))?.hex || '');
      })
      .catch(() => setColor((c) => c || config.colors[0].hex));
  }, [lobbyId]);

  return (
    <main className="card">
      <h1>Who are you?</h1>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim() && color) onSubmit(v.trim(), color); }}>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Your name" maxLength={24} autoFocus />
        <div className="swatches" role="radiogroup" aria-label="Your color">
          {config.colors.map((c) => (
            <button
              type="button"
              key={c.hex}
              role="radio"
              aria-checked={color === c.hex}
              aria-label={c.name}
              title={taken.includes(c.hex) ? `${c.name} (taken)` : c.name}
              disabled={taken.includes(c.hex)}
              className={color === c.hex ? 'swatch on' : 'swatch'}
              style={{ background: c.hex }}
              onClick={() => setColor(c.hex)}
            />
          ))}
        </div>
        <button type="submit" disabled={!v.trim() || !color}>Join</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}

function Dot({ color }: { color: string }) {
  return <i className="dot" style={{ background: color }} />;
}

function Scoreboard({ state, me }: { state: GameState; me: string }) {
  return (
    <ul className="scores">
      {state.players.map((p) => (
        <li key={p.id} className={p.connected ? '' : 'off'}>
          <span>
            <Dot color={p.color} />
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
    return isPrompter ? <PromptForm state={state} send={send} /> : <Waiting text={`${prompter.name} is choosing a scene…`} />;
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
      {isPrompter ? <Scoring state={state} me={me} send={send} /> : <Waiting text={`${prompter?.name} is choosing the winner…`} />}
    </>
  );
}

function Scoring({ state, me, send }: { state: GameState; me: string; send: (m: ClientMessage) => void }) {
  const [next, setNext] = useState('');
  return (
    <>
      <section className="card">
        <h2>Who guessed it? ({state.promptData?.difficulty === 'hard' ? '2 points' : '1 point'})</h2>
        {state.players.filter((p) => p.id !== me).map((p) => (
          <button key={p.id} className="choice" onClick={() => send({ type: 'awardPoint', playerId: p.id })}>
            <span className="choice-name"><Dot color={p.color} />{p.name}</span>
          </button>
        ))}
      </section>
      <section className="card">
        <h2>Nobody got it?</h2>
        <select value={next} onChange={(e) => setNext(e.target.value)}>
          <option value="">Who chooses next?</option>
          {state.players.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === me ? ' (you)' : ''}</option>)}
        </select>
        <button className="secondary" disabled={!next} onClick={() => send({ type: 'skipRound', nextPrompterId: next })}>
          No one wins — no points
        </button>
      </section>
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

function PromptForm({ state, send }: { state: GameState; send: (m: ClientMessage) => void }) {
  const styles = enabledStyles(state.disabledStyles);
  const genres = enabledGenres(state.disabledGenres);
  const [scene, setScene] = useState('');
  const [style, setStyle] = useState('');
  const [genre, setGenre] = useState(genres[0]);
  const [parts, setParts] = useState<number>(config.parts.default);
  const [hard, setHard] = useState(false);
  const genreOk = genres.includes(genre) ? genre : genres[0];

  const randomize = () => {
    const pool = styles.filter((s) => s !== style);
    setStyle(pool[Math.floor(Math.random() * pool.length)] ?? styles[0]);
  };

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        send({ type: 'submitPrompt', scene, style, genre: genreOk, parts, difficulty: hard ? 'hard' : 'easy' });
      }}
    >
      <h2>Your scene</h2>
      <div className="row">
        <label className="field">
          <span className="muted">Genre</span>
          <select value={genreOk} onChange={(e) => setGenre(e.target.value)}>
            {genres.map((g) => <option key={g}>{g}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="muted">Speaking parts</span>
          <select value={parts} onChange={(e) => setParts(Number(e.target.value))}>
            {Array.from({ length: config.parts.max - config.parts.min + 1 }, (_, i) => config.parts.min + i).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <input
        value={scene}
        onChange={(e) => setScene(e.target.value)}
        placeholder={genreOk === 'Song' ? 'Bohemian Rhapsody' : 'The diner scene from Pulp Fiction'}
        maxLength={200}
      />
      <div className="inline">
        <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="In the style of… (Shakespeare)" maxLength={100} />
        <button type="button" className="secondary" onClick={randomize} title="Pick a random style">🎲 Randomize</button>
      </div>
      <label className="difficulty">
        <span className="difficulty-labels">
          <span className={hard ? '' : 'on'}>Easy</span>
          <span className={hard ? 'on' : ''}>Hard · 2 points</span>
        </span>
        <input type="range" min={0} max={1} step={1} value={hard ? 1 : 0} onChange={(e) => setHard(e.target.value === '1')} />
        <span className="muted">{hard ? 'Obscure — no famous lines. The guesser earns 2 points.' : 'Iconic lines and references. The guesser earns 1 point.'}</span>
      </label>
      <button type="submit" disabled={!scene.trim() || !style.trim()}>Generate</button>
    </form>
  );
}

function CastForm({ state, send }: { state: GameState; send: (m: ClientMessage) => void }) {
  const speakers = [...new Set(state.current_script.map((l) => l.speaker))];
  const [roles, setRoles] = useState<Record<string, string>>({});
  const allCast = speakers.every((sp) => roles[sp]);
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
      <button disabled={!allCast} onClick={() => send({ type: 'assignRoles', roles })}>
        {allCast ? 'Action!' : `Cast all ${speakers.length} characters`}
      </button>
    </section>
  );
}
