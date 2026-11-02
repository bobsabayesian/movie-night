import type { Candidate, Difficulty, RoundOutcome, ScriptLine } from '../../shared/types';
import type { Env } from './env';

/** One immutable-ish object per round: written when the script is generated, rewritten once when the round resolves. */
export interface RoundRecord {
  round: number;
  session_id: string;
  started_at: string;
  chooser: string;
  genre: string;
  scene: string;
  style: string;
  difficulty: Difficulty;
  parts: number;
  chosen?: Candidate;
  script_transcript: ScriptLine[];
  character_names?: Record<string, string>;
  outcome: RoundOutcome;
  winner: string | null;
  points: number;
}

export const LOG_PREFIX = 'movie-night/rounds/';

export function roundKey(sessionId: string, round: number, now = new Date()): string {
  return `${LOG_PREFIX}${now.toISOString().replace(/[:.]/g, '-')}_${sessionId}_${round}.json`;
}

/** Small summary kept in R2 custom metadata so the log can be listed without fetching every object. */
export interface LogRow {
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

function summary(rec: RoundRecord): Record<string, string> {
  return {
    at: rec.started_at,
    round: String(rec.round),
    session: rec.session_id,
    chooser: rec.chooser.slice(0, 40),
    genre: rec.genre,
    scene: rec.scene.slice(0, 200),
    style: rec.style.slice(0, 100),
    difficulty: rec.difficulty,
    parts: String(rec.parts),
    outcome: rec.outcome,
    winner: (rec.winner ?? '').slice(0, 40),
    points: String(rec.points),
  };
}

export function putRound(env: Env, key: string, rec: RoundRecord): Promise<unknown> {
  return env.LEDGER.put(key, JSON.stringify(rec), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: summary(rec),
  });
}

/** Newest rounds first. Keys start with an ISO timestamp, so key order is time order. */
export async function listRounds(env: Env, limit = 100): Promise<LogRow[]> {
  const rows: LogRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const opts = { prefix: LOG_PREFIX, cursor, include: ['customMetadata'] } as R2ListOptions;
    const res = await env.LEDGER.list(opts);
    for (const o of res.objects) {
      const m = o.customMetadata ?? {};
      rows.push({
        key: o.key,
        at: m.at ?? '',
        round: m.round ?? '',
        session: m.session ?? '',
        chooser: m.chooser ?? '',
        genre: m.genre ?? '',
        scene: m.scene ?? '',
        style: m.style ?? '',
        difficulty: m.difficulty ?? '',
        parts: m.parts ?? '',
        outcome: m.outcome ?? '',
        winner: m.winner ?? '',
        points: m.points ?? '',
      });
    }
    if (!res.truncated) break;
    cursor = res.cursor;
  }
  return rows.sort((a, b) => b.key.localeCompare(a.key)).slice(0, limit);
}
