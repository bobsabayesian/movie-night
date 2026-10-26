import type { GameState } from '../../shared/types';

export function ScriptView({ state, me }: { state: GameState; me: string }) {
  const nameOf = (id?: string) => state.players.find((p) => p.id === id)?.name;
  return (
    <section className="script">
      {state.current_script.map((l, i) => {
        const mine = state.roles[l.speaker] === me;
        const actor = nameOf(state.roles[l.speaker]);
        return (
          <p key={i} className={mine ? 'line line--mine' : 'line line--other'}>
            <span className="speaker">
              {l.speaker}
              {actor && ` · ${actor}`}
            </span>
            {l.line}
          </p>
        );
      })}
    </section>
  );
}
