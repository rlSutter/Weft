// Weft credential engine — anonymous vouches over BBS/BLS12-381.
//
// Sources of law:
//   DD §36.1        credential attributes, blind issuance, k_cred lifecycle
//   DD §36.1 amendment (2026-07-19)  scope_nym as credential-bound nullifier
//   Build list M9-T1  what this module ships (T3 adds scope_nym derivation)
//
// One rule: no hand-rolled crypto. Everything BBS goes through
// @digitalbazaar/bbs-signatures (via the rlSutter/bbs-signatures fork —
// upstream PR digitalbazaar/bbs-signatures#22 pending).
//
// Naming: this file uses Weft terms (k_cred, subject_secret, cleartext vs.
// committed). The IETF BBS-draft-06 names are preserved in comments so
// implementers can cross-reference the spec.

import {
  generateKeyPair as bbsGenerateKeyPair,
  CIPHERSUITES,
  Commit,
  BlindSign,
  BlindVerify,
  BlindProofGen,
  BlindProofVerify,
} from './bbs';
import { bls12_381 } from '@noble/curves/bls12-381';
import { randomBytes } from '@noble/hashes/utils';

/** Ciphersuite Weft pins for the alpha (per DD §36.1 — BLS12-381, SHA-256). */
export const WEFT_CIPHERSUITE = CIPHERSUITES.BLS12381_SHA256;

/**
 * Blind-BBS api_id, precomputed. Passed to every Commit/BlindSign/etc. call
 * to work around an upstream ordering bug: BlindSign's default api_id
 * computation runs before it resolves the ciphersuite string to an object,
 * so leaving it undefined yields an api_id derived from `undefined.ciphersuite_id`.
 * Commit orders these correctly; the two defaults disagree.
 *
 * Fix pending upstream (see rlSutter/bbs-signatures fork). Here we always
 * pass an explicit api_id so both call sites agree regardless.
 *
 * Value = TEXT_ENCODER.encode(ciphersuite_id + "BLIND_H2G_HM2S_"), matching
 * `createApiId` from bbs-signatures/lib/bbs/util.js.
 */
const BBS_BLS12381G1_XMD_SHA256_ID = 'BBS_BLS12381G1_XMD:SHA-256_SSWU_RO_';
const BLIND_API_SUFFIX = 'BLIND_H2G_HM2S_';
const BBS_BLIND_API_ID: Uint8Array = new TextEncoder().encode(
  BBS_BLS12381G1_XMD_SHA256_ID + BLIND_API_SUFFIX,
);

/**
 * Domain-separator header used on every Weft credential signature.
 * Prevents cross-protocol reuse of a Weft credential (e.g., as a VC in
 * another BBS-consuming system). Tie-break: bump this string when the
 * credential attribute schema below changes.
 */
export const WEFT_CRED_HEADER = new TextEncoder().encode('weft-v2/vouch-cred/1');

/** Number of cleartext attribute fields (see `CleartextAttrs` below). */
export const CLEARTEXT_ATTR_COUNT = 5;

/** Number of holder-committed attribute fields (see `HolderSecrets` below). */
export const COMMITTED_ATTR_COUNT = 2;

// ---------------------------------------------------------------------------
// Attribute schema (WIRE — do not reorder without a version bump)
// ---------------------------------------------------------------------------

/**
 * The five cleartext attributes the issuer signs, in fixed order.
 * Order is part of the wire format: BBS signs messages by index.
 *
 * Corresponds to DD §36.1 attributes minus the two committed ones.
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
 * Two secrets the holder commits to at credential-request time. The issuer
 * never sees these in the clear — blindness is the load-bearing property
 * DD §36.1 depends on.
 *
 * Both remain per-credential state on the holder's device.
 * See DD §36.1 "k_cred lifecycle" for backup/discard rules.
 */
export interface HolderSecrets {
  /**
   * 32-byte binding to the holder's root — a random value the holder picks
   * and keeps to prove "I am the same subject" across presentations.
   * The DD calls this `subject_commitment`; the library commits it for us.
   */
  subject_secret: Uint8Array;
  /**
   * 32-byte per-credential secret. The holder derives cell-scoped
   * pseudonyms (M9-T3) and cell-scoped signing keys (DD §36.2 blind
   * issuance) from this. **Never** derived from the root secret — that
   * would make root-secret compromise retroactively delink every cell.
   */
  k_cred: Uint8Array;
}

// ---------------------------------------------------------------------------
// Wire types (opaque bundles — treat as byte blobs)
// ---------------------------------------------------------------------------

/**
 * The bundle a holder sends to an issuer to request a credential. The
 * `commitmentWithProof` is the library's opaque commitment-plus-ZK-proof
 * over the holder's secrets; the issuer verifies the proof, signs it
 * alongside the cleartext attributes, and returns the signature.
 *
 * **Blindness guarantee**: `subject_secret` and `k_cred` do not appear as
 * bytes inside `commitmentWithProof` — the acceptance test asserts this.
 */
export interface CredentialRequest {
  commitmentWithProof: Uint8Array;
  cleartext: CleartextAttrs;
}

/**
 * State the holder must retain locally to later present the credential.
 * Losing `secretProverBlind` or `holderSecrets` renders the credential
 * unpresentable — the encrypted backup blob (DD §9.2) MUST include them
 * for currently-held credentials.
 */
export interface HolderState {
  secrets: HolderSecrets;
  secretProverBlind: bigint;
}

/**
 * A signed credential in transit from issuer back to holder. The issuer
 * publishes nothing — the whole object is wrapped (kind 1059) and
 * delivered peer-to-peer. Persisted only in the holder's local store.
 */
export interface Credential {
  signature: Uint8Array;
  cleartext: CleartextAttrs;
  issuerPubkey: Uint8Array;
}

/**
 * A zero-knowledge presentation of a credential to a verifier. Reveals
 * only the disclosed cleartext attributes (by index); everything else —
 * including which credential this is — remains hidden. Unlinkable across
 * presentations of the same credential (see acceptance test).
 */
export interface Presentation {
  proof: Uint8Array;
  disclosedIndexes: number[];
  disclosedMessages: Uint8Array[];
  header: Uint8Array;
  /** Verifier-chosen nonce that prevents replay of a captured presentation. */
  presentationHeader: Uint8Array;
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
  if (s.k_cred.length !== 32) {
    throw new Error(`k_cred must be exactly 32 bytes (got ${s.k_cred.length})`);
  }
  // Order is wire — committed_indexes reference these positions.
  return [s.subject_secret, s.k_cred];
}

/**
 * Convert a 32-byte issuer secret key (as bytes) into the BBS scalar
 * (`bigint mod r`) the library's BlindSign takes.
 *
 * The base `sign()` accepts Uint8Array and does this internally via
 * `os2ip(secretKey, octet_scalar_length)` — **big-endian** by RFC 3447
 * convention. The blind variant does not do this conversion, so we do it
 * here, matching the library's os2ip exactly (noble's Fr.fromBytes is
 * little-endian, so we can't use it here).
 */
function skBytesToScalar(sk: Uint8Array): bigint {
  if (sk.length !== 32) throw new Error(`issuer SK must be 32 bytes (got ${sk.length})`);
  // os2ip: big-endian byte string to non-negative integer, then reduce mod r.
  let x = 0n;
  for (const b of sk) x = (x << 8n) | BigInt(b);
  const scalar = x % bls12_381.fields.Fr.ORDER;
  if (scalar === 0n) throw new Error('issuer SK reduces to 0 mod r — invalid');
  return scalar;
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
 * The issuer never sees `subject_secret` or `k_cred`.
 */
export async function issueCredential(
  request: CredentialRequest,
  issuerSecretKey: Uint8Array,
  issuerPublicKey: Uint8Array,
): Promise<Credential> {
  const SK = skBytesToScalar(issuerSecretKey);
  const messages = encodeCleartextAttrs(request.cleartext);
  const signature = await BlindSign({
    SK,
    PK: issuerPublicKey,
    commitment_with_proof: request.commitmentWithProof,
    header: WEFT_CRED_HEADER,
    messages,
    api_id: BBS_BLIND_API_ID,
    ciphersuite: WEFT_CIPHERSUITE,
  });
  return {
    signature,
    cleartext: request.cleartext,
    issuerPubkey: issuerPublicKey,
  };
}

// ---------------------------------------------------------------------------
// Public API — holder-side
// ---------------------------------------------------------------------------

/**
 * Generate a fresh HolderSecrets bundle. Called once at credential-request
 * time; kept per-credential thereafter (DD §36.1 k_cred lifecycle).
 */
export function generateHolderSecrets(): HolderSecrets {
  return {
    subject_secret: randomBytes(32),
    k_cred: randomBytes(32),
  };
}

/**
 * Holder builds a credential request. Retains `HolderState` (including the
 * secret_prover_blind returned by Commit) — without it, later present() and
 * verify() calls fail.
 */
export async function requestCredential(
  cleartext: CleartextAttrs,
  secrets: HolderSecrets = generateHolderSecrets(),
): Promise<{ request: CredentialRequest; state: HolderState }> {
  // Validate both sides eagerly — the holder shouldn't build a request that
  // the issuer will reject on encoding grounds, and it's the natural place
  // to catch schema errors.
  encodeCleartextAttrs(cleartext);
  const committed = encodeCommittedSecrets(secrets);
  const { commitment_with_proof, secret_prover_blind } = await Commit({
    committed_messages: committed,
    api_id: BBS_BLIND_API_ID,
    ciphersuite: WEFT_CIPHERSUITE,
  });
  return {
    request: { commitmentWithProof: commitment_with_proof, cleartext },
    state: { secrets, secretProverBlind: secret_prover_blind },
  };
}

/**
 * Holder verifies a freshly-issued credential is signed correctly by the
 * expected issuer and binds to their held secrets. Called before storing.
 */
export async function verifyCredential(cred: Credential, state: HolderState): Promise<boolean> {
  return BlindVerify({
    PK: cred.issuerPubkey,
    signature: cred.signature,
    header: WEFT_CRED_HEADER,
    messages: encodeCleartextAttrs(cred.cleartext),
    committed_messages: encodeCommittedSecrets(state.secrets),
    secret_prover_blind: state.secretProverBlind,
    api_id: BBS_BLIND_API_ID,
    ciphersuite: WEFT_CIPHERSUITE,
  });
}

/**
 * Holder produces a zero-knowledge presentation of the credential.
 *
 * `presentationHeader` (a.k.a. `ph`) is a verifier-chosen nonce that
 * prevents replay of a captured presentation — every verifier should
 * generate one fresh per challenge.
 *
 * `disclosedIndexes` selects which cleartext attributes to reveal by
 * their fixed positions (0=tier, 1=ctx, 2=issued_epoch, 3=expiry_epoch,
 * 4=issuer_scope_tag). Committed secrets are never disclosed in v0
 * (M9-T3 will expose scope_nym derivation, which is the intended way to
 * bind a committed value to a public identifier without revealing it).
 */
export async function presentCredential(
  cred: Credential,
  state: HolderState,
  disclosedIndexes: number[],
  presentationHeader: Uint8Array,
): Promise<Presentation> {
  for (const i of disclosedIndexes) {
    if (!Number.isInteger(i) || i < 0 || i >= CLEARTEXT_ATTR_COUNT) {
      throw new Error(`disclosedIndex out of range [0, ${CLEARTEXT_ATTR_COUNT}): ${i}`);
    }
  }
  const messages = encodeCleartextAttrs(cred.cleartext);
  const committed = encodeCommittedSecrets(state.secrets);
  const proof = await BlindProofGen({
    PK: cred.issuerPubkey,
    signature: cred.signature,
    header: WEFT_CRED_HEADER,
    ph: presentationHeader,
    messages,
    disclosed_indexes: [...disclosedIndexes].sort((a, b) => a - b),
    committed_messages: committed,
    disclosed_committed_indexes: [],   // never disclose secrets in v0 (M9-T3 for scope_nym)
    secret_prover_blind: state.secretProverBlind,
    api_id: BBS_BLIND_API_ID,
    ciphersuite: WEFT_CIPHERSUITE,
  });
  const sortedIdx = [...disclosedIndexes].sort((a, b) => a - b);
  return {
    proof,
    disclosedIndexes: sortedIdx,
    disclosedMessages: sortedIdx.map((i) => messages[i]!),
    header: WEFT_CRED_HEADER,
    presentationHeader,
  };
}

// ---------------------------------------------------------------------------
// Public API — verifier-side
// ---------------------------------------------------------------------------

/**
 * Verifier checks a presentation against the expected issuer public key.
 *
 * Verifier does NOT need `HolderState` or the original credential — the
 * ZK proof is self-contained. Verifier learns only the disclosed
 * cleartext attributes, that they were signed by `issuerPublicKey`, and
 * that a presentation was made — no linkage to any previous presentation
 * of the same credential.
 *
 * `presentationHeader` MUST match what the verifier challenged with.
 */
export async function verifyPresentation(
  presentation: Presentation,
  issuerPublicKey: Uint8Array,
): Promise<boolean> {
  return BlindProofVerify({
    PK: issuerPublicKey,
    proof: presentation.proof,
    header: presentation.header,
    ph: presentation.presentationHeader,
    // Library's `L` = number of cleartext messages (not committed) — used
    // to size the cleartext generator set. Our schema has exactly
    // CLEARTEXT_ATTR_COUNT of them.
    L: CLEARTEXT_ATTR_COUNT,
    disclosed_messages: presentation.disclosedMessages,
    disclosed_committed_messages: [],
    disclosed_indexes: presentation.disclosedIndexes,
    disclosed_committed_indexes: [],
    api_id: BBS_BLIND_API_ID,
    ciphersuite: WEFT_CIPHERSUITE,
  });
}
