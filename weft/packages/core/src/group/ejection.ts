// Group ejection — kind 4904 (DD §7 + §36.2).
//
// Sanction = exclusion, exclusion = key rotation. Per the charter's
// `ejection_procedure` (an m-of-n rule identical in shape to
// `amendment_rule`), stewards publish a 4904 attestation naming the
// ejected scope_nym, the charter clause cited, and an evidence hash
// only — evidence itself stays with the ejecting group (§7's negative-
// attestation-as-harassment-vector concern). Immediately after, the
// group publishes a 4921 rotation excluding the ejected nym.
//
// **Ejection sticks.** The ejected member's scope_nym for this cell is
// deterministic in their nym_secret (M9-T3). Re-presenting a credential
// produces the same scope_nym, which the roster (M10-T1) rejects on
// `previously ejected` grounds. This is the load-bearing property that
// makes anonymous membership + accountable governance coexist.
//
// **Exit-and-fork is the appeal.** Ejection is cryptographically
// irreversible for a given scope_nym; a wrongly-ejected member can only
// be re-admitted as a fresh scope_nym (a charter/roster action) or fork
// the cell (per DD §7).
//
// Sources of law:
//   DD §7      federated moderation, cheap exit + fork
//   DD §36.2   ejection procedure, ejection = key rotation
//   Build list M10-T4

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { NostrEvent } from 'nostr-tools/pure';

import { buildAndSign, type WeftEvent } from '../codec/event';
import { sign as bip340Sign, verify as bip340Verify, type PublicKey, type SecretKey } from '../keys/keys';
import type { Charter, SignatureEntry } from './charter';

const KIND_EJECTION = 4904;

/** Bumped whenever the ejection wire schema changes. */
export const EJECTION_WIRE_VERSION = 1;

// ---------------------------------------------------------------------------
// Ejection attestation types
// ---------------------------------------------------------------------------

/**
 * The signable payload. Includes `cell_id` so a signature cannot be
 * replayed across cells (the charter's clause references are per-cell).
 */
export interface EjectionAttestation {
  /** Wire schema version. */
  readonly v: number;
  /** hex — the ejected member's scope_nym (32 bytes). */
  readonly scope_nym: string;
  /** hex — cell id (== genesis charter event id, 32 bytes). */
  readonly cell_id: string;
  /**
   * Reference to the charter clause cited (index into `house_rules`, or
   * a short slug like "sec.5"). Kept human-readable for stewards; not
   * parsed by the protocol.
   */
  readonly clause: string;
  /**
   * hex — sha256 of the evidence held privately by the ejecting group
   * (32 bytes). The evidence itself never appears on the wire (F1's
   * negative-attestation posture: subscribers see that *something* was
   * cited, never the substance).
   */
  readonly evidence_hash: string;
}

/** Ejection attestation after m-of-n stewards have signed. */
export interface SignedEjection {
  readonly attestation: EjectionAttestation;
  /** m or more BIP-340 signatures over `canonicalEjectionHash(attestation)`. */
  readonly sigs: readonly SignatureEntry[];
}

// ---------------------------------------------------------------------------
// Canonical hash — same construction pattern as charter amendments
// ---------------------------------------------------------------------------

export function canonicalEjectionHash(a: EjectionAttestation): Uint8Array {
  return sha256(new TextEncoder().encode(canonicalJson(a)));
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number in canonical JSON');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
  }
  throw new Error(`unsupported type in canonical JSON: ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Sign / build / parse
// ---------------------------------------------------------------------------

/** One steward signs the ejection payload. */
export function signEjection(
  attestation: EjectionAttestation,
  stewardSecret: SecretKey,
  stewardPubkey: PublicKey,
): SignatureEntry {
  const digest = canonicalEjectionHash(attestation);
  const sig = bip340Sign(digest, stewardSecret);
  return {
    signer: bytesToHex(stewardPubkey),
    sig: bytesToHex(sig),
  };
}

/**
 * Wrap a signed ejection into a kind-4904 event. Outer signature is by
 * one publishing steward; m-of-n approval lives in `signed.sigs`.
 */
export function buildEjectionEvent(
  signed: SignedEjection,
  publisherSecret: SecretKey,
): WeftEvent {
  return buildAndSign(
    { kind: KIND_EJECTION, content: JSON.stringify(signed) },
    publisherSecret,
  );
}

/** Parse a 4904 event back to a SignedEjection. Returns null on malformed. */
export function parseEjectionEvent(evt: NostrEvent): SignedEjection | null {
  if (evt.kind !== KIND_EJECTION) return null;
  try {
    const parsed = JSON.parse(evt.content) as SignedEjection;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.attestation !== 'object' ||
      !Array.isArray(parsed.sigs)
    ) {
      return null;
    }
    if (parsed.attestation.v !== EJECTION_WIRE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Verify against the current charter
// ---------------------------------------------------------------------------

export type EjectionVerdict =
  | { ok: true }
  | { ok: false; reason: 'wrong-cell' | 'below-threshold' | 'foreign-signer' | 'duplicate-signer' | 'bad-signature' };

/**
 * Verify an ejection attestation against the cell's current charter:
 *   1. `cell_id` matches the cell's genesis charter id.
 *   2. Every signer is a member of the current charter's steward set.
 *   3. No duplicate signers within this ejection.
 *   4. Signer count ≥ charter's `ejection_procedure.m`.
 *   5. Each signature verifies over `canonicalEjectionHash(attestation)`.
 *
 * Returns a structured verdict so callers can log specific failure reasons
 * without exposing signer identities (log the enum, not the pubkey).
 */
export function verifyEjection(
  signed: SignedEjection,
  currentCharter: Charter,
  currentCellId: string,
): EjectionVerdict {
  if (signed.attestation.cell_id !== currentCellId) {
    return { ok: false, reason: 'wrong-cell' };
  }

  const stewardSet = new Set(currentCharter.payload.steward_pubkeys);
  for (const s of signed.sigs) {
    if (!stewardSet.has(s.signer)) return { ok: false, reason: 'foreign-signer' };
  }
  const uniqueSigners = new Set(signed.sigs.map((s) => s.signer));
  if (uniqueSigners.size !== signed.sigs.length) {
    return { ok: false, reason: 'duplicate-signer' };
  }
  if (signed.sigs.length < currentCharter.payload.ejection_procedure.m) {
    return { ok: false, reason: 'below-threshold' };
  }

  const digest = canonicalEjectionHash(signed.attestation);
  for (const s of signed.sigs) {
    const sigBytes = hexToBytes(s.sig);
    const pubBytes = hexToBytes(s.signer);
    if (!bip340Verify(sigBytes, digest, pubBytes)) {
      return { ok: false, reason: 'bad-signature' };
    }
  }
  return { ok: true };
}
