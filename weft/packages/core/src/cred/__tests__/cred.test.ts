import { describe, it, expect } from 'vitest';
import { randomBytes } from '@noble/hashes/utils';
import {
  generateIssuerKeypair,
  requestCredential,
  issueCredential,
  verifyCredential,
  presentCredential,
  verifyPresentation,
  generateHolderSecrets,
  backupForCell,
  restoreFromBackup,
  dropForCellOnLeave,
  CLEARTEXT_ATTR_COUNT,
  type CleartextAttrs,
} from '../cred';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeCleartext(overrides: Partial<CleartextAttrs> = {}): CleartextAttrs {
  return {
    tier: 2,
    ctx: 'fermentation',
    issued_epoch: 42,
    expiry_epoch: 46,
    issuer_scope_tag: new Uint8Array(32).fill(7),
    ...overrides,
  };
}

const challenge = (): Uint8Array => randomBytes(16);
const scope = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

async function issueAndVerify(): Promise<{
  issuer: { secretKey: Uint8Array; publicKey: Uint8Array };
  cred: Awaited<ReturnType<typeof issueCredential>>;
  state: Awaited<ReturnType<typeof requestCredential>>['state'];
}> {
  const issuer = await generateIssuerKeypair();
  const { request, state } = await requestCredential(makeCleartext());
  const cred = await issueCredential(request, issuer.secretKey, issuer.publicKey);
  const ok = await verifyCredential(cred, state);
  expect(ok).toBe(true);
  return { issuer, cred, state };
}

// ---------------------------------------------------------------------------
// M9-T1 acceptance — issue / verify / present / verifyPresentation roundtrips
// ---------------------------------------------------------------------------

describe('cred / M9-T1 acceptance', () => {
  it('issue → verify roundtrip (populates nymSecret)', async () => {
    const issuer = await generateIssuerKeypair();
    const { request, state } = await requestCredential(makeCleartext());
    const cred = await issueCredential(request, issuer.secretKey, issuer.publicKey);

    expect(cred.signature).toBeInstanceOf(Uint8Array);
    expect(cred.signature.length).toBeGreaterThan(0);
    expect(typeof cred.signerNymEntropy).toBe('bigint');
    expect(cred.signerNymEntropy).toBeGreaterThan(0n);
    expect(state.nymSecret).toBeUndefined();

    const ok = await verifyCredential(cred, state);
    expect(ok).toBe(true);
    expect(state.nymSecret).toBeDefined();
    expect(typeof state.nymSecret).toBe('bigint');
  });

  it('a presentation disclosing only `tier` verifies without revealing other attributes', async () => {
    const { issuer, cred, state } = await issueAndVerify();
    const p = await presentCredential(cred, state, [0], scope(0x11), challenge());
    expect(p.disclosedIndexes).toEqual([0]);
    expect(p.disclosedMessages[0]).toEqual(Uint8Array.of(cred.cleartext.tier));
    expect(verifyPresentation(p, issuer.publicKey)).toBe(true);
  });

  it('a tampered presentation fails', async () => {
    const { issuer, cred, state } = await issueAndVerify();
    const p = await presentCredential(cred, state, [0, 4], scope(0x11), challenge());
    const tampered = new Uint8Array(p.proof);
    const mid = Math.floor(tampered.length / 2);
    tampered[mid] = tampered[mid]! ^ 0x01;
    let ok: boolean;
    try {
      ok = verifyPresentation({ ...p, proof: tampered }, issuer.publicKey);
    } catch {
      ok = false;
    }
    expect(ok).toBe(false);
  });

  it('unlinkability — two presentations of one credential (same scope) share no correlatable proof bytes', async () => {
    const { issuer, cred, state } = await issueAndVerify();
    const s = scope(0x11);
    const p1 = await presentCredential(cred, state, [0], s, challenge());
    const p2 = await presentCredential(cred, state, [0], s, challenge());
    // Proofs are randomized: bytewise differ.
    expect(Array.from(p1.proof)).not.toEqual(Array.from(p2.proof));
    // Both verify.
    expect(verifyPresentation(p1, issuer.publicKey)).toBe(true);
    expect(verifyPresentation(p2, issuer.publicKey)).toBe(true);
  });

  it('blindness — the issuer never sees subject_secret or prover_nym', async () => {
    const secrets = generateHolderSecrets();
    const { request, state } = await requestCredential(makeCleartext(), secrets);
    // The only holder-derived input the issuer sees is commitmentWithProof.
    // Neither the raw subject_secret bytes nor the prover_nym scalar bytes
    // should appear as a contiguous substring.
    const issuerView = request.commitmentWithProof;
    expect(containsSubarray(issuerView, secrets.subject_secret)).toBe(false);
    // Serialize proverNym to bytes for the check.
    const proverNymBytes = new Uint8Array(32);
    let x = state.proverNym;
    for (let i = 31; i >= 0; i--) {
      proverNymBytes[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    expect(containsSubarray(issuerView, proverNymBytes)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M9-T3 acceptance — scope_nym properties
// ---------------------------------------------------------------------------

describe('cred / M9-T3 acceptance', () => {
  it('determinism within scope — same credential + same scope → same pseudonym', async () => {
    const { issuer, cred, state } = await issueAndVerify();
    const s = scope(0xa1);
    const p1 = await presentCredential(cred, state, [], s, challenge());
    const p2 = await presentCredential(cred, state, [], s, challenge());
    // Same scope → same pseudonym (this is what makes ejection stick).
    expect(Array.from(p1.pseudonym)).toEqual(Array.from(p2.pseudonym));
    // Both verify.
    expect(verifyPresentation(p1, issuer.publicKey)).toBe(true);
    expect(verifyPresentation(p2, issuer.publicKey)).toBe(true);
  });

  it('cross-scope unlinkability — different scopes yield different pseudonyms', async () => {
    const { cred, state } = await issueAndVerify();
    const p1 = await presentCredential(cred, state, [], scope(0xa1), challenge());
    const p2 = await presentCredential(cred, state, [], scope(0xa2), challenge());
    expect(Array.from(p1.pseudonym)).not.toEqual(Array.from(p2.pseudonym));
  });

  it('cross-holder unlinkability — different credentials in the same scope yield different pseudonyms', async () => {
    const issuer = await generateIssuerKeypair();
    const s = scope(0xb0);

    const a = await requestCredential(makeCleartext());
    const credA = await issueCredential(a.request, issuer.secretKey, issuer.publicKey);
    await verifyCredential(credA, a.state);
    const pA = await presentCredential(credA, a.state, [], s, challenge());

    const b = await requestCredential(makeCleartext());
    const credB = await issueCredential(b.request, issuer.secretKey, issuer.publicKey);
    await verifyCredential(credB, b.state);
    const pB = await presentCredential(credB, b.state, [], s, challenge());

    expect(Array.from(pA.pseudonym)).not.toEqual(Array.from(pB.pseudonym));
    // Both verify against the same issuer.
    expect(verifyPresentation(pA, issuer.publicKey)).toBe(true);
    expect(verifyPresentation(pB, issuer.publicKey)).toBe(true);
  });

  it('binding — a party lacking nymSecret cannot produce a valid presentation', async () => {
    const { issuer, cred, state } = await issueAndVerify();
    // Simulate an attacker who has the credential (they intercepted it) but
    // no HolderState — they cannot make a presentation the verifier accepts.
    const forgedState = {
      secrets: { subject_secret: randomBytes(32) },
      proverNym: 1234567890n,
      secretProverBlind: 987654321n,
      nymSecret: 111222333n, // wrong value
    };
    let forgedOk = false;
    try {
      const p = await presentCredential(cred, forgedState, [0], scope(0x11), challenge());
      forgedOk = verifyPresentation(p, issuer.publicKey);
    } catch {
      forgedOk = false;
    }
    expect(forgedOk).toBe(false);
    void state; // keep unused var warning quiet
  });

  it('a presentation missing verifyCredential first throws', async () => {
    const issuer = await generateIssuerKeypair();
    const { request, state } = await requestCredential(makeCleartext());
    const cred = await issueCredential(request, issuer.secretKey, issuer.publicKey);
    // Note: no verifyCredential call — nymSecret not populated.
    await expect(
      presentCredential(cred, state, [0], scope(0x11), challenge()),
    ).rejects.toThrow(/HolderState\.nymSecret is undefined/);
  });

  it('backup roundtrip — restoreFromBackup produces a working HolderState', async () => {
    const { issuer, cred, state } = await issueAndVerify();
    const s = scope(0xc0);
    const backup = backupForCell(s, cred, state);
    const restored = restoreFromBackup(backup);
    // Present with the restored state — should verify and produce the same
    // pseudonym as the original.
    const pOrig = await presentCredential(cred, state, [], s, challenge());
    const pRestored = await presentCredential(cred, restored, [], s, challenge());
    expect(Array.from(pRestored.pseudonym)).toEqual(Array.from(pOrig.pseudonym));
    expect(verifyPresentation(pRestored, issuer.publicKey)).toBe(true);
  });

  it('dropForCellOnLeave removes the target scope and only the target scope', async () => {
    const { cred, state } = await issueAndVerify();
    const s1 = scope(0xd1);
    const s2 = scope(0xd2);
    const records = [backupForCell(s1, cred, state), backupForCell(s2, cred, state)];
    const remaining = dropForCellOnLeave(records, s1);
    expect(remaining).toHaveLength(1);
    expect(Array.from(remaining[0]!.scopeId)).toEqual(Array.from(s2));
  });
});

// ---------------------------------------------------------------------------
// Guardrails — defensive input validation
// ---------------------------------------------------------------------------

describe('cred / input validation', () => {
  it('rejects tier outside {1,2,3}', async () => {
    await expect(
      requestCredential(makeCleartext({ tier: 4 as unknown as 1 })),
    ).rejects.toThrow(/tier must be 1, 2, or 3/);
  });

  it('rejects ctx > 32 bytes', async () => {
    await expect(
      requestCredential(makeCleartext({ ctx: 'x'.repeat(33) })),
    ).rejects.toThrow(/ctx must be/);
  });

  it('rejects issuer_scope_tag of wrong length', async () => {
    await expect(
      requestCredential(makeCleartext({ issuer_scope_tag: new Uint8Array(31) })),
    ).rejects.toThrow(/issuer_scope_tag must be exactly 32 bytes/);
  });

  it('rejects disclosed index out of range', async () => {
    const { cred, state } = await issueAndVerify();
    await expect(
      presentCredential(cred, state, [CLEARTEXT_ATTR_COUNT], scope(0x11), challenge()),
    ).rejects.toThrow(/disclosedIndex out of range/);
  });
});

// ---------------------------------------------------------------------------
// Helper: contiguous-subarray search
// ---------------------------------------------------------------------------

function containsSubarray(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  if (needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
