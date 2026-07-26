// Gate 5 — PLURALITY IS BOUNDED.
//
// **The property.** No root may back more than k active personas per epoch
// per issuer without cryptographically self-incriminating. Cheating is
// automatic and detectable by anyone who observes two presentations from
// the same root at the same show-slot in one (issuer, epoch).
//
// **This test is release-gate class.** It exists to prove the property,
// not to explore edge cases. Weakening or removing this file requires
// Fable review — same rule as Gates 1–4.
//
// Enforced by:
//   - M9-T2  k-show nullifier + detectDoubleSpend trapdoor
//   - M11-T1 personaShareTicket folding personaIndex into show_index mod k
//
// Sources of law:
//   DD §18.2, §18.6         invariant 5
//   DD §36.3                persona layer
//   Build list M13-T1       gate 5 goes live
//   SECURITY.md invariant-5 row (updated M13-T3)

import { describe, it, expect } from 'vitest';
import { randomBytes } from '@noble/hashes/utils';
import { bls12_381 } from '@noble/curves/bls12-381';
import {
  personaShareTicket,
  DEFAULT_K,
  detectDoubleSpend,
} from '../../index';

const FR_ORDER: bigint = bls12_381.fields.Fr.ORDER;
const toScalar = (u: Uint8Array): bigint => {
  let x = 0n;
  for (const b of u) x = (x << 8n) | BigInt(b);
  return x % FR_ORDER;
};

describe('Gate 5 — PLURALITY IS BOUNDED (release gate)', () => {
  it('the (k+1)th persona from one root, in one (issuer, epoch), self-incriminates', () => {
    // Setup: a single root, a single cell, a single epoch, k personas
    // presenting one after another.
    const root = randomBytes(32);
    const issuerId = new Uint8Array(32).fill(0x01);
    const epoch = 42;
    const k = DEFAULT_K;

    // The first k personas each get a distinct show_index (0..k-1).
    const firstK = Array.from({ length: k }, (_, personaIndex) =>
      personaShareTicket(root, personaIndex, issuerId, epoch, randomBytes(32), k),
    );

    // Every one of the first k has a unique nullifier.
    const nyms = new Set(firstK.map((t) => Buffer.from(t.nullifier).toString('hex')));
    expect(nyms.size).toBe(k);

    // The (k+1)th persona is FORCED to reuse a show_index via `index mod k`.
    // Regardless of which persona index the client picks past k, one of the
    // first k's nullifiers collides.
    const overShow = personaShareTicket(root, k, issuerId, epoch, randomBytes(32), k);
    const collidingSlot = k % k; // = 0
    expect(Array.from(overShow.nullifier)).toEqual(Array.from(firstK[collidingSlot]!.nullifier));

    // TRAPDOOR: anyone observing the two colliding presentations recovers
    // the root secret. This is what makes plurality-bounded self-enforcing.
    const recovered = detectDoubleSpend(firstK[collidingSlot]!, overShow);
    expect(recovered).not.toBeNull();
    expect(toScalar(recovered!)).toBe(toScalar(root));
  });

  it('per-epoch quota resets — k personas per epoch is fine indefinitely', () => {
    // Sanity property for "bounded" — the bound is per-epoch, not per-root
    // forever. A prolific user with k personas can present k times per epoch
    // for many epochs with no collision.
    const root = randomBytes(32);
    const issuerId = new Uint8Array(32).fill(0x02);
    const k = DEFAULT_K;

    // Simulate 4 epochs of k personas each.
    const allNyms = new Set<string>();
    for (let epoch = 100; epoch < 104; epoch++) {
      for (let i = 0; i < k; i++) {
        const t = personaShareTicket(root, i, issuerId, epoch, randomBytes(32), k);
        allNyms.add(Buffer.from(t.nullifier).toString('hex'));
      }
    }
    // 4 epochs × k personas = 4k distinct nullifiers (per-epoch keying).
    expect(allNyms.size).toBe(4 * k);
  });

  it('per-issuer quota — the bound is scoped per cell, not per network', () => {
    // A user with 3 personas in cell A and 3 in cell B has 6 personas total
    // but zero nullifier collisions — bounded plurality is per-issuer.
    const root = randomBytes(32);
    const cellA = new Uint8Array(32).fill(0x03);
    const cellB = new Uint8Array(32).fill(0x04);
    const epoch = 50;
    const k = DEFAULT_K;

    const nyms = new Set<string>();
    for (let i = 0; i < k; i++) {
      const inA = personaShareTicket(root, i, cellA, epoch, randomBytes(32), k);
      const inB = personaShareTicket(root, i, cellB, epoch, randomBytes(32), k);
      nyms.add(Buffer.from(inA.nullifier).toString('hex'));
      nyms.add(Buffer.from(inB.nullifier).toString('hex'));
    }
    // 2 cells × k personas = 2k distinct nullifiers.
    expect(nyms.size).toBe(2 * k);
  });

  it('different roots do not cross-recover — one user cheating doesnt expose another', () => {
    // Two users, each acting honestly within k. Even though their share
    // spaces are the same shape, no cross-user information leaks.
    const rootA = randomBytes(32);
    const rootB = randomBytes(32);
    const issuerId = new Uint8Array(32).fill(0x05);
    const epoch = 200;
    const k = DEFAULT_K;

    const a = personaShareTicket(rootA, 0, issuerId, epoch, randomBytes(32), k);
    const b = personaShareTicket(rootB, 0, issuerId, epoch, randomBytes(32), k);
    expect(Buffer.from(a.nullifier).toString('hex'))
      .not.toBe(Buffer.from(b.nullifier).toString('hex'));
    // detectDoubleSpend returns null when nullifiers differ (no collision).
    expect(detectDoubleSpend(a, b)).toBeNull();
  });
});
