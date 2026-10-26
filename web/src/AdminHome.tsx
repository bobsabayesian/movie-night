import { useState } from 'react';

export function AdminHome() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/lobby', { method: 'POST' });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const { id } = (await res.json()) as { id: string };
      location.href = `/admin/${id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setBusy(false);
    }
  };

  return (
    <main className="card">
      <h1>Host a game</h1>
      <button onClick={create} disabled={busy}>
        {busy ? 'Creating…' : 'Create lobby'}
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
