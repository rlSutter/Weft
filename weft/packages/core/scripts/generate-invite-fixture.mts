// Generate the invite-token wire-format fixture.
//
// Run this once, capture stdout, commit to __fixtures__/token-v1.hex.
// Re-running should produce identical bytes — if it doesn't, either
// cbor-x's output changed (upgrade regression) or something in the
// encoder was modified. Either is a wire-format concern.
//
// Node 22+: node --experimental-strip-types scripts/generate-invite-fixture.mts

import { encodeInviteTokenBytes, InviteFlags, type InviteTokenBody } from '../src/invite/token.ts';
import { bytesToHex } from '@noble/hashes/utils';

// ---- Fixed inputs — do not change without a wire-format review. ----
const secret = new Uint8Array(32).fill(0x01);
const auxRand = new Uint8Array(32); // all zeros → deterministic BIP-340 sig

// Inviter pubkey is derived from secret; we hardcode nothing about it here.
import { publicKeyFromSecret } from '../src/keys/keys.ts';

const body: InviteTokenBody = {
  ver: 1,
  iid: new Uint8Array(16).fill(0xaa),
  inv: publicKeyFromSecret(secret),
  vtpl: { tier: 2, ctx: 'personal', vexp: 90 },
  exp: 1_800_000_000, // ~2027
  flags: InviteFlags.SINGLE_USE | InviteFlags.CONFIRM_REQUIRED, // 3
  relays: ['wss://relay.example/1', 'wss://relay.example/2'],
  chp: new Uint8Array(32).fill(0xcc),
};

const bytes = encodeInviteTokenBytes(body, secret, auxRand);
console.log(bytesToHex(bytes));
console.error(`length: ${bytes.length} bytes`);
console.error(`inviter pubkey: ${bytesToHex(body.inv)}`);
