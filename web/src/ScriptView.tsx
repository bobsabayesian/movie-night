import type { GameState } from '../../shared/types';

export function ScriptView({ state, me }: { state: GameState; me: string }) {
  const nameOf = (id?: string) => state.players.find((p) => p.id === id)?.name;
  const speakers = [...new Set(state.current_script.map((l) => l.speaker))];
  const myParts = speakers.filter((sp) => state.roles[sp] === me);

  return (
    <>
      <section className={myParts.length ? 'banner banner--mine' : 'banner'}>
        {myParts.length ? (
          <>
            <span>You play</span>
            <b>{myParts.join(' & ')}</b>
          </>
        ) : (
          <span>You're in the audience — follow along</span>
        )}
      </section>

      <ul className="cast">
        {speakers.map((sp) => {
          const actor = nameOf(state.roles[sp]);
          const mine = state.roles[sp] === me;
          return (
            <li key={sp} className={mine ? 'cast--mine' : ''}>
              <span>{sp}</span>
              <b>{mine ? 'You' : (actor ?? 'unassigned')}</b>
            </li>
          );
        })}
      </ul>

      <section className="script">
        {state.current_script.map((l, i) => {
          const mine = state.roles[l.speaker] === me;
          const actor = nameOf(state.roles[l.speaker]);
          return (
            <p key={i} className={mine ? 'line line--mine' : 'line line--other'}>
              <span className="speaker">
                {l.speaker}
                {actor && ` · ${mine ? 'you' : actor}`}
              </span>
              {l.line}
            </p>
          );
        })}
      </section>
    </>
  );
}
