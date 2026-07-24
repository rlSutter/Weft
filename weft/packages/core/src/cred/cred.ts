// Weft credential engine — anonymous vouches over BBS/BLS12-381 with
// per-verifier pseudonyms (IETF blind-BBS + pseudonym drafts).
//
// Sources of law:
//   DD §36.1        credential attributes, blind issuance, k_cred lifecycle,
//                   scope_nym = PRF(k_cred, scope_id)
//   DD §36.1 amendment (2026-07-19)  scope_nym as credential-bound nullifier
//   DD §36.2        greeter blind issuance
//   Build list M9-T1 (issue/verify/present), M9-T3 (scope_nym)
//
// One rule: no hand-rolled crypto. Everything BBS/pseudonym-BBS goes through
// @digitalbazaar/bbs-signatures (via the rlSutter fork — upstream PR #22
// adds the blind + pseudonym subpath exports).
//
// **Every Weft credential is pseudonym-capable by construction.** Even
// presentations that don't semantically need a scope_nym still ride the
// pseudonym-BBS variant, so groups (M10) and rendezvous (M12) can produce
// scope_nyms without a second credential type. The library's `context_id`
// is DD's `scope_id`; the library's `pseudonym` is DD's `scope_nym`.
//
// **Blind issuance holds** — `subject_secret` and the holder's `prover_nym`
// (their piece of the eventual `nym_secret`) are never bytes the issuer sees.
// The issuer contributes `signer_nym_entropy`, and the final `nym_secret` is
// jointly derived. This is exactly what the greeter-blind-issuance property
// (DD §36.2, F7-group-layer) needs on the group join path.

import {
  generateKeyPair as bbsGenerateKeyPair,
  CIPHERSUITES,
  NymCommit,
  BlindSignWithNym,
  BlindVerifyWithNym,
  ProofGenWithPseudonym,
  ProofVerifyWithPseudonym,
} from './bbs';
import { bls12_381 } from '@noble/curves/bls12-381';
import { randomBytes } from '@noble/hashes/utils';

/** Ciphersuite Weft pins for the alpha (per DD §36.1 — BLS12-381, SHA-256). */
export const WEFT_CIPHERSUITE = CIPHERSUITES.BLS12381_SHA256;

/** Length of a `scope_nym` (a.k.a. pseudonym) in bytes: BLS12-381 G1 compressed. */
export const SCOPE_NYM_BYTES = 48;

/**
 * Blind-BBS api_id, precomputed. Passed to every Commit/BlindSign/etc. call
 * to work around an upstream ordering bug: the blind functions compute their
 * default api_id before resolving the ciphersuite string to an object, so
 * leaving it undefined yields an api_id derived from `undefined.ciphersuite_id`.
 * NymCommit orders these correctly; the two defaults disagree.
 *
 * Fix pending upstream (see rlSutter/bbs-signatures fork). Here we always
 * pass an explicit api_id so both call sites agree regardless.
 *
 * The pseudonym subpath uses a **different** default api_id
 * (PSEUDONYM_H2G_HM2S_ vs BLIND_H2G_HM2S_) — so we need two constants, one
 * for the blind primitives (currently unused by cred.ts after refactor) and
 * one for the pseudonym primitives (used everywhere here).
 */
const BBS_BLS12381G1_XMD_SHA256_ID = 'BBS_BLS12381G1_XMD:SHA-256_SSWU_RO_';
const PSEUDONYM_API_SUFFIX = 'H2G_HM2S_PSEUDONYM_';
const BBS_PSEUDONYM_API_ID: Uint8Array = new TextEncoder().encode(
  BBS_BLS12381G1_XMD_SHA256_ID + PSEUDONYM_API_SUFFIX,
);

/**
 * Domain-separator header used on every Weft credential signature.
 * Prevents cross-protocol reuse of a Weft credential (e.g., as a VC in
 * another BBS-consuming system). Bump this string when the credential
 * attribute schema below changes.
 */
export const WEFT_CRED_HEADER = new TextEncoder().encode('weft-v2/vouch-cred/1');

/** Number of cleartext attribute fields (see `CleartextAttrs` below). */
export const CLEARTEXT_ATTR_COUNT = 5;

/** Number of holder-committed attribute fields (see `HolderSecrets`). */
export const COMMITTED_ATTR_COUNT = 1;

// ---------------------------------------------------------------------------
// Attribute schema (WIRE — do not reorder without a version bump)
// ---------------------------------------------------------------------------

/**
 * The five cleartext attributes the issuer signs, in fixed order.
 * Order is part of the wire format: BBS signs messages by index.
 */
export interface CleartextAttrs {
  /** 1 | 2 | 3 — encoded as a single byte. */
  tier: 1 | 2 | 3;
  /** Context code (short ASCII, up to 32 bytes). */
  ctx: string;
  /** Epoch (uint32) when the credential was issued, big-endian 4 bytes. */
  issued_epoch: number;
  /** Epoch (uint32) after which the credential is invalid, big-endian 4 bytes. */
  expiry_epoch: number;
  /**
   * Opaque tag identifying the issuer's *set* — cell or region — without
   * identifying the issuer itself. 32 bytes (hash of the scope's charter id
   * per DD §36.1). Verifiers filter presentations by this tag.
   */
  issuer_scope_tag: Uint8Array;
}

/**
 * One secret the holder commits to at credential-request time. The issuer
 * never sees this in the clear — blindness is the load-bearing property
 * DD §36.1 depends on.
 *
 * Note: the earlier draft had a separate `k_cred` here; that role is now
 * fulfilled by `prover_nym` (a bigint field of the credential-request
 * object) plus the joint `nym_secret` computed at verify time. Only
 * `subject_secret` remains as a plain committed attribute — its purpose is
 * to bind future credentials to the same underlying subject without leaking
 * which subject.
 */
export interface HolderSecrets {
  /**
   * 32-byte binding to the holder's root — a random value the holder picks
   * and keeps to prove "I am the same subject" across credentials. The DD
   * calls this `subject_commitment`; the library commits it for us as a
   * committed message.
   */
  subject_secret: Uint8Array;
}

// ---------------------------------------------------------------------------
// Wire types (opaque bundles — treat as byte blobs)
// ---------------------------------------------------------------------------

/**
 * The bundle a holder sends to an issuer to request a credential. The
 * `commitmentWithProof` is the library's opaque commitment-plus-ZK-proof
 * over the holder's `subject_secret` and `prover_nym`; the issuer verifies
 * the proof, signs it alongside the cleartext attributes AND contributes
 * `signer_nym_entropy` bytes that combine with the holder's `prover_nym`
 * to form the final `nym_secret`.
 *
 * **Blindness guarantee**: `subject_secret` and `prover_nym` do not appear
 * as bytes inside `commitmentWithProof` — the acceptance test asserts this.
 */
export interface CredentialRequest {
  commitmentWithProof: Uint8Array;
  cleartext: CleartextAttrs;
}

/**
 * State the holder must retain locally to later present the credential and
 * derive per-scope pseudonyms.
 *
 * `proverNym` and `secretProverBlind` are needed for `verifyCredential`
 * (to reconstruct `nymSecret`); `nymSecret` alone is enough for future
 * presentations. Losing any of these renders the credential unpresentable —
 * the encrypted backup blob (DD §9.2) MUST include the full HolderState for
 * currently-held credentials.
 */
export interface HolderState {
  secrets: HolderSecrets;
  /** Holder's contribution to the joint nym derivation (32-byte scalar). */
  proverNym: bigint;
  secretProverBlind: bigint;
  /**
   * Combined nym_secret = f(proverNym, signerNymEntropy). Undefined until
   * `verifyCredential` has been called with the freshly issued credential.
   * This IS the `k_cred` from DD §36.1's perspective.
   */
  nymSecret?: bigint;
}

/**
 * A signed credential in transit from issuer back to holder. The issuer
 * publishes nothing — the whole object is wrapped (kind 1059) and
 * delivered peer-to-peer. Persisted only in the holder's local store.
 *
 * `signerNymEntropy` is the issuer's contribution to the joint nym
 * derivation (an Fr scalar); the holder needs it to reconstruct
 * `nymSecret` in `verifyCredential`.
 */
export interface Credential {
  signature: Uint8Array;
  cleartext: CleartextAttrs;
  issuerPubkey: Uint8Array;
  signerNymEntropy: bigint;
}

/**
 * A zero-knowledge presentation of a credential bound to a specific scope.
 * Reveals only the disclosed cleartext attributes plus the scope-derived
 * `pseudonym`. Unlinkable across different `scopeId`s of the same
 * credential; **deterministic** within the same `scopeId` (that's exactly
 * the ejection-sticks property DD §36.1 needs — the ejected member's
 * pseudonym is fixed and known-blocked).
 */
export interface Presentation {
  proof: Uint8Array;
  disclosedIndexes: number[];
  disclosedMessages: Uint8Array[];
  header: Uint8Array;
  /** Verifier-chosen nonce that prevents replay of a captured presentation. */
  presentationHeader: Uint8Array;
  /** The scope_id this presentation is bound to (== `context_id`). */
  scopeId: Uint8Array;
  /** The derived `scope_nym` — reveal-per-scope pseudonym. */
  pseudonym: Uint8Array;
}

// ---------------------------------------------------------------------------
// Attribute encoding — kept private, mechanical
// ---------------------------------------------------------------------------

function encodeCleartextAttrs(a: CleartextAttrs): Uint8Array[] {
  if (a.tier !== 1 && a.tier !== 2 && a.tier !== 3) {
    throw new Error(`tier must be 1, 2, or 3 (got ${String(a.tier)})`);
  }
  const ctxBytes = new TextEncoder().encode(a.ctx);
  if (ctxBytes.length > 32) throw new Error(`ctx must be ≤32 bytes (got ${ctxBytes.length})`);
  if (a.issuer_scope_tag.length !== 32) {
    throw new Error(`issuer_scope_tag must be exactly 32 bytes (got ${a.issuer_scope_tag.length})`);
  }
  if (!Number.isInteger(a.issued_epoch) || a.issued_epoch < 0 || a.issued_epoch > 0xffff_ffff) {
    throw new Error(`issued_epoch must fit in uint32`);
  }
  if (!Number.isInteger(a.expiry_epoch) || a.expiry_epoch < 0 || a.expiry_epoch > 0xffff_ffff) {
    throw new Error(`expiry_epoch must fit in uint32`);
  }
  const u32BE = (n: number): Uint8Array =>
    Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  return [
    Uint8Array.of(a.tier),        // index 0
    ctxBytes,                     // index 1
    u32BE(a.issued_epoch),        // index 2
    u32BE(a.expiry_epoch),        // index 3
    a.issuer_scope_tag,           // index 4
  ];
}

function encodeCommittedSecrets(s: HolderSecrets): Uint8Array[] {
  if (s.subject_secret.length !== 32) {
    throw new Error(`subject_secret must be exactly 32 bytes (got ${s.subject_secret.length})`);
  }
  return [s.subject_secret];
}

/**
 * Convert a 32-byte issuer secret key (as bytes) into the BBS scalar
 * (`bigint mod r`) the library's BlindSignWithNym takes.
 *
 * The base `sign()` accepts Uint8Array and does this internally via
 * `os2ip(secretKey, octet_scalar_length)` — **big-endian** by RFC 3447
 * convention. The blind/pseudonym variants do not do this conversion, so we
 * do it here, matching the library's os2ip exactly (noble's Fr.fromBytes is
 * little-endian, so we can't use it here).
 */
function skBytesToScalar(sk: Uint8Array): bigint {
  if (sk.length !== 32) throw new Error(`issuer SK must be 32 bytes (got ${sk.length})`);
  let x = 0n;
  for (const b of sk) x = (x << 8n) | BigInt(b);
  const scalar = x % bls12_381.fields.Fr.ORDER;
  if (scalar === 0n) throw new Error('issuer SK reduces to 0 mod r — invalid');
  return scalar;
}

/** Generate a fresh 32-byte scalar in Fr (uniformly, without bias). */
function freshFrScalar(): bigint {
  // Rejection sampling: draw random 32-byte values and take the first that
  // reduces to a non-zero, in-range scalar. Fr fits in a 32-byte value with
  // ~half of the 2^256 range falling into [0, r), so a couple of draws
  // suffices in practice. Bias-free.
  const r = bls12_381.fields.Fr.ORDER;
  for (let i = 0; i < 32; i++) {
    let x = 0n;
    for (const b of randomBytes(32)) x = (x << 8n) | BigInt(b);
    if (x < r && x !== 0n) return x;
  }
  // Absurdly improbable; guard against it anyway.
  throw new Error('freshFrScalar exhausted retries');
}

// ---------------------------------------------------------------------------
// Public API — issuer-side
// ---------------------------------------------------------------------------

/**
 * Generate a fresh issuer keypair. Called once by a cell steward when the
 * cell is created; the public key is written into the charter (DD §36.2)
 * so anyone can verify credentials this cell issues.
 */
export async function generateIssuerKeypair(): Promise<{
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}> {
  return bbsGenerateKeyPair({ ciphersuite: WEFT_CIPHERSUITE });
}

/**
 * Issuer signs the credential.
 *
 * The issuer sees:
 *   - `request.commitmentWithProof` (opaque; the library ZK-verifies it
 *     internally on the holder's behalf)
 *   - `request.cleartext` (tier, ctx, epochs, issuer_scope_tag)
 *
 * The issuer never sees `subject_secret` or the holder's `prover_nym`.
 * The issuer *does* contribute `signer_nym_entropy` bytes (returned
 * alongside the signature) that combine with `prover_nym` to form the
 * final `nym_secret` — this makes the pseudonym derivable neither by the
 * issuer alone nor by the holder alone before issuance.
 */
export async function issueCredential(
  request: CredentialRequest,
  issuerSecretKey: Uint8Array,
  issuerPublicKey: Uint8Array,
): Promise<Credential> {
  const SK = skBytesToScalar(issuerSecretKey);
  const messages = encodeCleartextAttrs(request.cleartext);
  const signerNymEntropy = freshFrScalar();
  const signature = await BlindSignWithNym({
    SK,
    PK: issuerPublicKey,
    commitment_with_proof: request.commitmentWithProof,
    header: WEFT_CRED_HEADER,
    messages,
    signer_nym_entropy: signerNymEntropy,
    api_id: BBS_PSEUDONYM_API_ID,
    ciphersuite: WEFT_CIPHERSUITE,
  });
  return {
    signature,
    cleartext: request.cleartext,
    issuerPubkey: issuerPublicKey,
    signerNymEntropy,
  };
}

// ---------------------------------------------------------------------------
// Public API — holder-side
// ---------------------------------------------------------------------------

/**
 * Generate a fresh HolderSecrets bundle. Called once at credential-request
 * time; kept per-credential thereafter (DD §36.1 k_cred lifecycle — see
 * lifecycle helpers below).
 */
export function generateHolderSecrets(): HolderSecrets {
  return { subject_secret: randomBytes(32) };
}

/**
 * Holder builds a credential request. Retains `HolderState` (the holder's
 * `proverNym`, the commit's `secretProverBlind`, and the secrets) — without
 * it, later present() and verify() calls fail.
 */
export async function requestCredential(
  cleartext: CleartextAttrs,
  secrets: HolderSecrets = generateHolderSecrets(),
): Promise<{ request: CredentialRequest; state: HolderState }> {
  encodeCleartextAttrs(cleartext); // validate schema eagerly
  const committed = encodeCommittedSecrets(secrets);
  const proverNym = freshFrScalar();
  const { commitment_with_proof, secret_prover_blind } = await NymCommit({
    prover_nym: proverNym,
    committed_messages: committed,
    api_id: BBS_PSEUDONYM_API_ID,
    ciphersuite: WEFT_CIPHERSUITE,
  });
  return {
    request: { commitmentWithProof: commitment_with_proof, cleartext },
    state: {
      secrets,
      proverNym,
      secretProverBlind: secret_prover_blind,
    },
  };
}

/**
 * Holder verifies a freshly-issued credential is signed correctly by the
 * expected issuer, binds to their held secrets, AND derives the joint
 * `nymSecret`. Mutates `state` to record `nymSecret`. Returns true iff
 * verification passed.
 */
export async function verifyCredential(cred: Credential, state: HolderState): Promise<boolean> {
  const { verified, nym_secret } = await BlindVerifyWithNym({
    PK: cred.issuerPubkey,
    signature: cred.signature,
    header: WEFT_CRED_HEADER,
    messages: encodeCleartextAttrs(cred.cleartext),
    committed_messages: encodeCommittedSecrets(state.secrets),
    prover_nym: state.proverNym,
    signer_nym_entropy: cred.signerNymEntropy,
    secret_prover_blind: state.secretProverBlind,
    api_id: BBS_PSEUDONYM_API_ID,
    ciphersuite: WEFT_CIPHERSUITE,
  });
  if (verified) {
    state.nymSecret = nym_secret;
  }
  return verified;
}

/**
 * Holder produces a zero-knowledge presentation of the credential bound
 * to a specific scope. The returned `Presentation` carries a `pseudonym`
 * = the credential's `scope_nym` for the given `scopeId`.
 *
 * Determinism: same credential + same `scopeId` → same `pseudonym`. This
 * is exactly what enforces "ejection sticks" (DD §36.2 §7-groups) — the
 * ejected member's pseudonym is fixed and the group's roster remembers it.
 *
 * Cross-scope unlinkability: two presentations of the same credential
 * against different `scopeId`s produce pseudonyms indistinguishable to
 * observers under standard PRF assumptions (see M9-T3 acceptance test).
 *
 * `verifyCredential` must have been called on this credential + state
 * first (to populate `state.nymSecret`).
 */
export async function presentCredential(
  cred: Credential,
  state: HolderState,
  disclosedIndexes: number[],
  scopeId: Uint8Array,
  presentationHeader: Uint8Array,
): Promise<Presentation> {
  if (state.nymSecret === undefined) {
    throw new Error(
      'HolderState.nymSecret is undefined — call verifyCredential first',
    );
  }
  for (const i of disclosedIndexes) {
    if (!Number.isInteger(i) || i < 0 || i >= CLEARTEXT_ATTR_COUNT) {
      throw new Error(`disclosedIndex out of range [0, ${CLEARTEXT_ATTR_COUNT}): ${i}`);
    }
  }
  const messages = encodeCleartextAttrs(cred.cleartext);
  const committed = encodeCommittedSecrets(state.secrets);
  const sortedIdx = [...disclosedIndexes].sort((a, b) => a - b);
  const { proof, pseudonym } = await ProofGenWithPseudonym({
    PK: cred.issuerPubkey,
    signature: cred.signature,
    header: WEFT_CRED_HEADER,
    ph: presentationHeader,
    nym_secret: state.nymSecret,
    context_id: scopeId,
    messages,
    disclosed_indexes: sortedIdx,
    committed_messages: committed,
    disclosed_committed_indexes: [],
    secret_prover_blind: state.secretProverBlind,
    api_id: BBS_PSEUDONYM_API_ID,
    ciphersuite: WEFT_CIPHERSUITE,
  });
  return {
    proof,
    disclosedIndexes: sortedIdx,
    disclosedMessages: sortedIdx.map((i) => messages[i]!),
    header: WEFT_CRED_HEADER,
    presentationHeader,
    scopeId,
    pseudonym,
  };
}

// ---------------------------------------------------------------------------
// Public API — verifier-side
// ---------------------------------------------------------------------------

/**
 * Verifier checks a presentation against the expected issuer public key.
 *
 * Verifier does NOT need `HolderState` or the original credential — the
 * ZK proof is self-contained. Verifier learns:
 *   - the disclosed cleartext attributes;
 *   - that the presentation was signed by `issuerPublicKey`;
 *   - the presenter's `pseudonym` **for this scope only** (no linkage to
 *     other scopes' pseudonyms, but exact-match linkage to prior
 *     presentations of the same credential in the *same* scope).
 *
 * `presentation.presentationHeader` MUST match what the verifier challenged
 * with. `presentation.scopeId` MUST match the verifier's expected scope.
 */
export function verifyPresentation(
  presentation: Presentation,
  issuerPublicKey: Uint8Array,
): boolean {
  return ProofVerifyWithPseudonym({
    PK: issuerPublicKey,
    proof: presentation.proof,
    header: presentation.header,
    ph: presentation.presentationHeader,
    pseudonym: presentation.pseudonym,
    context_id: presentation.scopeId,
    // Library's `L` = number of cleartext messages (not committed).
    L: CLEARTEXT_ATTR_COUNT,
    disclosed_messages: presentation.disclosedMessages,
    disclosed_committed_messages: [],
    disclosed_indexes: presentation.disclosedIndexes,
    disclosed_committed_indexes: [],
    api_id: BBS_PSEUDONYM_API_ID,
    ciphersuite: WEFT_CIPHERSUITE,
  });
}

// ---------------------------------------------------------------------------
// k_cred lifecycle helpers (DD §36.1)
// ---------------------------------------------------------------------------

/**
 * A per-cell record the encrypted backup blob (§9.2) stores so that a
 * new-device restore can reconstruct current cell memberships without
 * re-credentialing (which would strand the membership — the cell's roster
 * would reject the resulting fresh scope_nym as a stranger).
 *
 * See DD §36.1 "k_cred lifecycle (client obligations)".
 */
export interface KCredBackupRecord {
  scopeId: Uint8Array;
  nymSecret: bigint;
  proverNym: bigint;
  secretProverBlind: bigint;
  credential: Credential;
  subjectSecret: Uint8Array;
}

/**
 * Build a backup record from an active HolderState + Credential. Callers
 * store this alongside the root secret in the encrypted backup blob for
 * every *currently active* cell — see `dropForCellOnLeave` for the
 * complementary discipline.
 */
export function backupForCell(
  scopeId: Uint8Array,
  cred: Credential,
  state: HolderState,
): KCredBackupRecord {
  if (state.nymSecret === undefined) {
    throw new Error('cannot back up: HolderState.nymSecret is undefined');
  }
  return {
    scopeId,
    nymSecret: state.nymSecret,
    proverNym: state.proverNym,
    secretProverBlind: state.secretProverBlind,
    credential: cred,
    subjectSecret: state.secrets.subject_secret,
  };
}

/**
 * Reconstruct a HolderState from a KCredBackupRecord — used at new-device
 * restore or when reopening a persisted store.
 */
export function restoreFromBackup(rec: KCredBackupRecord): HolderState {
  return {
    secrets: { subject_secret: rec.subjectSecret },
    proverNym: rec.proverNym,
    secretProverBlind: rec.secretProverBlind,
    nymSecret: rec.nymSecret,
  };
}

/**
 * Remove a cell's backup record from a KCredBackupRecord list — the
 * "discard on leave" half of the lifecycle. Client discipline, not
 * protocol-enforced: a hoarding client harms only its own user's
 * forgetting, never anyone else's (DD §36.1). Compare `scopeId` bytes,
 * so callers can pass any reasonable list container.
 */
export function dropForCellOnLeave(
  records: readonly KCredBackupRecord[],
  scopeIdToDrop: Uint8Array,
): KCredBackupRecord[] {
  return records.filter((r) => !bytesEqual(r.scopeId, scopeIdToDrop));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
