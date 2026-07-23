// Credential issuance wire flow — inner kinds 4930 / 4931 / 4903.
//
// Sources of law:
//   DD §36.1    issuance flow: subject sends 4930, issuer replies 4931
//   DD §36.4    kind registry rows for 4930/4931
//   DD §33.3    kind 4903 void (revocation reuses the vouch-void kind)
//   DD §33.1    gift-wrap envelope (all inner events ride kind-1059 wraps)
//   Build list M9-T4
//
// This module produces and parses the *inner* events. Wrapping (kind 1059)
// happens at call sites via `wrap/gift.ts`. Keeping serialization here means
// the wire format for credentials is defined in one place — bump the
// SERIALIZATION_VERSION when adding fields.

import { buildAndSign, type WeftEvent } from '../codec/event';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import type { CleartextAttrs, Credential, CredentialRequest } from './cred';

const KIND_CREDENTIAL_REQUEST = 4930;
const KIND_CREDENTIAL_ISSUANCE = 4931;
const KIND_VOID = 4903;

/** Bumped whenever the wire schema of 4930/4931/4903 changes. */
export const CRED_WIRE_VERSION = 1;

// ---------------------------------------------------------------------------
// Encoding helpers — private
// ---------------------------------------------------------------------------

interface CleartextWire {
  tier: 1 | 2 | 3;
  ctx: string;
  issued_epoch: number;
  expiry_epoch: number;
  /** hex — 32-byte issuer_scope_tag */
  issuer_scope_tag: string;
}

function encodeCleartext(a: CleartextAttrs): CleartextWire {
  return {
    tier: a.tier,
    ctx: a.ctx,
    issued_epoch: a.issued_epoch,
    expiry_epoch: a.expiry_epoch,
    issuer_scope_tag: bytesToHex(a.issuer_scope_tag),
  };
}

function decodeCleartext(w: CleartextWire): CleartextAttrs {
  return {
    tier: w.tier,
    ctx: w.ctx,
    issued_epoch: w.issued_epoch,
    expiry_epoch: w.expiry_epoch,
    issuer_scope_tag: hexToBytes(w.issuer_scope_tag),
  };
}

// ---------------------------------------------------------------------------
// 4930 CredentialRequest — subject → issuer
// ---------------------------------------------------------------------------

interface CredentialRequestWire {
  v: number;
  /** hex — opaque BBS commitment-with-proof (variable length) */
  commitmentWithProof: string;
  cleartext: CleartextWire;
}

/**
 * Build a signed inner 4930 event. The subject signs with their long-lived
 * key so the issuer can verify who's asking — this is fine because credential
 * *requests* aren't privacy-sensitive (the issuer already knows the subject
 * from ordinary vouching activity). The whole event will then be gift-wrapped
 * (kind 1059) to the issuer's pubkey before hitting the wire.
 */
export function buildCredentialRequestEvent(
  request: CredentialRequest,
  subjectSecret: Uint8Array,
): WeftEvent {
  const wire: CredentialRequestWire = {
    v: CRED_WIRE_VERSION,
    commitmentWithProof: bytesToHex(request.commitmentWithProof),
    cleartext: encodeCleartext(request.cleartext),
  };
  return buildAndSign(
    { kind: KIND_CREDENTIAL_REQUEST, content: JSON.stringify(wire) },
    subjectSecret,
  );
}

/**
 * Parse a decrypted inner 4930 event back to a CredentialRequest. Throws on
 * malformed input — callers should catch and treat as "malformed request".
 */
export function parseCredentialRequestEvent(inner: WeftEvent): CredentialRequest {
  if (inner.kind !== KIND_CREDENTIAL_REQUEST) {
    throw new Error(`expected kind ${KIND_CREDENTIAL_REQUEST}, got ${inner.kind}`);
  }
  const wire = JSON.parse(inner.content) as CredentialRequestWire;
  if (wire.v !== CRED_WIRE_VERSION) {
    throw new Error(`unsupported credential wire version ${wire.v}`);
  }
  return {
    commitmentWithProof: hexToBytes(wire.commitmentWithProof),
    cleartext: decodeCleartext(wire.cleartext),
  };
}

// ---------------------------------------------------------------------------
// 4931 CredentialIssuance — issuer → subject
// ---------------------------------------------------------------------------

interface CredentialIssuanceWire {
  v: number;
  /** hex — the BBS signature (80 bytes for the pinned ciphersuite) */
  signature: string;
  cleartext: CleartextWire;
  /** hex — the issuer's BBS public key (96 bytes) */
  issuerPubkey: string;
  /** base10 decimal string — Fr scalar (fits in 32 bytes) */
  signerNymEntropy: string;
}

/**
 * Build a signed inner 4931 event. The issuer signs with their long-lived
 * key so the subject can verify who's replying. The whole event will be
 * gift-wrapped to the subject's pubkey.
 */
export function buildCredentialIssuanceEvent(
  cred: Credential,
  issuerSecret: Uint8Array,
): WeftEvent {
  const wire: CredentialIssuanceWire = {
    v: CRED_WIRE_VERSION,
    signature: bytesToHex(cred.signature),
    cleartext: encodeCleartext(cred.cleartext),
    issuerPubkey: bytesToHex(cred.issuerPubkey),
    signerNymEntropy: cred.signerNymEntropy.toString(10),
  };
  return buildAndSign(
    { kind: KIND_CREDENTIAL_ISSUANCE, content: JSON.stringify(wire) },
    issuerSecret,
  );
}

export function parseCredentialIssuanceEvent(inner: WeftEvent): Credential {
  if (inner.kind !== KIND_CREDENTIAL_ISSUANCE) {
    throw new Error(`expected kind ${KIND_CREDENTIAL_ISSUANCE}, got ${inner.kind}`);
  }
  const wire = JSON.parse(inner.content) as CredentialIssuanceWire;
  if (wire.v !== CRED_WIRE_VERSION) {
    throw new Error(`unsupported credential wire version ${wire.v}`);
  }
  return {
    signature: hexToBytes(wire.signature),
    cleartext: decodeCleartext(wire.cleartext),
    issuerPubkey: hexToBytes(wire.issuerPubkey),
    signerNymEntropy: BigInt(wire.signerNymEntropy),
  };
}

// ---------------------------------------------------------------------------
// 4903 Void — issuer publishes a revocation
// ---------------------------------------------------------------------------

interface VoidWire {
  v: number;
  /** hex — the 32-byte revocation handle (see revocation.ts) */
  handle: string;
}

/**
 * Build a signed 4903 void event with the given revocation handle. The
 * issuer publishes this to the same relays credentials are consumed on.
 * The event content reveals only "some handle" — no subject, no scope,
 * no credential attribute leaks. Anyone can see that *something* was
 * voided (§35 F1 acceptance: void reveals the issuer voided something,
 * never the subject or edge).
 */
export function buildVoidEvent(
  handle: Uint8Array,
  issuerSecret: Uint8Array,
): WeftEvent {
  if (handle.length !== 32) {
    throw new Error(`void handle must be 32 bytes (got ${handle.length})`);
  }
  const wire: VoidWire = { v: CRED_WIRE_VERSION, handle: bytesToHex(handle) };
  return buildAndSign(
    { kind: KIND_VOID, content: JSON.stringify(wire) },
    issuerSecret,
  );
}

/**
 * Extract the revocation handle from a 4903 void event. Returns null if
 * the event isn't a void, has the wrong version, or is malformed.
 */
export function parseVoidedHandle(evt: WeftEvent): Uint8Array | null {
  if (evt.kind !== KIND_VOID) return null;
  try {
    const wire = JSON.parse(evt.content) as VoidWire;
    if (wire.v !== CRED_WIRE_VERSION) return null;
    const h = hexToBytes(wire.handle);
    if (h.length !== 32) return null;
    return h;
  } catch {
    return null;
  }
}
