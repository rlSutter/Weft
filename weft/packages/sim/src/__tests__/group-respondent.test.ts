// M10-T5 sim: group-as-respondent (F9 completion).
//
// A greeter publishes a 4911 group-interest declaration (encrypted under
// the group key). An authorized member sees a matching ask and emits a
// grp-tagged 4912 reply carrying a scope-bound credential presentation.
// An unauthorized holder-of-a-credential cannot construct a valid reply.

import { describe, it, expect } from 'vitest';
import {
  bytesToHex,
  generateKeypair,
  generateGroupKey,
  channelIdForCell,
  buildInterestDeclarationEvent,
  parseInterestDeclarationEvent,
  isAuthorizedToRespond,
  buildGroupMatchReply,
  parseGroupMatchReply,
  verifyGroupMatchReply,
  currentEpoch,
  requestCredential,
  issueCredential,
  verifyCredential,
  presentCredential,
  generateIssuerKeypair,
  type CleartextAttrs,
  type NostrEvent,
} from '@weft/core';
import { MockRelay } from '../mock-relay';

async function mintMember(scopeId: Uint8Array, issuerBbs: { secretKey: Uint8Array; publicKey: Uint8Array }): Promise<{
  presentation: Awaited<ReturnType<typeof presentCredential>>;
}> {
  const cleartext: CleartextAttrs = {
    tier: 2,
    ctx: 'ferm',
    issued_epoch: currentEpoch(),
    expiry_epoch: currentEpoch() + 4,
    issuer_scope_tag: new Uint8Array(32).fill(9),
  };
  const { request, state } = await requestCredential(cleartext);
  const cred = await issueCredential(request, issuerBbs.secretKey, issuerBbs.publicKey);
  await verifyCredential(cred, state);
  const presentation = await presentCredential(
    cred, state, [], scopeId, new Uint8Array(16).fill(1),
  );
  return { presentation };
}

describe('M10-T5 group-as-respondent (F9)', () => {
  it('4911 declaration: encrypted content — wrong group key returns null; right key parses', async () => {
    const groupKey = generateGroupKey();
    const badKey = generateGroupKey();
    const greeter = generateKeypair();
    const cellId = 'aa'.repeat(32);
    const channel = channelIdForCell(cellId);

    const evt = buildInterestDeclarationEvent(
      {
        cellId,
        interests: [
          { label: 'koji', embedding: '11'.repeat(384) },
          { label: 'natto', embedding: '22'.repeat(384) },
        ],
        authorizedScopeNyms: ['aa'.repeat(48), 'bb'.repeat(48)],
        issuedAt: 1_800_000_000,
      },
      groupKey,
      greeter.secret,
      channel,
    );

    expect(evt.kind).toBe(4911);
    // Wrong key → null.
    expect(parseInterestDeclarationEvent(evt, badKey)).toBeNull();
    // Right key → decrypted declaration.
    const parsed = parseInterestDeclarationEvent(evt, groupKey);
    expect(parsed).not.toBeNull();
    expect(parsed!.cellId).toBe(cellId);
    expect(parsed!.interests).toHaveLength(2);
    expect(parsed!.interests[0]!.label).toBe('koji');
    expect(parsed!.authorizedScopeNyms).toHaveLength(2);
  });

  it('relay observers see only kind + h-tag + ciphertext (interests never leak)', () => {
    const groupKey = generateGroupKey();
    const greeter = generateKeypair();
    const cellId = 'bb'.repeat(32);
    const channel = channelIdForCell(cellId);

    const evt = buildInterestDeclarationEvent(
      {
        cellId,
        interests: [{ label: 'koji_fermentation', embedding: '11'.repeat(384) }],
        authorizedScopeNyms: ['aa'.repeat(48)],
        issuedAt: 1_800_000_000,
      },
      groupKey,
      greeter.secret,
      channel,
    );

    const wire = JSON.stringify(evt);
    // Cell id NOT visible (channel handle is a hash).
    expect(wire).not.toContain(cellId);
    // The interest label NOT visible.
    expect(wire).not.toContain('koji_fermentation');
    // Authorized scope_nym hex NOT visible.
    expect(wire).not.toContain('aa'.repeat(48));
    // Channel handle IS visible (that's how members subscribe).
    expect(wire).toContain(channel);
  });

  it('authorized member: constructs a valid grp reply that verifies', async () => {
    const scopeId = new Uint8Array(32).fill(0xc1);
    const issuerBbs = await generateIssuerKeypair();
    const { presentation: memberPres } = await mintMember(scopeId, issuerBbs);

    const declaration = {
      v: 1,
      cellId: bytesToHex(scopeId),
      interests: [{ label: 'x', embedding: '00'.repeat(384) }],
      // Authorize this member's scope_nym.
      authorizedScopeNyms: [bytesToHex(memberPres.pseudonym)],
      issuedAt: 1_800_000_000,
    };

    expect(isAuthorizedToRespond(declaration, memberPres.pseudonym)).toBe(true);

    const reply = buildGroupMatchReply(
      { scoreBucket: 'high', hopEstimate: 2 },
      memberPres,
    );
    expect(reply.kind).toBe(4912);
    expect(reply.tags.some((t) => t[0] === 'grp')).toBe(true);

    const parsed = parseGroupMatchReply(reply);
    expect(parsed).not.toBeNull();
    expect(parsed!.reply.scoreBucket).toBe('high');
    expect(parsed!.reply.hopEstimate).toBe(2);

    // Full verification: presentation validates + scope binding + auth check.
    expect(verifyGroupMatchReply(parsed!.presentation, declaration, issuerBbs.publicKey)).toBe(true);
  });

  it('unauthorized member (holds a valid credential but not on authorized list) cannot produce a verifying reply', async () => {
    const scopeId = new Uint8Array(32).fill(0xc2);
    const issuerBbs = await generateIssuerKeypair();
    const { presentation: memberPres } = await mintMember(scopeId, issuerBbs);

    const declaration = {
      v: 1,
      cellId: bytesToHex(scopeId),
      interests: [{ label: 'x', embedding: '00'.repeat(384) }],
      // Authorize a DIFFERENT scope_nym (not this member).
      authorizedScopeNyms: ['ff'.repeat(48)],
      issuedAt: 1_800_000_000,
    };

    expect(isAuthorizedToRespond(declaration, memberPres.pseudonym)).toBe(false);

    // The member CAN still construct a grp reply — the wire is unauthenticated
    // at construction — but verifyGroupMatchReply rejects it.
    const reply = buildGroupMatchReply(
      { scoreBucket: 'high', hopEstimate: 2 },
      memberPres,
    );
    const parsed = parseGroupMatchReply(reply)!;
    expect(verifyGroupMatchReply(parsed.presentation, declaration, issuerBbs.publicKey)).toBe(false);
  });

  it('cross-cell reply is rejected (scope_id mismatch)', async () => {
    const cellA = new Uint8Array(32).fill(0xd1);
    const cellB = new Uint8Array(32).fill(0xd2);
    const issuerBbs = await generateIssuerKeypair();
    // Member presents against cell A.
    const { presentation: aPres } = await mintMember(cellA, issuerBbs);

    // Cell B's declaration authorizes aPres.pseudonym (implausible, but
    // the test isolates the scope_id check).
    const bDeclaration = {
      v: 1,
      cellId: bytesToHex(cellB),
      interests: [{ label: 'x', embedding: '00'.repeat(384) }],
      authorizedScopeNyms: [bytesToHex(aPres.pseudonym)],
      issuedAt: 1_800_000_000,
    };

    // Even though authorized "on paper", the presentation is bound to
    // cellA — verifyGroupMatchReply rejects.
    expect(verifyGroupMatchReply(aPres, bDeclaration, issuerBbs.publicKey)).toBe(false);
  });

  it('members subscribe to channel h and receive the declaration', async () => {
    const relay = new MockRelay();
    const groupKey = generateGroupKey();
    const greeter = generateKeypair();
    const cellId = 'ee'.repeat(32);
    const channel = channelIdForCell(cellId);

    const inbox: NostrEvent[] = [];
    relay.subscribe({ kinds: [4911], h: [channel] }, (evt) => inbox.push(evt));

    const evt = buildInterestDeclarationEvent(
      {
        cellId,
        interests: [{ label: 'x', embedding: '00'.repeat(384) }],
        authorizedScopeNyms: [],
        issuedAt: 1_800_000_000,
      },
      groupKey,
      greeter.secret,
      channel,
    );
    await relay.publish(evt);

    expect(inbox).toHaveLength(1);
    const parsed = parseInterestDeclarationEvent(inbox[0]!, groupKey);
    expect(parsed).not.toBeNull();
  });
});
