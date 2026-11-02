import { useCallback, useEffect, useState } from 'react';
import type { ClientMessage, GameState } from '../../shared/types';
import config from './config';

interface Props {
  state: GameState;
  me: string;
  lobbyId: string;
  send: (m: ClientMessage) => void;
}

interface LogRow {
  key: string;
  at: string;
  round: string;
  session: string;
  chooser: string;
  genre: string;
  scene: string;
  style: string;
  difficulty: string;
  parts: string;
  outcome: string;
  winner: string;
  points: string;
}

export function AdminPanel({ state, me, lobbyId, send }: Props) {
  return (
    <>
      <section className="card">
        <h2>Players</h2>
        <p className="muted">Lobby {lobbyId}</p>
        <ul className="admin-list">
          {state.players.map((p) => (
            <li key={p.id}>
              <span><i className="dot" style={{ background: p.color }} />{p.name}{p.id === state.prompterId && ' 🎬'}</span>
              <button onClick={() => send({ type: 'setPrompter', playerId: p.id })}>Make prompter</button>
              {p.id !== me && (
                <button className="danger" onClick={() => confirm(`Kick ${p.name}?`) && send({ type: 'kick', playerId: p.id })}>
                  Kick
                </button>
              )}
            </li>
          ))}
        </ul>
        <button className="danger" onClick={() => confirm('End the session for everyone?') && send({ type: 'terminate' })}>
          Terminate session
        </button>
      </section>

      <Toggles title="Genres" kind="genre" all={config.genres} disabled={state.disabledGenres} send={send} />
      <Toggles title="Styles" kind="style" all={config.styles} disabled={state.disabledStyles} send={send} />
      <History />
    </>
  );
}

function Toggles({ title, kind, all, disabled, send }: {
  title: string;
  kind: 'style' | 'genre';
  all: string[];
  disabled: string[];
  send: (m: ClientMessage) => void;
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted">Untick to take an option out of play for this session.</p>
      <div className="toggles">
        {all.map((v) => (
          <label key={v} className="toggle">
            <input
              type="checkbox"
              checked={!disabled.includes(v)}
              onChange={(e) => send({ type: 'setEnabled', kind, value: v, enabled: e.target.checked })}
            />
            {v}
          </label>
        ))}
      </div>
    </section>
  );
}

function History() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch('/api/admin/log')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="card">
      <h2>Scene log</h2>
      <button className="secondary" onClick={load}>Refresh</button>
      {error && <p className="error">{error}</p>}
      {rows && rows.length === 0 && <p className="muted">No scenes yet.</p>}
      <ul className="log">
        {rows?.map((r) => (
          <li key={r.key}>
            <b>{r.scene}</b>
            <span className="muted">
              {r.genre} · {r.style} · {r.parts} parts{r.difficulty === 'hard' ? ' · hard' : ''}
            </span>
            <span className="muted">
              {r.chooser} chose it · {outcome(r)} · {new Date(r.at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function outcome(r: LogRow): string {
  if (r.outcome === 'won') return `${r.winner} won ${r.points}`;
  if (r.outcome === 'nobody') return 'no one won';
  if (r.outcome === 'abandoned') return 'abandoned';
  return 'in progress';
}
