import { describe, it, expect } from 'vitest';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { bls12_381 } from '@noble/curves/bls12-381';
import {
  personaRoot,
  MAX_PERSONA_INDEX,
  initialDirectory,
  addPersona,
  removePersona,
  findPersona,
  serializeDirectory,
  deserializeDirectory,
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

// ---------------------------------------------------------------------------
// M11-T1: derivation acceptance
// ---------------------------------------------------------------------------

describe('personaRoot / M11-T1 derivation', () => {
  it('derivation is deterministic — same (root, index) → same key', () => {
    const root = randomBytes(32);
    const a = personaRoot(root, 3);
    const b = personaRoot(root, 3);
    expect(bytesToHex(a.secret)).toBe(bytesToHex(b.secret));
    expect(bytesToHex(a.pubkey)).toBe(bytesToHex(b.pubkey));
  });

  it('siblings are cryptographically unlinkable (distinct keys per index)', () => {
    const root = randomBytes(32);
    const keys = [0, 1, 2, 3, 4, 5].map((i) => personaRoot(root, i));
    const secretHexes = new Set(keys.map((k) => bytesToHex(k.secret)));
    const pubHexes = new Set(keys.map((k) => bytesToHex(k.pubkey)));
    expect(secretHexes.size).toBe(6);
    expect(pubHexes.size).toBe(6);
  });

  it('one root backup re-derives every persona', () => {
    const root = randomBytes(32);
    const before = [0, 1, 5, 42].map((i) => ({
      index: i,
      persona: personaRoot(root, i),
    }));
    // Simulate "wipe device, restore from backup": all we keep is `root`
    // and the persona index list.
    const restored = before.map((b) => ({
      index: b.index,
      persona: personaRoot(root, b.index),
    }));
    for (let i = 0; i < before.length; i++) {
      expect(bytesToHex(restored[i]!.persona.secret)).toBe(bytesToHex(before[i]!.persona.secret));
    }
  });

  it('different roots produce different personas at the same index', () => {
    const rootA = randomBytes(32);
    const rootB = randomBytes(32);
    const a = personaRoot(rootA, 1);
    const b = personaRoot(rootB, 1);
    expect(bytesToHex(a.secret)).not.toBe(bytesToHex(b.secret));
  });

  it('rejects invalid root secret length', () => {
    expect(() => personaRoot(new Uint8Array(31), 0)).toThrow(/root secret must be exactly 32 bytes/);
  });

  it('rejects out-of-range index', () => {
    const root = randomBytes(32);
    expect(() => personaRoot(root, -1)).toThrow(/persona index must be/);
    expect(() => personaRoot(root, MAX_PERSONA_INDEX + 1)).toThrow(/persona index must be/);
    expect(() => personaRoot(root, 1.5)).toThrow(/persona index must be/);
  });
});

// ---------------------------------------------------------------------------
// PersonaDirectory tracking + backup
// ---------------------------------------------------------------------------

describe('PersonaDirectory', () => {
  it('initialDirectory returns just the root persona (index 0)', () => {
    const dir = initialDirectory('main', 1_800_000_000);
    expect(dir.personas).toHaveLength(1);
    expect(dir.personas[0]!.index).toBe(0);
    expect(dir.personas[0]!.label).toBe('main');
  });

  it('addPersona assigns the next unused index and returns the record', () => {
    let dir = initialDirectory();
    const a = addPersona(dir, 'AliceQuiet', 1);
    expect(a.record.index).toBe(1);
    expect(a.record.label).toBe('AliceQuiet');
    dir = a.dir;
    const b = addPersona(dir, 'AliceProfessional', 2);
    expect(b.record.index).toBe(2);
    expect(b.dir.personas).toHaveLength(3);
  });

  it('addPersona fills gaps (removed indexes are re-used)', () => {
    let dir = initialDirectory();
    dir = addPersona(dir, 'A', 1).dir;
    dir = addPersona(dir, 'B', 2).dir;
    dir = removePersona(dir, 1);
    // Now indexes 0 and 2 are used; next add should be 1.
    const next = addPersona(dir, 'C', 3);
    expect(next.record.index).toBe(1);
  });

  it('removePersona refuses to remove the root (index 0)', () => {
    const dir = initialDirectory();
    expect(() => removePersona(dir, 0)).toThrow(/cannot remove the root/);
  });

  it('removePersona errors on missing index', () => {
    const dir = initialDirectory();
    expect(() => removePersona(dir, 42)).toThrow(/not found in directory/);
  });

  it('findPersona returns undefined for missing indexes', () => {
    const dir = initialDirectory();
    expect(findPersona(dir, 0)).toBeDefined();
    expect(findPersona(dir, 99)).toBeUndefined();
  });

  it('serialize → deserialize roundtrip preserves the directory', () => {
    let dir = initialDirectory('main', 1_800_000_000);
    dir = addPersona(dir, 'Quiet', 1_800_000_001).dir;
    dir = addPersona(dir, 'Work', 1_800_000_002).dir;
    const bytes = serializeDirectory(dir);
    const restored = deserializeDirectory(bytes);
    expect(restored).not.toBeNull();
    expect(restored!.personas).toEqual(dir.personas);
  });

  it('deserializeDirectory returns null on malformed input', () => {
    expect(deserializeDirectory(new TextEncoder().encode('nope'))).toBeNull();
    expect(deserializeDirectory(new TextEncoder().encode(JSON.stringify({ v: 999, personas: [] })))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M11-T1: k-show binding — the "no root exceeds k active personas per epoch"
// acceptance
// ---------------------------------------------------------------------------

describe('personaShareTicket / M11-T1 k-bound', () => {
  it('within k personas per (issuer, epoch), share tickets are unlinkable', () => {
    const root = randomBytes(32);
    const issuer = new Uint8Array(32).fill(0x11);
    const epoch = 42;

    // k=3, personas 0..2 → distinct show_indexes 0, 1, 2 → distinct nullifiers.
    const tickets = [0, 1, 2].map((idx) => {
      const challenge = randomBytes(32);
      return personaShareTicket(root, idx, issuer, epoch, challenge, DEFAULT_K);
    });
    const nyms = new Set(tickets.map((t) => bytesToHex(t.nullifier)));
    expect(nyms.size).toBe(3);
  });

  it('the (k+1)th persona forces a nullifier collision — root is recovered', () => {
    const root = randomBytes(32);
    const issuer = new Uint8Array(32).fill(0x22);
    const epoch = 100;

    const k = DEFAULT_K;
    // Personas 0..k-1 use show_indexes 0..k-1.
    const firstK = [0, 1, 2].map((idx) => {
      const challenge = randomBytes(32);
      return personaShareTicket(root, idx, issuer, epoch, challenge, k);
    });

    // The k-th persona (index k) folds to show_index = k mod k = 0,
    // colliding with persona 0's nullifier.
    const overShow = personaShareTicket(root, k, issuer, epoch, randomBytes(32), k);
    expect(Array.from(overShow.nullifier)).toEqual(Array.from(firstK[0]!.nullifier));

    // The M9-T2 trapdoor fires: recover root from the two colliding tickets.
    const recovered = detectDoubleSpend(firstK[0]!, overShow);
    expect(recovered).not.toBeNull();
    expect(toScalar(recovered!)).toBe(toScalar(root));
  });

  it('personas across DIFFERENT epochs do not collide (per-epoch quota resets)', () => {
    const root = randomBytes(32);
    const issuer = new Uint8Array(32).fill(0x33);

    const eA = personaShareTicket(root, 0, issuer, 10, randomBytes(32));
    const eB = personaShareTicket(root, 0, issuer, 11, randomBytes(32));
    expect(bytesToHex(eA.nullifier)).not.toBe(bytesToHex(eB.nullifier));
    expect(detectDoubleSpend(eA, eB)).toBeNull();
  });

  it('personas in DIFFERENT cells do not collide (per-issuer quota)', () => {
    const root = randomBytes(32);
    const cellA = new Uint8Array(32).fill(0xa1);
    const cellB = new Uint8Array(32).fill(0xa2);
    const epoch = 50;

    const inA = personaShareTicket(root, 0, cellA, epoch, randomBytes(32));
    const inB = personaShareTicket(root, 0, cellB, epoch, randomBytes(32));
    expect(bytesToHex(inA.nullifier)).not.toBe(bytesToHex(inB.nullifier));
    expect(detectDoubleSpend(inA, inB)).toBeNull();
  });

  it('personas from DIFFERENT roots do not collide (unlinkable across users)', () => {
    const rootA = randomBytes(32);
    const rootB = randomBytes(32);
    const issuer = new Uint8Array(32).fill(0x44);
    const epoch = 60;

    const a = personaShareTicket(rootA, 0, issuer, epoch, randomBytes(32));
    const b = personaShareTicket(rootB, 0, issuer, epoch, randomBytes(32));
    expect(bytesToHex(a.nullifier)).not.toBe(bytesToHex(b.nullifier));
  });

  it('rejects invalid k', () => {
    const root = randomBytes(32);
    expect(() =>
      personaShareTicket(root, 0, new Uint8Array(32), 0, randomBytes(32), 0),
    ).toThrow(/k must be a positive integer/);
  });

  it('rejects negative or non-integer persona index', () => {
    const root = randomBytes(32);
    expect(() =>
      personaShareTicket(root, -1, new Uint8Array(32), 0, randomBytes(32)),
    ).toThrow(/personaIndex must be a non-negative integer/);
  });
});
