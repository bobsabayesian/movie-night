import { describe, expect, it } from 'vitest';
import {
  anonymizeSpeakers,
  clampParts,
  cleanRoles,
  countSpeakers,
  pickColor,
  validateClarification,
  validateName,
  validateScript,
} from './validate';

describe('validateScript', () => {
  it('accepts speaker/line arrays', () => {
    expect(validateScript([{ speaker: ' A ', line: 'hi' }])).toEqual([{ speaker: 'A', line: 'hi' }]);
  });
  it('rejects malformed output', () => {
    expect(validateScript([])).toBeNull();
    expect(validateScript([{ speaker: 'A' }])).toBeNull();
    expect(validateScript({ speaker: 'A', line: 'x' })).toBeNull();
    expect(validateScript([{ speaker: '', line: 'x' }])).toBeNull();
  });
});

describe('validateClarification', () => {
  it('accepts ok and ambiguous', () => {
    expect(
      validateClarification({ status: 'ambiguous', candidates: [{ title: 't', description: 'd' }] }),
    ).not.toBeNull();
    expect(validateClarification({ status: 'maybe', candidates: [] })).toBeNull();
  });
});

describe('validateName', () => {
  it('trims, bounds, and enforces uniqueness case-insensitively', () => {
    expect(validateName('  Bob  ', [])).toBe('Bob');
    expect(validateName('bob', ['Bob'])).toBeNull();
    expect(validateName('', [])).toBeNull();
    expect(validateName('x'.repeat(25), [])).toBeNull();
  });
});

describe('cleanRoles', () => {
  it('only allows known speakers and players', () => {
    expect(cleanRoles({ A: 'p1' }, ['A', 'B'], ['p1'])).toEqual({ A: 'p1' });
    expect(cleanRoles({ C: 'p1' }, ['A'], ['p1'])).toBeNull();
    expect(cleanRoles({ A: 'zz' }, ['A'], ['p1'])).toBeNull();
  });
});

describe('anonymizeSpeakers', () => {
  it('labels speakers by first appearance and keeps the real names', () => {
    const { labelled, names } = anonymizeSpeakers([
      { speaker: 'Jules', line: 'a' },
      { speaker: 'Vincent', line: 'b' },
      { speaker: 'Jules', line: 'c' },
    ]);
    expect(labelled.map((l) => l.speaker)).toEqual(['Character 1', 'Character 2', 'Character 1']);
    expect(names).toEqual({ 'Character 1': 'Jules', 'Character 2': 'Vincent' });
  });
});

describe('pickColor', () => {
  const allowed = ['#ef4444', '#22c55e'];
  it('accepts a free allowed color, case-insensitively', () => {
    expect(pickColor('#EF4444', allowed, [])).toBe('#ef4444');
  });
  it('rejects taken, unknown and non-string colors', () => {
    expect(pickColor('#ef4444', allowed, ['#ef4444'])).toBeNull();
    expect(pickColor('#000000', allowed, [])).toBeNull();
    expect(pickColor(undefined, allowed, [])).toBeNull();
  });
});

describe('clampParts / countSpeakers', () => {
  it('clamps into range and falls back on junk', () => {
    expect(clampParts(10, 2, 6, 2)).toBe(6);
    expect(clampParts(0, 2, 6, 2)).toBe(2);
    expect(clampParts('abc', 2, 6, 3)).toBe(3);
    expect(clampParts(3.6, 2, 6, 2)).toBe(4);
  });
  it('counts distinct speakers', () => {
    expect(countSpeakers([{ speaker: 'A', line: 'x' }, { speaker: 'B', line: 'y' }, { speaker: 'A', line: 'z' }])).toBe(2);
  });
});
