// Invite token wire format v1 — DD §30.2 byte-exact.
//
// The invite is the most load-bearing object in the system: one artifact
// that bootstraps identity + graph edge + vouch commitment + relay hints +
// charter consent (DD §15, §28.4). It must fit in a QR code, survive being
// pasted into an SMS, and leak nothing to any server in transit.
//
// Wire encoding, in order:
//   1. Build a deterministic CBOR map with integer keys 0–7 (below).
//   2. sha256 the CBOR bytes.
//   3. BIP-340 Schnorr-sign the digest under the inviter's secret key
//      (auxRand = 32 zero bytes so the fixture is deterministic).
//   4. Add key 8 = signature (64 B) to the map.
//   5. Re-encode the map (with key 8) as deterministic CBOR.
//   6. base64url-encode the resulting bytes.
//
// Carriers (DD §30.1):
//   `https://weft.link/i#<tok>`   — token in the URL fragment; browsers
//                                   never send fragments to servers.
//   `weft:i:<tok>`                — app-to-app URI scheme.
//
// Sources of law:
//   DD §30.2   field table (this file's `InviteToken`)
//   DD §30.3   redemption protocol — this module implements step 1
//              (parse; reject unknown-major ver, expired, invalid sig).
//   DD §30.1   ≤ ~450 base64url chars, fragment carrier
//   Build list M1-T3 acceptance

import { Encoder as CborEncoder } from 'cbor-x';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

import { base64UrlDecode, base64UrlEncode } from '../codec/base64url';
import { sign, verify } from '../keys/keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Vouch commitment template — the promise the inviter makes at redemption time. */
export interface VouchTemplate {
  /** 1 = provisional, 2 = contextual, 3 = relationship (DD §21.2). */
  readonly tier: 1 | 2 | 3;
  /** Context code (e.g. "personal"). Free-form; short. */
  readonly ctx: string;
  /** Vouch validity, days. */
  readonly vexp: number;
}

/** Inputs to build an invite token — everything the wire carries except `sig`. */
export interface InviteTokenBody {
  /** Format version; only `1` is defined. */
  readonly ver: 1;
  /** Invite id, 16 random bytes (single-use ledger key, replay defense). */
  readonly iid: Uint8Array;
  /** Inviter x-only pubkey (32 bytes). */
  readonly inv: Uint8Array;
  /** Vouch commitment template. */
  readonly vtpl: VouchTemplate;
  /** Token expiry, unix seconds (≤ issue + 14 d per §15.1). */
  readonly exp: number;
  /** bit0 single_use (always 1 in v1); bit1 confirm_required (default 1). */
  readonly flags: number;
  /** Cell relay hint URLs (0–3). */
  readonly relays: readonly string[];
  /** Charter pointer = sha256 event id of the pinned charter, 32 bytes. */
  readonly chp: Uint8Array;
}

/** A fully signed invite token — body + BIP-340 signature. */
export interface InviteToken extends InviteTokenBody {
  /** BIP-340 signature by `inv` over sha256 of the body-only CBOR (64 bytes). */
  readonly sig: Uint8Array;
}

/** Human-readable summary of a token, for UI use before consent. DD §30.3 step 2. */
export interface InviteTokenDescription {
  readonly inviterPubkey: string; // hex
  readonly tier: 1 | 2 | 3;
  readonly ctx: string;
  readonly vouchValidityDays: number;
  readonly relays: readonly string[];
  readonly charterId: string; // hex
  readonly expiresAt: number; // unix seconds
  readonly singleUse: boolean;
  readonly confirmRequired: boolean;
}

// ---------------------------------------------------------------------------
// CBOR configuration — deterministic map encoding
// ---------------------------------------------------------------------------

// Options:
//   useRecords: false      standard CBOR, not cbor-x's fast "records" schema
//   mapsAsObjects: false   treat JS `Map` as CBOR major-type-5 map (not object)
//   tagUint8Array: false   plain CBOR byte string (major type 2), no tag 64
//   variableMapSize: true  shortest map-length header
//
// Insertion order matters: we insert keys 0..8 in ascending numeric order,
// so the encoded bytes come out canonical without an explicit sort step.
const cbor = new CborEncoder({
  useRecords: false,
  mapsAsObjects: false,
  tagUint8Array: false,
  variableMapSize: true,
});

/** Outer-map key numbers per DD §30.2. */
const OuterKey = {
  VER: 0,
  IID: 1,
  INV: 2,
  VTPL: 3,
  EXP: 4,
  FLAGS: 5,
  RELAYS: 6,
  CHP: 7,
  SIG: 8,
} as const;

/** Inner (vtpl) map key numbers. Chosen to keep vtpl ≈ 8 B per DD §30.2. */
const VtplKey = {
  TIER: 0,
  CTX: 1,
  VEXP: 2,
} as const;

/** Flag bit positions per DD §30.2. */
export const InviteFlags = Object.freeze({
  SINGLE_USE: 1 << 0, // bit 0 — always 1 in v1
  CONFIRM_REQUIRED: 1 << 1, // bit 1 — default 1 (§15.3)
});

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

function toBodyMap(body: InviteTokenBody): Map<number, unknown> {
  const vtplMap = new Map<number, unknown>();
  vtplMap.set(VtplKey.TIER, body.vtpl.tier);
  vtplMap.set(VtplKey.CTX, body.vtpl.ctx);
  vtplMap.set(VtplKey.VEXP, body.vtpl.vexp);

  const m = new Map<number, unknown>();
  m.set(OuterKey.VER, body.ver);
  m.set(OuterKey.IID, body.iid);
  m.set(OuterKey.INV, body.inv);
  m.set(OuterKey.VTPL, vtplMap);
  m.set(OuterKey.EXP, body.exp);
  m.set(OuterKey.FLAGS, body.flags);
  m.set(OuterKey.RELAYS, [...body.relays]);
  m.set(OuterKey.CHP, body.chp);
  return m;
}

/**
 * Encode + sign an invite token, returning a base64url string ready for a
 * carrier (see `httpsInviteUrl` / `weftInviteUri`).
 *
 * `auxRand` defaults to fresh CSPRNG bytes (BIP-340 recommended). Pass 32
 * zero bytes to reproduce the committed fixture at
 * `__fixtures__/token-v1.hex`.
 */
export function encodeInviteToken(
  body: InviteTokenBody,
  secret: Uint8Array,
  auxRand?: Uint8Array,
): string {
  validateBody(body);

  const bodyMap = toBodyMap(body);
  const bodyBytes = cbor.encode(bodyMap);
  const digest = sha256(bodyBytes);
  const sig = sign(digest, secret, auxRand);

  const fullMap = new Map(bodyMap);
  fullMap.set(OuterKey.SIG, sig);
  const fullBytes = cbor.encode(fullMap);

  return base64UrlEncode(fullBytes);
}

/** As `encodeInviteToken`, but returns the raw CBOR bytes (before base64url). */
export function encodeInviteTokenBytes(
  body: InviteTokenBody,
  secret: Uint8Array,
  auxRand?: Uint8Array,
): Uint8Array {
  validateBody(body);

  const bodyMap = toBodyMap(body);
  const bodyBytes = cbor.encode(bodyMap);
  const digest = sha256(bodyBytes);
  const sig = sign(digest, secret, auxRand);

  const fullMap = new Map(bodyMap);
  fullMap.set(OuterKey.SIG, sig);
  return cbor.encode(fullMap);
}

// ---------------------------------------------------------------------------
// Decode + validation (DD §30.3 step 1)
// ---------------------------------------------------------------------------

/** Reason a decode failed. Values are stable strings for UI mapping. */
export type DecodeError =
  | 'invalid-encoding' // base64url or CBOR malformed
  | 'not-a-map' // top-level is not a CBOR map
  | 'unknown-major-version' // ver is not 1
  | 'missing-field' // a required outer field is absent
  | 'bad-field-type' // a field has the wrong CBOR type
  | 'bad-field-size' // a bytes field has the wrong length
  | 'expired' // exp < now (checked at decode time when `now` supplied)
  | 'invalid-signature'; // sig does not verify under inv

export interface DecodeSuccess {
  readonly ok: true;
  readonly token: InviteToken;
}
export interface DecodeFailure {
  readonly ok: false;
  readonly error: DecodeError;
  readonly detail?: string;
}
export type DecodeResult = DecodeSuccess | DecodeFailure;

/**
 * Parse and verify a base64url invite token per DD §30.3 step 1.
 *
 * If `now` (unix seconds) is provided, an expired token returns
 * `{ ok: false, error: 'expired' }`. Callers that need to inspect an expired
 * token (e.g. UI showing "this invite has expired") may omit `now`.
 */
export function decodeInviteToken(str: string, now?: number): DecodeResult {
  let raw: Uint8Array;
  try {
    raw = base64UrlDecode(str);
  } catch (e) {
    return fail('invalid-encoding', (e as Error).message);
  }
  return decodeInviteTokenBytes(raw, now);
}

/** Decode from raw bytes (post-base64url). Prefer `decodeInviteToken` for wire input. */
export function decodeInviteTokenBytes(bytes: Uint8Array, now?: number): DecodeResult {
  let m: unknown;
  try {
    m = cbor.decode(bytes);
  } catch (e) {
    return fail('invalid-encoding', (e as Error).message);
  }
  if (!(m instanceof Map)) return fail('not-a-map');

  const map = m as Map<number, unknown>;
  const ver = map.get(OuterKey.VER);
  if (ver !== 1) return fail('unknown-major-version', String(ver));

  const iid = expectBytes(map.get(OuterKey.IID), 16, 'iid');
  if (typeof iid === 'string') return fail('bad-field-size', iid);
  const inv = expectBytes(map.get(OuterKey.INV), 32, 'inv');
  if (typeof inv === 'string') return fail('bad-field-size', inv);
  const chp = expectBytes(map.get(OuterKey.CHP), 32, 'chp');
  if (typeof chp === 'string') return fail('bad-field-size', chp);
  const sigRaw = expectBytes(map.get(OuterKey.SIG), 64, 'sig');
  if (typeof sigRaw === 'string') return fail('bad-field-size', sigRaw);

  const exp = map.get(OuterKey.EXP);
  if (typeof exp !== 'number' || !Number.isInteger(exp) || exp < 0) {
    return fail('bad-field-type', 'exp');
  }
  if (now !== undefined && exp < now) return fail('expired');

  const flags = map.get(OuterKey.FLAGS);
  if (typeof flags !== 'number' || !Number.isInteger(flags) || flags < 0) {
    return fail('bad-field-type', 'flags');
  }

  const relaysRaw = map.get(OuterKey.RELAYS);
  if (!Array.isArray(relaysRaw)) return fail('bad-field-type', 'relays');
  if (relaysRaw.length > 3) return fail('bad-field-size', 'relays > 3');
  for (const r of relaysRaw) {
    if (typeof r !== 'string') return fail('bad-field-type', 'relays[]');
  }
  const relays: readonly string[] = relaysRaw as string[];

  const vtplRaw = map.get(OuterKey.VTPL);
  if (!(vtplRaw instanceof Map)) return fail('bad-field-type', 'vtpl');
  const vtplMap = vtplRaw as Map<number, unknown>;
  const tier = vtplMap.get(VtplKey.TIER);
  if (tier !== 1 && tier !== 2 && tier !== 3) return fail('bad-field-type', 'vtpl.tier');
  const ctx = vtplMap.get(VtplKey.CTX);
  if (typeof ctx !== 'string') return fail('bad-field-type', 'vtpl.ctx');
  const vexp = vtplMap.get(VtplKey.VEXP);
  if (typeof vexp !== 'number' || !Number.isInteger(vexp) || vexp < 0) {
    return fail('bad-field-type', 'vtpl.vexp');
  }

  // Re-encode body-only (without sig) and verify the signature over its sha256.
  const bodyMap = new Map(map);
  bodyMap.delete(OuterKey.SIG);
  const bodyBytes = cbor.encode(bodyMap);
  const digest = sha256(bodyBytes);
  if (!verify(sigRaw, digest, inv)) return fail('invalid-signature');

  const token: InviteToken = {
    ver: 1,
    iid: new Uint8Array(iid),
    inv: new Uint8Array(inv),
    vtpl: { tier: tier as 1 | 2 | 3, ctx, vexp },
    exp,
    flags,
    relays,
    chp: new Uint8Array(chp),
    sig: new Uint8Array(sigRaw),
  };
  return { ok: true, token };
}

// ---------------------------------------------------------------------------
// Description (for UI — DD §30.3 step 2, consent-before-key)
// ---------------------------------------------------------------------------

export function describeToken(token: InviteToken): InviteTokenDescription {
  return {
    inviterPubkey: bytesToHex(token.inv),
    tier: token.vtpl.tier,
    ctx: token.vtpl.ctx,
    vouchValidityDays: token.vtpl.vexp,
    relays: token.relays,
    charterId: bytesToHex(token.chp),
    expiresAt: token.exp,
    singleUse: (token.flags & InviteFlags.SINGLE_USE) !== 0,
    confirmRequired: (token.flags & InviteFlags.CONFIRM_REQUIRED) !== 0,
  };
}

// ---------------------------------------------------------------------------
// Carriers (DD §30.1)
// ---------------------------------------------------------------------------

const DEFAULT_INVITE_HOST = 'weft.link';

/** `https://<host>/i#<token>` — the fragment form. Browsers do not send fragments to servers. */
export function httpsInviteUrl(tokenStr: string, host: string = DEFAULT_INVITE_HOST): string {
  return `https://${host}/i#${tokenStr}`;
}

/** `weft:i:<token>` — the app-to-app URI scheme. */
export function weftInviteUri(tokenStr: string): string {
  return `weft:i:${tokenStr}`;
}

/**
 * Extract the token from either carrier form. Returns null if unrecognized —
 * the UI shows a "this doesn't look like a Weft invite" card rather than
 * throwing on user input.
 */
export function parseCarrier(carrier: string): string | null {
  if (carrier.startsWith('weft:i:')) return carrier.slice('weft:i:'.length);
  if (carrier.startsWith('https://') || carrier.startsWith('http://')) {
    const hashIdx = carrier.indexOf('#');
    if (hashIdx < 0) return null;
    // Only accept /i paths — resist someone crafting a phishing URL with the
    // fragment carrying a valid token to a wrong-looking page.
    const iPathIdx = carrier.indexOf('/i#');
    if (iPathIdx < 0) return null;
    return carrier.slice(hashIdx + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateBody(body: InviteTokenBody): void {
  if (body.ver !== 1) throw new Error(`unsupported ver: ${body.ver}`);
  if (body.iid.length !== 16) throw new Error(`iid must be 16 bytes; got ${body.iid.length}`);
  if (body.inv.length !== 32) throw new Error(`inv must be 32 bytes; got ${body.inv.length}`);
  if (body.chp.length !== 32) throw new Error(`chp must be 32 bytes; got ${body.chp.length}`);
  if (body.relays.length > 3) throw new Error(`relays must be ≤ 3; got ${body.relays.length}`);
  if (!Number.isInteger(body.exp) || body.exp < 0) throw new Error(`exp must be a non-negative integer`);
  if (!Number.isInteger(body.flags) || body.flags < 0) throw new Error(`flags must be a non-negative integer`);
  if (body.vtpl.tier !== 1 && body.vtpl.tier !== 2 && body.vtpl.tier !== 3) {
    throw new Error(`vtpl.tier must be 1, 2, or 3; got ${body.vtpl.tier}`);
  }
  if (!Number.isInteger(body.vtpl.vexp) || body.vtpl.vexp < 0) {
    throw new Error(`vtpl.vexp must be a non-negative integer`);
  }
}

function expectBytes(v: unknown, len: number, name: string): Uint8Array | string {
  if (v instanceof Uint8Array) {
    if (v.length !== len) return `${name}: expected ${len} bytes, got ${v.length}`;
    return v;
  }
  return `${name}: expected bytes, got ${typeof v}`;
}

function fail(error: DecodeError, detail?: string): DecodeFailure {
  return detail === undefined ? { ok: false, error } : { ok: false, error, detail };
}
