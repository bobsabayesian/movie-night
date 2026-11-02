import type { CSSProperties } from 'react';
import type { GameState } from '../../shared/types';

export function ScriptView({ state, me }: { state: GameState; me: string }) {
  const player = (id?: string) => state.players.find((p) => p.id === id);
  const speakers = [...new Set(state.current_script.map((l) => l.speaker))];
  const myParts = speakers.filter((sp) => state.roles[sp] === me);
  // Your highlight uses the color you picked when you joined.
  const mineStyle = { '--mine': player(me)?.color ?? 'var(--accent)' } as CSSProperties;

  return (
    <div style={mineStyle} className="scriptview">
      <section className={myParts.length ? 'banner banner--mine' : 'banner'}>
        {myParts.length ? (
          <>
            <span>You play</span>
            <b>{myParts.join(' & ')}</b>
          </>
        ) : (
          <span>You're in the audience — follow along</span>
        )}
        {state.promptData && <em className="style">in the style of {state.promptData.style}</em>}
      </section>

      <ul className="cast">
        {speakers.map((sp) => {
          const actor = player(state.roles[sp]);
          const mine = state.roles[sp] === me;
          return (
            <li key={sp} className={mine ? 'cast--mine' : ''}>
              <span>
                {actor && <i className="dot" style={{ background: actor.color }} />}
                {sp}
              </span>
              <b>{mine ? 'You' : (actor?.name ?? 'unassigned')}</b>
            </li>
          );
        })}
      </ul>

      <section className="script">
        {state.current_script.map((l, i) => {
          const actor = player(state.roles[l.speaker]);
          const mine = state.roles[l.speaker] === me;
          return (
            <p
              key={i}
              className={mine ? 'line line--mine' : 'line line--other'}
              style={!mine && actor ? { borderLeft: `3px solid ${actor.color}` } : undefined}
            >
              <span className="speaker">
                {l.speaker}
                {actor && ` · ${mine ? 'you' : actor.name}`}
              </span>
              {l.line}
            </p>
          );
        })}
      </section>
    </div>
  );
}
