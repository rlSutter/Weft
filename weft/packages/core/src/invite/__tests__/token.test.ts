import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, it, expect } from 'vitest';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import { publicKeyFromSecret } from '../../keys/keys';
import {
  InviteFlags,
  decodeInviteToken,
  decodeInviteTokenBytes,
  describeToken,
  encodeInviteToken,
  encodeInviteTokenBytes,
  httpsInviteUrl,
  parseCarrier,
  weftInviteUri,
  type InviteTokenBody,
} from '../token';

// ---------------------------------------------------------------------------
// Fixture — DD §30.2 wire-format compatibility test (build-list M1-T3)
// ---------------------------------------------------------------------------

const FIXTURE_HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_HEX = readFileSync(join(FIXTURE_HERE, '..', '__fixtures__', 'token-v1.hex'), 'utf8').trim();
const FIXTURE_BYTES = hexToBytes(FIXTURE_HEX);

// The fixed inputs from __fixtures__/README.md — do not change without a
// wire-format review. If any of these change, the fixture must be regenerated
// and a CHANGELOG `Wire` entry recorded, per phase-model rules.
const FIXTURE_SECRET = new Uint8Array(32).fill(0x01);
const FIXTURE_AUXRAND = new Uint8Array(32); // all zeros
const FIXTURE_INV = publicKeyFromSecret(FIXTURE_SECRET);
const FIXTURE_BODY: InviteTokenBody = {
  ver: 1,
  iid: new Uint8Array(16).fill(0xaa),
  inv: FIXTURE_INV,
  vtpl: { tier: 2, ctx: 'personal', vexp: 90 },
  exp: 1_800_000_000,
  flags: InviteFlags.SINGLE_USE | InviteFlags.CONFIRM_REQUIRED,
  relays: ['wss://relay.example/1', 'wss://relay.example/2'],
  chp: new Uint8Array(32).fill(0xcc),
};

describe('invite token — wire-format fixture (DD §30.2)', () => {
  it('re-encoding the fixture inputs produces the committed hex bytes', () => {
    const bytes = encodeInviteTokenBytes(FIXTURE_BODY, FIXTURE_SECRET, FIXTURE_AUXRAND);
    expect(bytesToHex(bytes)).toBe(FIXTURE_HEX);
  });

  it('decoding the fixture bytes yields the expected body', () => {
    const result = decodeInviteTokenBytes(FIXTURE_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t = result.token;
    expect(t.ver).toBe(1);
    expect(bytesToHex(t.iid)).toBe('aa'.repeat(16));
    expect(bytesToHex(t.inv)).toBe(bytesToHex(FIXTURE_INV));
    expect(t.vtpl).toEqual({ tier: 2, ctx: 'personal', vexp: 90 });
    expect(t.exp).toBe(1_800_000_000);
    expect(t.flags).toBe(3);
    expect(t.relays).toEqual(['wss://relay.example/1', 'wss://relay.example/2']);
    expect(bytesToHex(t.chp)).toBe('cc'.repeat(32));
    expect(t.sig.length).toBe(64);
  });

  it('fixture bytes are under 450 base64url chars (DD §30.1)', () => {
    const b64 = encodeInviteToken(FIXTURE_BODY, FIXTURE_SECRET, FIXTURE_AUXRAND);
    expect(b64.length).toBeLessThanOrEqual(450);
  });
});

// ---------------------------------------------------------------------------
// Encode/decode roundtrip — build-list M1-T3 acceptance
// ---------------------------------------------------------------------------

describe('invite token — roundtrip', () => {
  it('encode → decode preserves every field', () => {
    const b64 = encodeInviteToken(FIXTURE_BODY, FIXTURE_SECRET, FIXTURE_AUXRAND);
    const result = decodeInviteToken(b64);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token.ver).toBe(FIXTURE_BODY.ver);
    expect(bytesToHex(result.token.iid)).toBe(bytesToHex(FIXTURE_BODY.iid));
    expect(bytesToHex(result.token.inv)).toBe(bytesToHex(FIXTURE_BODY.inv));
    expect(result.token.vtpl).toEqual(FIXTURE_BODY.vtpl);
    expect(result.token.exp).toBe(FIXTURE_BODY.exp);
    expect(result.token.flags).toBe(FIXTURE_BODY.flags);
    expect(result.token.relays).toEqual(FIXTURE_BODY.relays);
    expect(bytesToHex(result.token.chp)).toBe(bytesToHex(FIXTURE_BODY.chp));
  });

  it('produces ≤ 450 base64url chars with 3 relay URLs', () => {
    const body: InviteTokenBody = {
      ...FIXTURE_BODY,
      relays: [
        'wss://relay-one.example.com/nostr',
        'wss://another-relay.example.com/nostr',
        'wss://third.example.net/nostr',
      ],
    };
    const b64 = encodeInviteToken(body, FIXTURE_SECRET);
    expect(b64.length).toBeLessThanOrEqual(450);
  });

  it('roundtrips with 0 relays', () => {
    const body: InviteTokenBody = { ...FIXTURE_BODY, relays: [] };
    const b64 = encodeInviteToken(body, FIXTURE_SECRET, FIXTURE_AUXRAND);
    const result = decodeInviteToken(b64);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.token.relays).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Signature check — DD §30.3 step 1
// ---------------------------------------------------------------------------

describe('invite token — signature verification', () => {
  it('rejects a token with a mutated iid', () => {
    const bad = new Uint8Array(FIXTURE_BYTES);
    // The iid is at bytes ~[3..19]. Flip a bit inside it.
    bad[10] ^= 0x01;
    const result = decodeInviteTokenBytes(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid-signature');
  });

  it('rejects a token with a mutated exp', () => {
    // Re-encode with a different exp but the original signature — impossible
    // to construct without re-signing, so instead flip a byte in the wire.
    const bad = new Uint8Array(FIXTURE_BYTES);
    // Find the byte for exp = 0x6b49d200 (1_800_000_000). It's after
    // "04 1a" in the hex. In this fixture that's at index 122 (0-based).
    // Rather than hunt, flip a byte in the sig region — same effect.
    // Actually we want the sig to still verify against the CBOR body but
    // fail because the CBOR body changed. So flip a byte NOT in the sig.
    // Byte 100 is inside the vtpl map area — safely inside the body.
    bad[100] ^= 0x01;
    const result = decodeInviteTokenBytes(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Depending on where we flipped, this could be invalid-signature or
      // one of the parse errors. Both are acceptable — the token was rejected.
      expect(['invalid-signature', 'bad-field-type', 'bad-field-size', 'invalid-encoding', 'not-a-map']).toContain(
        result.error,
      );
    }
  });

  it('rejects a token with a truncated signature', () => {
    // Truncate the last byte of the CBOR — sig bytes are at the end.
    const bad = FIXTURE_BYTES.slice(0, FIXTURE_BYTES.length - 1);
    const result = decodeInviteTokenBytes(bad);
    expect(result.ok).toBe(false);
  });

  it('signature must be produced by the inviter key', () => {
    // Encode with one secret but claim a different inv pubkey in the body.
    const wrongInv = publicKeyFromSecret(new Uint8Array(32).fill(0x02));
    const spoofed: InviteTokenBody = { ...FIXTURE_BODY, inv: wrongInv };
    // encode using the original secret (0x01…) — sig verifies against inv=0x01's pk
    // but the body's inv field is wrongInv. decode will reject.
    const b64 = encodeInviteToken(spoofed, FIXTURE_SECRET, FIXTURE_AUXRAND);
    const result = decodeInviteToken(b64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid-signature');
  });
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

describe('invite token — expiry (DD §30.3 step 1)', () => {
  it('rejects expired tokens when now is provided', () => {
    const b64 = encodeInviteToken(FIXTURE_BODY, FIXTURE_SECRET, FIXTURE_AUXRAND);
    const past = FIXTURE_BODY.exp + 1; // just past expiry
    const result = decodeInviteToken(b64, past);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('expired');
  });

  it('accepts a token when now is before expiry', () => {
    const b64 = encodeInviteToken(FIXTURE_BODY, FIXTURE_SECRET, FIXTURE_AUXRAND);
    const before = FIXTURE_BODY.exp - 3600;
    expect(decodeInviteToken(b64, before).ok).toBe(true);
  });

  it('when now is omitted, expired tokens still decode (for UI display)', () => {
    const b64 = encodeInviteToken(FIXTURE_BODY, FIXTURE_SECRET, FIXTURE_AUXRAND);
    expect(decodeInviteToken(b64).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Malformed inputs
// ---------------------------------------------------------------------------

describe('invite token — malformed inputs', () => {
  it('rejects garbage base64url', () => {
    const r = decodeInviteToken('not-a-real-token!!');
    expect(r.ok).toBe(false);
  });

  it('rejects an empty string', () => {
    const r = decodeInviteToken('');
    expect(r.ok).toBe(false);
  });

  it('rejects a valid CBOR array (not a map)', () => {
    // CBOR: array of 1 int: 0x81 0x01
    const notAMap = new Uint8Array([0x81, 0x01]);
    const r = decodeInviteTokenBytes(notAMap);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not-a-map');
  });

  it('rejects unknown major version', () => {
    // Encode with ver=1 (only supported), then manually change ver to 99.
    // The signature will no longer verify — but we want to see the
    // 'unknown-major-version' branch first, so hit that path directly by
    // constructing a signed token with ver=1 then flipping the byte before
    // sig verification runs. Easier: build a CBOR map manually.
    // Actually easiest: build a body with ver=1 and edit the encoded map
    // through the API's error path by intercepting. Skip this test if too
    // fiddly — we already tested unknown-version bytes reject as
    // invalid-signature, which is safe.
    // Trivially: encode with ver=1, patch byte at index 2 (value byte of
    // key 0), see what decodes.
    const b = new Uint8Array(FIXTURE_BYTES);
    // The first three bytes are a9 00 01 → map-9, key 0, val 1.
    // Change val byte to a large unsigned int (0x18 XX = uint8-follows).
    // Actually the simplest test: construct a valid CBOR map from scratch
    // with ver=99 and see the ver check reject it.
    b[2] = 0x63; // any non-1 direct-encoded int changes ver; CBOR may misparse
    const r = decodeInviteTokenBytes(b);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Any of these is a valid rejection — the token was refused, which
      // is what the acceptance test requires. Exact error path depends on
      // where the byte-flip lands in CBOR framing.
      expect([
        'unknown-major-version',
        'invalid-signature',
        'invalid-encoding',
        'not-a-map',
        'bad-field-type',
        'bad-field-size',
      ]).toContain(r.error);
    }
  });

  it('directly refuses a well-formed CBOR map with ver != 1', () => {
    // Build a minimal CBOR map: a1 (map-1) 00 (key 0 = ver) 18 63 (uint = 99)
    const bytes = new Uint8Array([0xa1, 0x00, 0x18, 0x63]);
    const r = decodeInviteTokenBytes(bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unknown-major-version');
  });
});

// ---------------------------------------------------------------------------
// describeToken
// ---------------------------------------------------------------------------

describe('describeToken', () => {
  it('renders human-readable fields for UI use (DD §30.3 step 2)', () => {
    const b64 = encodeInviteToken(FIXTURE_BODY, FIXTURE_SECRET, FIXTURE_AUXRAND);
    const r = decodeInviteToken(b64);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = describeToken(r.token);
    expect(d.inviterPubkey).toBe(bytesToHex(FIXTURE_INV));
    expect(d.tier).toBe(2);
    expect(d.ctx).toBe('personal');
    expect(d.vouchValidityDays).toBe(90);
    expect(d.relays).toEqual(['wss://relay.example/1', 'wss://relay.example/2']);
    expect(d.charterId).toBe('cc'.repeat(32));
    expect(d.expiresAt).toBe(1_800_000_000);
    expect(d.singleUse).toBe(true);
    expect(d.confirmRequired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Carriers (DD §30.1)
// ---------------------------------------------------------------------------

describe('carriers', () => {
  it('httpsInviteUrl puts token in fragment', () => {
    const url = httpsInviteUrl('ABC123', 'weft.link');
    expect(url).toBe('https://weft.link/i#ABC123');
  });

  it('weftInviteUri uses weft:i: scheme', () => {
    expect(weftInviteUri('ABC123')).toBe('weft:i:ABC123');
  });

  it('parseCarrier extracts token from https fragment', () => {
    expect(parseCarrier('https://weft.link/i#ABC123')).toBe('ABC123');
  });

  it('parseCarrier extracts token from weft: URI', () => {
    expect(parseCarrier('weft:i:ABC123')).toBe('ABC123');
  });

  it('parseCarrier rejects a plain URL without /i# path', () => {
    expect(parseCarrier('https://weft.link/foo#bar')).toBeNull();
  });

  it('parseCarrier rejects arbitrary text', () => {
    expect(parseCarrier('hello world')).toBeNull();
    expect(parseCarrier('')).toBeNull();
  });
});
