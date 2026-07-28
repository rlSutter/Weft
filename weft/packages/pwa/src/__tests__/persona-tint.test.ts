// Unit tests for M11.5-c personaPalette (pure-function).
// Component tests of the full flow (persona settings screen, overlap
// warning card, confirm-switch card) are Layer 3.5 and stay deferred
// per TESTING.md until jsdom + @testing-library/react are wired.

import { describe, it, expect } from 'vitest';
import { personaPalette } from '../persona-tint';
import { tokens } from '../styles';

describe('personaPalette / M11.5-c', () => {
  it('root persona (index 0) uses the canonical pine accent (no tint)', () => {
    const p = personaPalette(0, 'ff'.repeat(32), 'main');
    expect(p.accent).toBe(tokens.accent);
    expect(p.accentSoft).toBe(tokens.accentSoft);
    expect(p.eyebrow).toBe('');
  });

  it('non-root persona gets a distinct accent (never equal to root pine)', () => {
    const p = personaPalette(1, '11'.repeat(32), 'Quiet');
    expect(p.accent).not.toBe(tokens.accent);
    expect(p.accentSoft).not.toBe(tokens.accentSoft);
    expect(p.eyebrow).toContain('Quiet');
    expect(p.eyebrow).toContain('Persona 1');
  });

  it('derivation is deterministic — same pubkey + index → same palette', () => {
    const a = personaPalette(2, 'ab'.repeat(32), 'Work');
    const b = personaPalette(2, 'ab'.repeat(32), 'Work');
    expect(a).toEqual(b);
  });

  it('different pubkeys yield different accents at the same index', () => {
    const a = personaPalette(1, 'ab'.repeat(32), 'A');
    const b = personaPalette(1, 'cd'.repeat(32), 'B');
    expect(a.accent).not.toBe(b.accent);
  });

  it('the eyebrow includes the persona index for non-root personas', () => {
    const p1 = personaPalette(1, 'aa'.repeat(32), 'L1');
    const p7 = personaPalette(7, 'aa'.repeat(32), 'L7');
    expect(p1.eyebrow).toContain('Persona 1');
    expect(p7.eyebrow).toContain('Persona 7');
  });
});
