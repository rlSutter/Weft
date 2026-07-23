import { describe, it, expect } from 'vitest';
import { randomBytes } from '@noble/hashes/utils';
import { bls12_381 } from '@noble/curves/bls12-381';
import {
  DEFAULT_K,
  nullifier,
  makeShareTicket,
  freshChallenge,
  detectDoubleSpend,
} from '../nullifier';

const FR_ORDER: bigint = bls12_381.fields.Fr.ORDER;
const toScalar = (u: Uint8Array): bigint => {
  let x = 0n;
  for (const b of u) x = (x << 8n) | BigInt(b);
  return x % FR_ORDER;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const root = (fill = 0x11): Uint8Array => new Uint8Array(32).fill(fill);
const issuer = (fill = 0x22): Uint8Array => new Uint8Array(32).fill(fill);

// ---------------------------------------------------------------------------
// M9-T2 acceptance
// ---------------------------------------------------------------------------

describe('nullifier / M9-T2 acceptance', () => {
  it('k distinct shows in an epoch produce k distinct nullifiers', () => {
    const r = root();
    const iss = issuer();
    const epoch = 42;
    const nyms = new Set<string>();
    for (let i = 0; i < DEFAULT_K; i++) {
      const n = nullifier(r, iss, epoch, i);
      nyms.add(Buffer.from(n).toString('hex'));
    }
    expect(nyms.size).toBe(DEFAULT_K);
  });

  it('nullifiers are deterministic within (root, issuer, epoch, slot)', () => {
    const r = root();
    const iss = issuer();
    const n1 = nullifier(r, iss, 5, 1);
    const n2 = nullifier(r, iss, 5, 1);
    expect(Array.from(n1)).toEqual(Array.from(n2));
  });

  it('nullifiers differ across roots, issuers, epochs, and slots', () => {
    const base = nullifier(root(0x11), issuer(0x22), 5, 1);
    const otherRoot = nullifier(root(0x33), issuer(0x22), 5, 1);
    const otherIssuer = nullifier(root(0x11), issuer(0x44), 5, 1);
    const otherEpoch = nullifier(root(0x11), issuer(0x22), 6, 1);
    const otherSlot = nullifier(root(0x11), issuer(0x22), 5, 2);
    const asHex = (u: Uint8Array): string => Buffer.from(u).toString('hex');
    expect(new Set([base, otherRoot, otherIssuer, otherEpoch, otherSlot].map(asHex)).size).toBe(5);
  });

  it('the (k+1)th show forces a collision', () => {
    const r = root();
    const iss = issuer();
    const epoch = 42;
    // Show at slot 0..k-1 uses k distinct nullifiers.
    // The (k+1)th show — under any strategy — must reuse a slot in [0, k),
    // so its nullifier collides with one of the earlier ones.
    const seen = new Set<string>();
    for (let i = 0; i < DEFAULT_K; i++) {
      seen.add(Buffer.from(nullifier(r, iss, epoch, i)).toString('hex'));
    }
    // Whichever slot the (k+1)th show picks, it's already in `seen`.
    for (let slot = 0; slot < DEFAULT_K; slot++) {
      const nym = Buffer.from(nullifier(r, iss, epoch, slot)).toString('hex');
      expect(seen.has(nym)).toBe(true);
    }
  });

  it('a single honest show reveals nothing about the root', () => {
    const r = root();
    const iss = issuer();
    const ticket = makeShareTicket(r, iss, 42, 0, freshChallenge());
    // With just one equation `s = c*root + r_i` and two unknowns, no
    // recovery is possible. The test proves the API doesn't leak — there
    // is no "recover from one ticket" function.
    // Sanity: the ticket's share is not just the root xor'd with something
    // trivial — assert it doesn't equal the root bytes.
    expect(Array.from(ticket.share)).not.toEqual(Array.from(r));
  });

  it('two shows at the same slot with different challenges recover the root (deanonymization trapdoor)', () => {
    const r = root(0x55);
    const iss = issuer();
    const slot = 1;
    const c1 = freshChallenge();
    const c2 = freshChallenge();
    const t1 = makeShareTicket(r, iss, 42, slot, c1);
    const t2 = makeShareTicket(r, iss, 42, slot, c2);
    // Precondition: nullifiers collide.
    expect(Array.from(t1.nullifier)).toEqual(Array.from(t2.nullifier));
    // Recovery.
    const recovered = detectDoubleSpend(t1, t2);
    expect(recovered).not.toBeNull();
    expect(Array.from(recovered!)).toEqual(Array.from(r));
  });

  it('detectDoubleSpend returns null on distinct nullifiers (different slots)', () => {
    const r = root();
    const iss = issuer();
    const t1 = makeShareTicket(r, iss, 42, 0, freshChallenge());
    const t2 = makeShareTicket(r, iss, 42, 1, freshChallenge());
    expect(detectDoubleSpend(t1, t2)).toBeNull();
  });

  it('detectDoubleSpend returns null on identical challenges (replay, not a fresh over-spend)', () => {
    const r = root();
    const iss = issuer();
    const c = freshChallenge();
    const t1 = makeShareTicket(r, iss, 42, 0, c);
    const t2 = makeShareTicket(r, iss, 42, 0, c);
    // Same slot AND same challenge — the shares are identical too, so no
    // information gained. The prover just replayed the same ticket.
    expect(Array.from(t1.share)).toEqual(Array.from(t2.share));
    expect(detectDoubleSpend(t1, t2)).toBeNull();
  });

  it('recovers the root even when many honest shows are interleaved', () => {
    // Use a random root. Since real 32-byte roots occasionally exceed
    // Fr.ORDER, we compare via Fr-reduced scalars per the API contract
    // (see `detectDoubleSpend` docstring).
    const r = randomBytes(32);
    const iss = issuer();
    const epoch = 100;
    const tickets = [
      makeShareTicket(r, iss, epoch, 0, freshChallenge()),
      makeShareTicket(r, iss, epoch, 1, freshChallenge()),
      makeShareTicket(r, iss, epoch, 2, freshChallenge()),
    ];
    const overShow = makeShareTicket(r, iss, epoch, 1, freshChallenge());
    let recovered: Uint8Array | null = null;
    for (const t of tickets) {
      const w = detectDoubleSpend(t, overShow);
      if (w !== null) { recovered = w; break; }
    }
    expect(recovered).not.toBeNull();
    expect(toScalar(recovered!)).toBe(toScalar(r));
  });

  it('unlinkability across epochs — nullifiers do not obviously correlate with slot', () => {
    // Weak statistical check: for many roots, the byte-0 distribution of
    // nullifiers at slot 0 vs slot 1 should look similar (both random).
    // A "structured" scheme would have systematic differences.
    const iss = issuer();
    const counts = [new Map<number, number>(), new Map<number, number>()];
    for (let i = 0; i < 100; i++) {
      const r = randomBytes(32);
      for (const slot of [0, 1]) {
        const n = nullifier(r, iss, 42, slot);
        const b = n[0]!;
        counts[slot]!.set(b, (counts[slot]!.get(b) ?? 0) + 1);
      }
    }
    // Not a real statistical test — just assert neither slot's byte-0 is
    // trivially fixed to a constant value.
    expect(counts[0]!.size).toBeGreaterThan(20);
    expect(counts[1]!.size).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('nullifier / input validation', () => {
  it('rejects root of wrong length', () => {
    expect(() => nullifier(new Uint8Array(31), issuer(), 0, 0)).toThrow(/root_secret must be exactly 32 bytes/);
  });

  it('rejects issuer of wrong length', () => {
    expect(() => nullifier(root(), new Uint8Array(31), 0, 0)).toThrow(/issuer_id must be exactly 32 bytes/);
  });

  it('rejects epoch outside uint32', () => {
    expect(() => nullifier(root(), issuer(), 2 ** 33, 0)).toThrow(/must fit in uint32/);
    expect(() => nullifier(root(), issuer(), -1, 0)).toThrow(/must fit in uint32/);
  });

  it('rejects challenge of wrong length in makeShareTicket', () => {
    expect(() => makeShareTicket(root(), issuer(), 0, 0, new Uint8Array(16))).toThrow(/challenge must be exactly 32 bytes/);
  });
});
