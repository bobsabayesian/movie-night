import { useState } from 'react';
import { AdminHome } from './AdminHome';
import { Game } from './Game';

export function App() {
  const parts = location.pathname.split('/').filter(Boolean);

  if (parts[0] === 'lobby' && parts[1]) return <Game lobbyId={parts[1]} admin={false} />;
  if (parts[0] === 'admin' && parts[1]) return <Game lobbyId={parts[1]} admin />;
  if (parts[0] === 'admin') return <AdminHome />;
  return <JoinHome />;
}

function JoinHome() {
  const [code, setCode] = useState('');
  return (
    <main className="card">
      <h1>Scene Sync</h1>
      <p className="muted">Scan the host's QR code, or enter the lobby code.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) location.href = `/lobby/${code.trim()}`;
        }}
      >
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Lobby code" />
        <button type="submit">Join</button>
      </form>
    </main>
  );
}
