import type { PromptData, ScriptLine } from '../../shared/types';
import type { Env } from './env';

export interface LedgerEntry {
  prompt_data: PromptData;
  script_transcript: ScriptLine[];
  winner: string;
}

export function ledgerKey(sessionId: string, now = new Date()): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}_${sessionId}.json`;
}

export function writeLedger(env: Env, sessionId: string, entry: LedgerEntry): Promise<unknown> {
  return env.LEDGER.put(ledgerKey(sessionId), JSON.stringify(entry), {
    httpMetadata: { contentType: 'application/json' },
  });
}
