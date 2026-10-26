import type { ClientMessage, GameState } from '../../shared/types';

interface Props {
  state: GameState;
  me: string;
  lobbyId: string;
  send: (m: ClientMessage) => void;
}

export function AdminPanel({ state, me, lobbyId, send }: Props) {
  return (
    <section className="card">
      <h2>Admin</h2>
      <p className="muted">Lobby {lobbyId}</p>
      <ul className="admin-list">
        {state.players.map((p) => (
          <li key={p.id}>
            <span>{p.name}{p.id === state.prompterId && ' 🎬'}</span>
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
  );
}
