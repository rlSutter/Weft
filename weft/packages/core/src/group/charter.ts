// Group charter — kind 4900 (DD §36.2).
//
// A charter is the constitution of a cell: steward set, amendment rule,
// ejection procedure, chosen embedding model, media policy, credential
// constants (k for k-show, epoch length), and a small set of house rules.
// The charter event's own id **is** the cell's identity — invites carry
// this id in their `chp` field, and every credential's `issuer_scope_tag`
// hashes to a value derived from this id.
//
// **Amendment chain.** Each amendment references its predecessor via
// `prev` (the previous charter's event id). The genesis charter has
// `prev: null`. `cellId(chain) === chain[0].event.id` for any chain
// starting at genesis; walking `prev` links back to that same id.
//
// **Multi-signature.** Nostr events are singly-signed at the event level,
// which proves that *one* steward pushed the event — not that m of n
// stewards approved it. So governance-changing amendments carry an inner
// `sigs` array (one BIP-340 signature per approving steward, each over
// the canonical hash of the charter payload with the `sigs` field
// removed). `verifyAmendmentChain` walks each amendment and enforces the
// m-of-n threshold from the *previous* charter (you can't lower your own
// bar in a single hop).
//
// Sources of law:
//   DD §36.2   charters, amendments, m-of-n, ejection procedure
//   DD §30     `chp` = current charter pointer (cell id derived from genesis)
//   DD §33.2   kind 4900 Charter
//   Build list M10-T1

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { NostrEvent } from 'nostr-tools/pure';

import { buildAndSign } from '../codec/event';
import { sign as bip340Sign, verify as bip340Verify, type PublicKey, type SecretKey } from '../keys/keys';

const KIND_CHARTER = 4900;

/** Bumped whenever the charter wire schema changes. */
export const CHARTER_WIRE_VERSION = 1;

// ---------------------------------------------------------------------------
// Charter types
// ---------------------------------------------------------------------------

/** m-of-n threshold rule ("m signatures required from the n stewards"). */
export interface ThresholdRule {
  readonly m: number;
  readonly n: number;
}

/** The five house-rule slots (UX convention: front-porch text; ≤6 lines). */
export type HouseRules = readonly string[];

/**
 * The charter payload — everything the amendment chain agrees on, minus the
 * m-of-n `sigs` (which are computed over a hash of this payload).
 */
export interface CharterPayload {
  /** Wire schema version. */
  readonly v: number;
  /** Human-readable name for UI (optional, cell id is the real identity). */
  readonly title: string;
  /** Hex pubkeys (BIP-340 x-only, 64 hex chars) of the steward set. */
  readonly steward_pubkeys: readonly string[];
  /** Amendments changing governance keys need this m-of-n. */
  readonly amendment_rule: ThresholdRule;
  /** Ejections need this m-of-n (from the steward set, per DD §36.2). */
  readonly ejection_procedure: ThresholdRule;
  /** Embedding model identifier per DD §19.3 (e.g. "MiniLM-L6-v2"). */
  readonly embedding_model: string;
  /** Media policy code from DD §34.4 (e.g. "text-only" | "strip-exif"). */
  readonly media_policy: string;
  /** Credential constants (DD §36.1). */
  readonly credential_constants: {
    readonly k_show: number;
    readonly epoch_length_days: number;
  };
  /** Hex of the cell's BBS+ issuer public key (used to verify credentials). */
  readonly issuer_bbs_pubkey: string;
  /** ≤6 lines by UX convention; not enforced at wire level for flexibility. */
  readonly house_rules: HouseRules;
  /** Event id of the previous charter, or `null` for the genesis charter. */
  readonly prev: string | null;
}

/** Charter after multi-sig — payload plus m-of-n signatures over its hash. */
export interface Charter {
  readonly payload: CharterPayload;
  /**
   * BIP-340 signatures, one per approving steward, each over
   * `sha256(canonicalPayload)`. Missing on the genesis charter (whose outer
   * event signature by any steward is enough — genesis defines the initial
   * steward set; m-of-n is required only for amendments).
   */
  readonly sigs: readonly SignatureEntry[];
}

/** Hex signer pubkey → hex 64-char BIP-340 signature. */
export interface SignatureEntry {
  readonly signer: string;
  readonly sig: string;
}

// ---------------------------------------------------------------------------
// Canonical hash — the same bytes every steward signs
// ---------------------------------------------------------------------------

/**
 * Compute the canonical hash the m-of-n `sigs` are made over. Uses a
 * deterministic JSON: keys sorted, no whitespace, no reordering of the
 * `steward_pubkeys` or `house_rules` arrays (order is part of the charter).
 */
export function canonicalCharterHash(payload: CharterPayload): Uint8Array {
  return sha256(new TextEncoder().encode(canonicalJson(payload)));
}

/**
 * Deterministic JSON: object keys emitted in sorted order; arrays preserve
 * their given order. No whitespace. Numbers formatted per JSON default.
 * This is intentionally NOT nostr-tools' event serialization — we don't
 * need NIP-01 compatibility here; we need every steward to independently
 * produce the same bytes.
 */
function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number in canonical JSON');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
  }
  throw new Error(`unsupported type in canonical JSON: ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Sign / build events
// ---------------------------------------------------------------------------

/**
 * Have one steward sign the charter payload — returns a SignatureEntry the
 * charter builder can collect from each approver.
 */
export function signCharterPayload(
  payload: CharterPayload,
  stewardSecret: SecretKey,
  stewardPubkey: PublicKey,
): SignatureEntry {
  const digest = canonicalCharterHash(payload);
  const sig = bip340Sign(digest, stewardSecret);
  return {
    signer: bytesToHex(stewardPubkey),
    sig: bytesToHex(sig),
  };
}

/**
 * Wrap a signed charter into a kind-4900 Nostr event. The outer event is
 * signed by *one* steward (the one publishing); m-of-n approval lives
 * inside `charter.sigs`.
 */
export function buildCharterEvent(
  charter: Charter,
  publisherSecret: SecretKey,
): NostrEvent {
  return buildAndSign(
    { kind: KIND_CHARTER, content: JSON.stringify(charter) },
    publisherSecret,
  );
}

/**
 * Parse a kind-4900 event back to a Charter. Returns null on malformed
 * input rather than throwing (matches `unwrap` and the invite engine
 * discipline — parse errors do not leak to logs).
 */
export function parseCharterEvent(evt: NostrEvent): Charter | null {
  if (evt.kind !== KIND_CHARTER) return null;
  try {
    const parsed = JSON.parse(evt.content) as Charter;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.payload !== 'object' ||
      !Array.isArray(parsed.sigs)
    ) {
      return null;
    }
    if (parsed.payload.v !== CHARTER_WIRE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cell id + amendment chain verification
// ---------------------------------------------------------------------------

/**
 * The cell id = the *genesis* charter event id. For any chain that starts
 * at genesis, this is `chain[0].id`.
 */
export function cellId(genesisEvent: NostrEvent): string {
  return genesisEvent.id;
}

/**
 * Verify that a chain of charter events is a valid amendment sequence:
 *   1. All events are kind 4900 with parseable payloads.
 *   2. The first event has `prev: null` (it IS the genesis).
 *   3. Each subsequent event has `prev === previous.id`.
 *   4. Every amendment carries m-of-n signatures per the *previous*
 *      charter's `amendment_rule`, and the signers are all in the
 *      previous charter's `steward_pubkeys`. (A charter cannot lower its
 *      own approval bar in the same amendment that changes governance.)
 *   5. Each signature verifies against its declared signer.
 *
 * Returns the final (current) Charter on success, or null on any failure.
 */
export function verifyAmendmentChain(chain: readonly NostrEvent[]): Charter | null {
  if (chain.length === 0) return null;

  const genesisEvent = chain[0]!;
  const genesis = parseCharterEvent(genesisEvent);
  if (!genesis) return null;
  if (genesis.payload.prev !== null) return null;

  let previous = genesis;
  let previousId = genesisEvent.id;

  for (let i = 1; i < chain.length; i++) {
    const nextEvent = chain[i]!;
    const next = parseCharterEvent(nextEvent);
    if (!next) return null;

    // Chain link.
    if (next.payload.prev !== previousId) return null;

    // Signer set: every sig must come from a steward in the PREVIOUS charter.
    // The new charter can name a different steward set for future amendments,
    // but this amendment's authority comes from the old steward set.
    const prevStewardSet = new Set(previous.payload.steward_pubkeys);
    for (const s of next.sigs) {
      if (!prevStewardSet.has(s.signer)) return null;
    }
    // No duplicate signers within one amendment.
    if (new Set(next.sigs.map((s) => s.signer)).size !== next.sigs.length) return null;

    // Threshold.
    const rule = previous.payload.amendment_rule;
    if (next.sigs.length < rule.m) return null;
    // Sanity: n in the rule should match the size of the previous steward set.
    if (rule.n !== previous.payload.steward_pubkeys.length) return null;

    // Signature verification.
    const digest = canonicalCharterHash(next.payload);
    for (const s of next.sigs) {
      const sigBytes = hexToBytes(s.sig);
      const pubBytes = hexToBytes(s.signer);
      if (!bip340Verify(sigBytes, digest, pubBytes)) return null;
    }

    previous = next;
    previousId = nextEvent.id;
  }

  return previous;
}
