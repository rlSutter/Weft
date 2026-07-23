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

// Fresh challenge — verifiers generate these per presentation.
const challenge = (): Uint8Array => randomBytes(16);

// ---------------------------------------------------------------------------
// M9-T1 acceptance — issue/verify roundtrip
// ---------------------------------------------------------------------------

describe('cred / M9-T1 acceptance', () => {
  it('issue → verify roundtrip', async () => {
    const issuer = await generateIssuerKeypair();
    const cleartext = makeCleartext();
    const { request, state } = await requestCredential(cleartext);
    const cred = await issueCredential(request, issuer.secretKey, issuer.publicKey);

    expect(cred.signature).toBeInstanceOf(Uint8Array);
    expect(cred.signature.length).toBeGreaterThan(0);
    expect(cred.issuerPubkey).toEqual(issuer.publicKey);

    const ok = await verifyCredential(cred, state);
    expect(ok).toBe(true);
  });

  it('a presentation disclosing only `tier` verifies without revealing other attributes', async () => {
    const issuer = await generateIssuerKeypair();
    const cleartext = makeCleartext();
    const { request, state } = await requestCredential(cleartext);
    const cred = await issueCredential(request, issuer.secretKey, issuer.publicKey);

    const ph = challenge();
    const presentation = await presentCredential(cred, state, [0], ph);

    expect(presentation.disclosedIndexes).toEqual([0]);
    expect(presentation.disclosedMessages).toHaveLength(1);
    expect(presentation.disclosedMessages[0]).toEqual(Uint8Array.of(cleartext.tier));

    const ok = await verifyPresentation(presentation, issuer.publicKey);
    expect(ok).toBe(true);
  });

  it('a tampered presentation fails', async () => {
    const issuer = await generateIssuerKeypair();
    const { request, state } = await requestCredential(makeCleartext());
    const cred = await issueCredential(request, issuer.secretKey, issuer.publicKey);

    const ph = challenge();
    const presentation = await presentCredential(cred, state, [0, 4], ph);

    // Flip one bit in the middle of the proof.
    const tampered = new Uint8Array(presentation.proof);
    const midIndex = Math.floor(tampered.length / 2);
    tampered[midIndex] = tampered[midIndex]! ^ 0x01;

    let result: boolean;
    try {
      result = await verifyPresentation({ ...presentation, proof: tampered }, issuer.publicKey);
    } catch {
      // Some tamperings throw (malformed group element); that also counts as "fails".
      result = false;
    }
    expect(result).toBe(false);
  });

  it('unlinkability — two presentations of one credential share no correlatable field', async () => {
    const issuer = await generateIssuerKeypair();
    const { request, state } = await requestCredential(makeCleartext());
    const cred = await issueCredential(request, issuer.secretKey, issuer.publicKey);

    // Same disclosure set, same challenge — the presentations should still
    // differ (BBS proofs are randomized so honest re-presentations don't leak
    // a linkage).
    const ph = challenge();
    const p1 = await presentCredential(cred, state, [0], ph);
    const p2 = await presentCredential(cred, state, [0], ph);

    // The proof bytes differ across presentations.
    expect(Array.from(p1.proof)).not.toEqual(Array.from(p2.proof));

    // Both verify.
    expect(await verifyPresentation(p1, issuer.publicKey)).toBe(true);
    expect(await verifyPresentation(p2, issuer.publicKey)).toBe(true);
  });

  it('blindness — the issuer never sees k_cred or subject_secret', async () => {
    const secrets = generateHolderSecrets();
    const { request } = await requestCredential(makeCleartext(), secrets);

    // Concatenate every byte the issuer sees at request time. `commitmentWithProof`
    // is the only holder-derived input; the cleartext attributes are chosen by
    // the issuer or agreed publicly, so they don't count as "the issuer's view
    // of the secrets" here.
    const issuerView = request.commitmentWithProof;

    // If k_cred appeared as a contiguous 32-byte substring, the commitment would
    // leak it. Same for subject_secret. BBS commitments are randomized group
    // elements, so the raw secrets must never appear.
    expect(containsSubarray(issuerView, secrets.k_cred)).toBe(false);
    expect(containsSubarray(issuerView, secrets.subject_secret)).toBe(false);
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
    const issuer = await generateIssuerKeypair();
    const { request, state } = await requestCredential(makeCleartext());
    const cred = await issueCredential(request, issuer.secretKey, issuer.publicKey);
    await expect(
      presentCredential(cred, state, [CLEARTEXT_ATTR_COUNT], challenge()),
    ).rejects.toThrow(/disclosedIndex out of range/);
  });
});

// ---------------------------------------------------------------------------
// Helper: contiguous-subarray search (byte-level)
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
