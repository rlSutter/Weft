import { describe, it, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha2';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import {
  generateKeypair,
  publicKeyFromSecret,
  pubkeyHexFromSecret,
  sign,
  verify,
  withEphemeral,
  withEphemeralAsync,
} from '../keys';

// ---------------------------------------------------------------------------
// Roundtrip — build-list M1-T1 acceptance
// ---------------------------------------------------------------------------

describe('sign / verify roundtrip', () => {
  it('signs and verifies with a freshly generated keypair', () => {
    const kp = generateKeypair();
    const msg = sha256(new TextEncoder().encode('koji is a mold'));
    const sig = sign(msg, kp.secret);
    expect(sig.length).toBe(64);
    expect(verify(sig, msg, kp.pubkey)).toBe(true);
  });

  it('publicKeyFromSecret matches generateKeypair', () => {
    const kp = generateKeypair();
    const derived = publicKeyFromSecret(kp.secret);
    expect(bytesToHex(derived)).toBe(bytesToHex(kp.pubkey));
  });

  it('pubkeyHexFromSecret returns 64-char hex', () => {
    const kp = generateKeypair();
    const hex = pubkeyHexFromSecret(kp.secret);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hex).toBe(bytesToHex(kp.pubkey));
  });
});

// ---------------------------------------------------------------------------
// Tamper resistance — build-list M1-T1 acceptance
// ---------------------------------------------------------------------------

describe('verify fails on 1-bit tamper', () => {
  it('rejects a signature with any single bit flipped', () => {
    const kp = generateKeypair();
    const msg = sha256(new TextEncoder().encode('the same message'));
    const sig = sign(msg, kp.secret);

    // Flip one bit in the signature — any bit, any position.
    for (const byteIndex of [0, 1, 31, 32, 63]) {
      for (const bit of [0, 3, 7]) {
        const bad = new Uint8Array(sig);
        bad[byteIndex] ^= 1 << bit;
        expect(verify(bad, msg, kp.pubkey), `sig byte ${byteIndex} bit ${bit}`).toBe(false);
      }
    }
  });

  it('rejects a message with any single bit flipped', () => {
    const kp = generateKeypair();
    const msg = sha256(new TextEncoder().encode('canonical message'));
    const sig = sign(msg, kp.secret);

    for (const byteIndex of [0, 15, 31]) {
      const bad = new Uint8Array(msg);
      bad[byteIndex] ^= 0x01;
      expect(verify(sig, bad, kp.pubkey), `msg byte ${byteIndex}`).toBe(false);
    }
  });

  it('rejects a signature under a different pubkey', () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const msg = sha256(new TextEncoder().encode('signed by A'));
    const sig = sign(msg, kpA.secret);
    expect(verify(sig, msg, kpA.pubkey)).toBe(true);
    expect(verify(sig, msg, kpB.pubkey)).toBe(false);
  });

  it('verify returns false (not throws) on malformed inputs', () => {
    const kp = generateKeypair();
    const msg = sha256(new Uint8Array(0));
    const sig = sign(msg, kp.secret);
    expect(verify(sig.slice(0, 63), msg, kp.pubkey)).toBe(false); // short sig
    expect(verify(sig, msg.slice(0, 31), kp.pubkey)).toBe(false); // short msg
    expect(verify(sig, msg, kp.pubkey.slice(0, 31))).toBe(false); // short pubkey
  });
});

// ---------------------------------------------------------------------------
// BIP-340 test vector — build-list M1-T1 acceptance
// ("test vector from noble's own suite passes")
//
// Source: BIP-340 vector index 0 — a canonical, well-known vector shipped
// with noble/curves and the BIP-340 test suite. If this ever fails, either
// noble's implementation drifted or ours is calling it wrong.
// ---------------------------------------------------------------------------

describe('BIP-340 canonical test vector', () => {
  // Test vector 0 from https://github.com/bitcoin/bips/blob/master/bip-0340/test-vectors.csv
  const secret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000003');
  const pubkey = hexToBytes('F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9');
  const auxRand = hexToBytes('0000000000000000000000000000000000000000000000000000000000000000');
  const message = hexToBytes('0000000000000000000000000000000000000000000000000000000000000000');
  const expectedSig = hexToBytes(
    'E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0',
  );

  it('derives the expected pubkey from the secret', () => {
    expect(bytesToHex(publicKeyFromSecret(secret))).toBe(bytesToHex(pubkey));
  });

  it('produces the expected signature with fixed auxRand', () => {
    const sig = sign(message, secret, auxRand);
    expect(bytesToHex(sig)).toBe(bytesToHex(expectedSig));
  });

  it('verifies the canonical signature', () => {
    expect(verify(expectedSig, message, pubkey)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// withEphemeral — DD §9.1 (ephemeral secrets never linger)
// ---------------------------------------------------------------------------

describe('withEphemeral', () => {
  it('generates a valid keypair inside fn', () => {
    const observed = withEphemeral((kp) => {
      const msg = sha256(new TextEncoder().encode('ephemeral msg'));
      const sig = sign(msg, kp.secret);
      return verify(sig, msg, kp.pubkey);
    });
    expect(observed).toBe(true);
  });

  it("zeroes the secret after fn returns (even if we captured a reference — don't do this)", () => {
    let leakedSecret: Uint8Array | null = null;
    withEphemeral((kp) => {
      leakedSecret = kp.secret;
      // Assert it's non-zero *before* the finally runs.
      expect(leakedSecret.some((b) => b !== 0)).toBe(true);
    });
    // After withEphemeral returned, the finally zeroed our reference.
    expect(leakedSecret).not.toBeNull();
    expect(leakedSecret!.every((b) => b === 0)).toBe(true);
  });

  it('zeroes even when fn throws', () => {
    let leaked: Uint8Array | null = null;
    expect(() => {
      withEphemeral((kp) => {
        leaked = kp.secret;
        throw new Error('boom');
      });
    }).toThrow('boom');
    expect(leaked!.every((b) => b === 0)).toBe(true);
  });

  it('withEphemeralAsync awaits and then zeroes', async () => {
    let leaked: Uint8Array | null = null;
    await withEphemeralAsync(async (kp) => {
      leaked = kp.secret;
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(leaked!.some((b) => b !== 0)).toBe(true);
    });
    expect(leaked!.every((b) => b === 0)).toBe(true);
  });
});
