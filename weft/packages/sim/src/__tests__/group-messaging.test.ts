// M10-T3 sim: group messaging + O(n) key rotation.

import { describe, it, expect } from 'vitest';
import {
  bytesToHex,
  generateGroupKey,
  channelIdForCell,
  buildGroupMessageEvent,
  parseGroupMessageEvent,
  buildGroupRotationEvent,
  extractRotatedGroupKey,
  deriveKSign,
  type NostrEvent,
} from '@weft/core';
import { MockRelay } from '../mock-relay';

interface Member {
  scopeNym: Uint8Array;
  kSign: Uint8Array;
  pSignHex: string;
}

/** Make a member: fake nym_secret, real deriveKSign for cell-scoped signing.
 *  scope_nym is 48 bytes (BLS12-381 G1 compressed) — fake ones just fill. */
function makeMember(scopeId: Uint8Array, seed: bigint, scopeNymByte: number): Member {
  const { kSign, pSign } = deriveKSign(seed, scopeId);
  return {
    scopeNym: new Uint8Array(48).fill(scopeNymByte),
    kSign,
    pSignHex: bytesToHex(pSign),
  };
}

describe('M10-T3 group messaging', () => {
  it('5-member group: sender broadcasts on channel h, all decrypt', async () => {
    const relay = new MockRelay();
    const cellId = 'cc'.repeat(32);
    const channel = channelIdForCell(cellId);
    const groupKey = generateGroupKey();
    const scopeId = new Uint8Array(32).fill(0xa1);

    const members = [1, 2, 3, 4, 5].map((i) =>
      makeMember(scopeId, BigInt(i) * 1234n, 0x10 + i),
    );

    // Every member subscribes to the channel handle.
    const inboxes: NostrEvent[][] = members.map(() => []);
    members.forEach((_, i) => {
      relay.subscribe({ kinds: [4920], h: [channel] }, (evt) => inboxes[i]!.push(evt));
    });

    // Member 0 broadcasts.
    const msg = buildGroupMessageEvent(
      members[0]!.scopeNym,
      'ancient miso finally finished',
      groupKey,
      channel,
    );
    await relay.publish(msg);

    // Every member received it (including the sender).
    for (const inbox of inboxes) {
      expect(inbox).toHaveLength(1);
      const parsed = parseGroupMessageEvent(inbox[0]!, groupKey);
      expect(parsed).not.toBeNull();
      expect(parsed!.body).toBe('ancient miso finally finished');
      expect(Array.from(parsed!.senderScopeNym)).toEqual(Array.from(members[0]!.scopeNym));
    }
  });

  it('relay observers see only kind, h-tag, and ciphertext (no member count, no scope_nym, no cell id)', async () => {
    const cellId = 'dd'.repeat(32);
    const channel = channelIdForCell(cellId);
    const groupKey = generateGroupKey();
    const scopeNym = new Uint8Array(48).fill(0x42);

    const msg = buildGroupMessageEvent(scopeNym, 'test body', groupKey, channel);

    // Serialize the full event as it would appear on the wire.
    const wire = JSON.stringify(msg);

    // Channel handle is visible (that's expected).
    expect(wire).toContain(channel);
    // Cell id is NOT visible (channel handle is a hash — irreversible).
    expect(wire).not.toContain(cellId);
    // Sender scope_nym is NOT visible (it's inside the ciphertext).
    expect(wire).not.toContain(bytesToHex(scopeNym));
    // Body text is NOT visible.
    expect(wire).not.toContain('test body');
    // Outer pubkey is an ephemeral, not any known identity — nothing to
    // assert positively, but note it's not a real member's key.
    expect(msg.pubkey).toBeDefined();
    expect(msg.kind).toBe(4920);
  });

  it('wrong group key yields null (tamper resistance via AEAD)', () => {
    const scopeNym = new Uint8Array(48).fill(0x77);
    const goodKey = generateGroupKey();
    const badKey = generateGroupKey();
    const msg = buildGroupMessageEvent(
      scopeNym, 'body', goodKey, channelIdForCell('ee'.repeat(32)),
    );
    expect(parseGroupMessageEvent(msg, badKey)).toBeNull();
  });
});

describe('M10-T3 rotation', () => {
  it('rotation re-keys all recipients; each recovers the new key with their k_sign', () => {
    const cellId = 'ff'.repeat(32);
    const channel = channelIdForCell(cellId);
    const scopeId = new Uint8Array(32).fill(0xb0);

    const members = [1, 2, 3, 4, 5].map((i) =>
      makeMember(scopeId, BigInt(i) * 7777n, 0x20 + i),
    );

    const newGroupKey = generateGroupKey();
    const rotationEvt = buildGroupRotationEvent(
      newGroupKey,
      members.map((m) => m.pSignHex),
      channel,
    );

    // Every member can extract the new key.
    for (const m of members) {
      const recovered = extractRotatedGroupKey(rotationEvt, m.pSignHex, m.kSign);
      expect(recovered).not.toBeNull();
      expect(Array.from(recovered!)).toEqual(Array.from(newGroupKey));
    }
  });

  it('ejected members cannot recover the new key (their p_sign is not in the wraps)', () => {
    const cellId = 'ab'.repeat(32);
    const channel = channelIdForCell(cellId);
    const scopeId = new Uint8Array(32).fill(0xc0);

    const membersAll = [1, 2, 3].map((i) => makeMember(scopeId, BigInt(i) * 99n, 0x30 + i));
    const ejected = membersAll[1]!;
    const remaining = [membersAll[0]!, membersAll[2]!];

    const newGroupKey = generateGroupKey();
    const rotationEvt = buildGroupRotationEvent(
      newGroupKey,
      remaining.map((m) => m.pSignHex),
      channel,
    );

    // Remaining members recover.
    for (const m of remaining) {
      expect(extractRotatedGroupKey(rotationEvt, m.pSignHex, m.kSign)).not.toBeNull();
    }
    // Ejected member gets null.
    expect(extractRotatedGroupKey(rotationEvt, ejected.pSignHex, ejected.kSign)).toBeNull();
  });

  it('rotation content reveals recipient count but not identities beyond p_sign', () => {
    const cellId = 'ba'.repeat(32);
    const channel = channelIdForCell(cellId);
    const scopeId = new Uint8Array(32).fill(0xd0);
    const members = [1, 2, 3].map((i) => makeMember(scopeId, BigInt(i), 0x40 + i));

    const rotationEvt = buildGroupRotationEvent(
      generateGroupKey(),
      members.map((m) => m.pSignHex),
      channel,
    );

    // p_sign hex values are inherently public within the group (they're on
    // the roster). They appear in the event content — that's expected.
    const wire = JSON.stringify(rotationEvt);
    for (const m of members) {
      expect(wire).toContain(m.pSignHex);
    }
    // But scope_nyms are NOT in the rotation event (they're separately in
    // the encrypted roster).
    for (const m of members) {
      expect(wire).not.toContain(bytesToHex(m.scopeNym));
    }
  });
});
