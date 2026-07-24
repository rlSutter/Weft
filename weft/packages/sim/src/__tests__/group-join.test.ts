// M10-T2 sim: full group join flow with blind issuance.
//
// Verifies the load-bearing property of DD §36.2's greeter-blind-issuance
// amendment: the greeter's view of the join path contains no field whose
// value is the joiner's real identity pubkey. Even if the greeter logged
// everything they saw, they could not build a real-identity → scope_nym
// mapping.

import { describe, it, expect } from 'vitest';
import {
  bytesToHex,
  generateKeypair,
  wrap,
  unwrap,
  currentEpoch,
  requestCredential,
  issueCredential,
  verifyCredential,
  presentCredential,
  generateIssuerKeypair,
  encryptRoster,
  emptyRoster,
  addMember,
  isMember,
  isEjected,
  buildJoinRequestEvent,
  parseJoinRequestEvent,
  buildMembershipGrantEvent,
  parseMembershipGrantEvent,
  buildConsentReceiptEvent,
  parseConsentReceiptEvent,
  deriveKSign,
  generateGroupKey,
  verifyPresentation,
  type CleartextAttrs,
  type NostrEvent,
} from '@weft/core';
import { MockRelay } from '../mock-relay';

/** Fixture: mint a credential for a joiner, ready to present in a scope. */
async function mintCredential(): Promise<{
  cred: Awaited<ReturnType<typeof issueCredential>>;
  state: Awaited<ReturnType<typeof requestCredential>>['state'];
  issuerBbs: { secretKey: Uint8Array; publicKey: Uint8Array };
}> {
  const issuerBbs = await generateIssuerKeypair();
  const cleartext: CleartextAttrs = {
    tier: 2,
    ctx: 'ferm',
    issued_epoch: currentEpoch(),
    expiry_epoch: currentEpoch() + 4,
    issuer_scope_tag: new Uint8Array(32).fill(7),
  };
  const { request, state } = await requestCredential(cleartext);
  const cred = await issueCredential(request, issuerBbs.secretKey, issuerBbs.publicKey);
  await verifyCredential(cred, state);
  return { cred, state, issuerBbs };
}

describe('M10-T2 join flow — blind issuance', () => {
  it('happy path: valid credential → grant delivered to p_join_eph, consent signed by k_sign', async () => {
    const relay = new MockRelay();
    const scopeId = new Uint8Array(32).fill(0xa1);

    // Greeter identity — the greeter IS learned by the joiner; only the
    // joiner is blinded from the greeter.
    const greeter = generateKeypair();

    // Group state the greeter maintains.
    let roster = emptyRoster();
    const groupKey = generateGroupKey();
    const charterEventId = 'aa'.repeat(32); // stand-in for a real charter id

    // --- Joiner side ---
    // (a) real identity — never touches the join wire
    const joinerIdentity = generateKeypair();
    const { cred, state, issuerBbs } = await mintCredential();

    // (b) present credential in cell scope
    const ph = new Uint8Array(16).fill(0xff);
    const presentation = await presentCredential(cred, state, [0], scopeId, ph);

    // (c) derive cell-scoped signing keypair
    const { kSign, pSign } = deriveKSign(state.nymSecret!, scopeId);

    // (d) generate fresh ephemeral delivery keypair
    const eph = generateKeypair();

    // (e) build 4932, wrap to greeter
    const req4932 = buildJoinRequestEvent(
      {
        scopeId: bytesToHex(scopeId),
        scopeNym: bytesToHex(presentation.pseudonym),
        pSign: bytesToHex(pSign),
        presentation: {
          proof: bytesToHex(presentation.proof),
          disclosedIndexes: [...presentation.disclosedIndexes],
          disclosedMessages: presentation.disclosedMessages.map(bytesToHex),
          header: bytesToHex(presentation.header),
          presentationHeader: bytesToHex(presentation.presentationHeader),
          scopeId: bytesToHex(presentation.scopeId),
          pseudonym: bytesToHex(presentation.pseudonym),
        },
      },
      eph.secret,
    );
    const wrappedReq = wrap(req4932, bytesToHex(greeter.pubkey));

    // (f) joiner subscribes to p_join_eph immediately after publishing.
    // (In a real client this happens in the same tick as publish.)
    const joinerInbox: NostrEvent[] = [];
    relay.subscribe(
      { kinds: [1059], p: [bytesToHex(eph.pubkey)] },
      (evt) => joinerInbox.push(evt),
    );

    // Greeter subscribes to their identity pubkey.
    const greeterInbox: NostrEvent[] = [];
    relay.subscribe(
      { kinds: [1059], p: [bytesToHex(greeter.pubkey)] },
      (evt) => greeterInbox.push(evt),
    );

    await relay.publish(wrappedReq);
    expect(greeterInbox).toHaveLength(1);

    // --- Greeter side ---
    const unwrappedForGreeter = unwrap(greeterInbox[0]!, greeter.secret);
    expect(unwrappedForGreeter).not.toBeNull();
    expect(unwrappedForGreeter!.inner.kind).toBe(4932);

    // BLINDNESS PROPERTY: inner.pubkey is p_join_eph, not the joiner's
    // identity pubkey. Neither the inner event's serialization nor the
    // wrapper's outer bytes contain the joiner's identity anywhere.
    expect(unwrappedForGreeter!.inner.pubkey).toBe(bytesToHex(eph.pubkey));
    expect(unwrappedForGreeter!.inner.pubkey).not.toBe(bytesToHex(joinerIdentity.pubkey));

    const parsed = parseJoinRequestEvent(unwrappedForGreeter!.inner);
    expect(parsed).not.toBeNull();

    // Greeter verifies the credential presentation.
    const presentationOK = verifyPresentation(parsed!.presentation, issuerBbs.publicKey);
    expect(presentationOK).toBe(true);

    // Greeter checks the roster: scope_nym must not be active or ejected.
    expect(isMember(roster, presentation.pseudonym)).toBe(false);
    expect(isEjected(roster, presentation.pseudonym)).toBe(false);

    // Add to roster, encrypt.
    roster = addMember(roster, presentation.pseudonym);
    const rosterEnvelope = encryptRoster(roster, groupKey);

    // Build 4933 grant, wrap to p_join_eph (NOT joiner identity).
    const grant4933 = buildMembershipGrantEvent(
      {
        groupKey: bytesToHex(groupKey),
        encryptedRoster: bytesToHex(rosterEnvelope),
        charterEventId,
      },
      greeter.secret,
    );
    const wrappedGrant = wrap(grant4933, bytesToHex(eph.pubkey));
    await relay.publish(wrappedGrant);
    expect(joinerInbox).toHaveLength(1);

    // --- Joiner receives grant (via ephemeral) ---
    const unwrappedForJoiner = unwrap(joinerInbox[0]!, eph.secret);
    expect(unwrappedForJoiner).not.toBeNull();
    const grant = parseMembershipGrantEvent(unwrappedForJoiner!.inner);
    expect(grant).not.toBeNull();
    expect(grant!.groupKey).toBe(bytesToHex(groupKey));
    expect(grant!.charterEventId).toBe(charterEventId);

    // --- Joiner signs 4922 consent with k_sign (NOT identity) ---
    const receipt4922 = buildConsentReceiptEvent(
      {
        charterEventId,
        scopeNym: bytesToHex(presentation.pseudonym),
      },
      kSign,
    );
    // Signed by pSign, never by identity.
    expect(receipt4922.pubkey).toBe(bytesToHex(pSign));
    expect(receipt4922.pubkey).not.toBe(bytesToHex(joinerIdentity.pubkey));

    // Wrap to greeter and publish.
    const wrappedReceipt = wrap(receipt4922, bytesToHex(greeter.pubkey));
    await relay.publish(wrappedReceipt);
    expect(greeterInbox).toHaveLength(2);

    const unwrappedReceipt = unwrap(greeterInbox[1]!, greeter.secret);
    expect(unwrappedReceipt).not.toBeNull();
    const consent = parseConsentReceiptEvent(unwrappedReceipt!.inner);
    expect(consent).not.toBeNull();
    // Greeter binds the consent to the earlier 4932: signerPubkey === pSign.
    expect(consent!.signerPubkey).toBe(parsed!.request.pSign);
    expect(consent!.receipt.scopeNym).toBe(bytesToHex(presentation.pseudonym));
  });

  it('a captured greeter cannot map identity → scope_nym from their observed view', async () => {
    const relay = new MockRelay();
    const scopeId = new Uint8Array(32).fill(0xa2);
    const greeter = generateKeypair();
    const joinerIdentity = generateKeypair();
    const { cred, state } = await mintCredential();

    const presentation = await presentCredential(
      cred, state, [0], scopeId, new Uint8Array(16).fill(0x11),
    );
    const { pSign } = deriveKSign(state.nymSecret!, scopeId);
    const eph = generateKeypair();
    const req4932 = buildJoinRequestEvent(
      {
        scopeId: bytesToHex(scopeId),
        scopeNym: bytesToHex(presentation.pseudonym),
        pSign: bytesToHex(pSign),
        presentation: {
          proof: bytesToHex(presentation.proof),
          disclosedIndexes: [...presentation.disclosedIndexes],
          disclosedMessages: presentation.disclosedMessages.map(bytesToHex),
          header: bytesToHex(presentation.header),
          presentationHeader: bytesToHex(presentation.presentationHeader),
          scopeId: bytesToHex(presentation.scopeId),
          pseudonym: bytesToHex(presentation.pseudonym),
        },
      },
      eph.secret,
    );
    const wrappedReq = wrap(req4932, bytesToHex(greeter.pubkey));

    const captured: NostrEvent[] = [];
    relay.subscribe(
      { kinds: [1059], p: [bytesToHex(greeter.pubkey)] },
      (evt) => captured.push(evt),
    );
    await relay.publish(wrappedReq);

    // The FULL byte content the greeter sees, across the outer wrapper and
    // the decrypted inner event. If the joiner's identity pubkey appears
    // *anywhere* in this, blind issuance has failed.
    const outerBytes = JSON.stringify(captured[0]!);
    const unwrappedForGreeter = unwrap(captured[0]!, greeter.secret)!;
    const innerBytes = JSON.stringify(unwrappedForGreeter.inner);
    const combined = outerBytes + innerBytes;

    const joinerIdentityHex = bytesToHex(joinerIdentity.pubkey);
    expect(combined).not.toContain(joinerIdentityHex);
  });

  it('rejects a join whose scope_nym is already active in the roster', async () => {
    const scopeId = new Uint8Array(32).fill(0xb0);
    let roster = emptyRoster();
    const { cred, state } = await mintCredential();

    // First join succeeds.
    const p1 = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(1));
    roster = addMember(roster, p1.pseudonym);

    // Second join with the SAME credential produces the SAME scope_nym
    // (determinism within scope, DD §36.1). Roster addMember throws.
    const p2 = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(2));
    expect(Array.from(p2.pseudonym)).toEqual(Array.from(p1.pseudonym));
    expect(() => addMember(roster, p2.pseudonym)).toThrow(/already active/);
  });

  it('rejects a join whose scope_nym has been previously ejected (rejoin fails)', async () => {
    const scopeId = new Uint8Array(32).fill(0xb1);
    let roster = emptyRoster();
    const { cred, state } = await mintCredential();

    const p = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(1));
    roster = addMember(roster, p.pseudonym);
    // Simulate an ejection (M10-T4 will make this a full flow).
    const { ejectMember } = await import('@weft/core');
    roster = ejectMember(roster, p.pseudonym);

    // Attempting to rejoin with a fresh presentation still produces the
    // same scope_nym → roster rejects.
    const p2 = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(9));
    expect(Array.from(p2.pseudonym)).toEqual(Array.from(p.pseudonym));
    expect(() => addMember(roster, p2.pseudonym)).toThrow(/previously ejected/);
  });
});
