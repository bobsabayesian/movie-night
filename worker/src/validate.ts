import type { Candidate, ScriptLine } from '../../shared/types';

export function validateScript(data: unknown): ScriptLine[] | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const out: ScriptLine[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') return null;
    const { speaker, line } = item as Record<string, unknown>;
    if (typeof speaker !== 'string' || typeof line !== 'string') return null;
    if (!speaker.trim() || !line.trim()) return null;
    out.push({ speaker: speaker.trim(), line: line.trim() });
  }
  return out;
}

export interface Clarification {
  status: 'ok' | 'ambiguous';
  candidates: Candidate[];
}

export function validateClarification(data: unknown): Clarification | null {
  if (!data || typeof data !== 'object') return null;
  const { status, candidates } = data as Record<string, unknown>;
  if (status !== 'ok' && status !== 'ambiguous') return null;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') return null;
    const { title, description } = c as Record<string, unknown>;
    if (typeof title !== 'string' || typeof description !== 'string') return null;
    out.push({ title, description });
  }
  return { status, candidates: out };
}

export function validateName(raw: unknown, existing: string[]): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 24) return null;
  if (existing.some((n) => n.toLowerCase() === name.toLowerCase())) return null;
  return name;
}

export function cleanRoles(
  roles: unknown,
  speakers: string[],
  playerIds: string[],
): Record<string, string> | null {
  if (!roles || typeof roles !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [speaker, pid] of Object.entries(roles as Record<string, unknown>)) {
    if (!speakers.includes(speaker)) return null;
    if (typeof pid !== 'string' || !playerIds.includes(pid)) return null;
    out[speaker] = pid;
  }
  return out;
}

/** Replace real character names with "Character 1", "Character 2", … in order of first appearance. */
export function anonymizeSpeakers(script: ScriptLine[]): {
  labelled: ScriptLine[];
  names: Record<string, string>;
} {
  const labelOf = new Map<string, string>();
  const names: Record<string, string> = {};
  const labelled = script.map(({ speaker, line }) => {
    let label = labelOf.get(speaker);
    if (!label) {
      label = `Character ${labelOf.size + 1}`;
      labelOf.set(speaker, label);
      names[label] = speaker;
    }
    return { speaker: label, line };
  });
  return { labelled, names };
}
