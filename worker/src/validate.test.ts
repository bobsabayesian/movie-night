import { describe, expect, it } from 'vitest';
import { cleanRoles, validateClarification, validateName, validateScript } from './validate';

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
