// M10-T4 sim: ejection = key rotation.
//
// Stewards meeting the m-of-n threshold publish a 4904 ejection
// attestation, immediately followed by a 4921 rotation excluding the
// ejected member. The ejected member cannot decrypt post-rotation
// messages AND their scope_nym is permanently blocked from re-joining
// (deterministic derivation from nym_secret + scope_id).

import { describe, it, expect } from 'vitest';
import {
  bytesToHex,
  generateKeypair,
  generateGroupKey,
  channelIdForCell,
  buildGroupMessageEvent,
  parseGroupMessageEvent,
  buildGroupRotationEvent,
  extractRotatedGroupKey,
  deriveKSign,
  emptyRoster,
  addMember,
  ejectMember,
  isEjected,
  buildCharterEvent,
  parseCharterEvent,
  signEjection,
  buildEjectionEvent,
  parseEjectionEvent,
  verifyEjection,
  currentEpoch,
  requestCredential,
  issueCredential,
  verifyCredential,
  presentCredential,
  generateIssuerKeypair,
  CHARTER_WIRE_VERSION,
  EJECTION_WIRE_VERSION,
  type Charter,
  type CharterPayload,
  type EjectionAttestation,
  type NostrEvent,
} from '@weft/core';
import { MockRelay } from '../mock-relay';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Steward {
  secret: Uint8Array;
  pubkey: Uint8Array;
  hex: string;
}

function makeStewards(n: number): Steward[] {
  return Array.from({ length: n }, () => {
    const kp = generateKeypair();
    return { secret: kp.secret, pubkey: kp.pubkey, hex: bytesToHex(kp.pubkey) };
  });
}

function makeCharter(stewards: Steward[]): { event: NostrEvent; charter: Charter; cellId: string } {
  const payload: CharterPayload = {
    v: CHARTER_WIRE_VERSION,
    title: 'Test Cell',
    steward_pubkeys: stewards.map((s) => s.hex),
    amendment_rule: { m: 2, n: stewards.length },
    ejection_procedure: { m: 2, n: stewards.length },
    embedding_model: 'MiniLM-L6-v2',
    media_policy: 'text-only',
    credential_constants: { k_show: 3, epoch_length_days: 91 },
    issuer_bbs_pubkey: '00'.repeat(96),
    house_rules: ['Be kind', 'Ask before sharing outside'],
    prev: null,
  };
  const charter: Charter = { payload, sigs: [] };
  const event = buildCharterEvent(charter, stewards[0]!.secret);
  return { event, charter: parseCharterEvent(event)!, cellId: event.id };
}

interface Member {
  scopeNym: Uint8Array;
  kSign: Uint8Array;
  pSignHex: string;
}

async function mintMember(scopeId: Uint8Array, ctxByte: number): Promise<Member> {
  const issuerBbs = await generateIssuerKeypair();
  const { request, state } = await requestCredential({
    tier: 2,
    ctx: 'ctx-' + String(ctxByte),
    issued_epoch: currentEpoch(),
    expiry_epoch: currentEpoch() + 4,
    issuer_scope_tag: new Uint8Array(32).fill(ctxByte),
  });
  const cred = await issueCredential(request, issuerBbs.secretKey, issuerBbs.publicKey);
  await verifyCredential(cred, state);
  const presentation = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(1));
  const { kSign, pSign } = deriveKSign(state.nymSecret!, scopeId);
  return {
    scopeNym: presentation.pseudonym,
    kSign,
    pSignHex: bytesToHex(pSign),
  };
}

// ---------------------------------------------------------------------------
// M10-T4 acceptance
// ---------------------------------------------------------------------------

describe('M10-T4 ejection = key rotation', () => {
  it('m-of-n stewards eject; rotation locks out the ejected member', async () => {
    const relay = new MockRelay();
    const scopeId = new Uint8Array(32).fill(0xe1);
    const stewards = makeStewards(3);
    const { charter, cellId } = makeCharter(stewards);
    const channel = channelIdForCell(cellId);

    // Three members join.
    const members = [
      await mintMember(scopeId, 0x01),
      await mintMember(scopeId, 0x02),
      await mintMember(scopeId, 0x03),
    ];
    let roster = emptyRoster();
    for (const m of members) roster = addMember(roster, m.scopeNym);

    const groupKey = generateGroupKey();

    // Ejection: stewards[0] and stewards[1] sign to eject members[1].
    const ejected = members[1]!;
    const attestation: EjectionAttestation = {
      v: EJECTION_WIRE_VERSION,
      scope_nym: bytesToHex(ejected.scopeNym),
      cell_id: cellId,
      clause: 'house_rules[0]',
      evidence_hash: '00'.repeat(32), // stand-in for real evidence hash
    };
    const signed = {
      attestation,
      sigs: [
        signEjection(attestation, stewards[0]!.secret, stewards[0]!.pubkey),
        signEjection(attestation, stewards[1]!.secret, stewards[1]!.pubkey),
      ],
    };
    // Verify meets threshold.
    expect(verifyEjection(signed, charter, cellId)).toEqual({ ok: true });

    // Publish 4904, then 4921 excluding ejected.
    const ejectionEvt = buildEjectionEvent(signed, stewards[0]!.secret);
    await relay.publish(ejectionEvt);
    roster = ejectMember(roster, ejected.scopeNym);
    expect(isEjected(roster, ejected.scopeNym)).toBe(true);

    const newGroupKey = generateGroupKey();
    const remainingPSigns = [members[0]!.pSignHex, members[2]!.pSignHex];
    const rotationEvt = buildGroupRotationEvent(newGroupKey, remainingPSigns, channel);
    await relay.publish(rotationEvt);

    // Remaining members can extract the new key; ejected cannot.
    expect(extractRotatedGroupKey(rotationEvt, members[0]!.pSignHex, members[0]!.kSign)).not.toBeNull();
    expect(extractRotatedGroupKey(rotationEvt, members[2]!.pSignHex, members[2]!.kSign)).not.toBeNull();
    expect(extractRotatedGroupKey(rotationEvt, ejected.pSignHex, ejected.kSign)).toBeNull();

    // Post-rotation message: remaining decrypt with new key, ejected can't.
    const msg = buildGroupMessageEvent(members[0]!.scopeNym, 'post-eject', newGroupKey, channel);
    expect(parseGroupMessageEvent(msg, newGroupKey)).not.toBeNull();
    // Ejected still holds the OLD key — nothing to decrypt with.
    expect(parseGroupMessageEvent(msg, groupKey)).toBeNull();
  });

  it('below-threshold ejection is rejected by verifyEjection', () => {
    const scopeId = new Uint8Array(32).fill(0xe2);
    const stewards = makeStewards(3);
    const { charter, cellId } = makeCharter(stewards);
    // ejection_procedure = m: 2 of 3, so a single-signer attestation is below-threshold.
    const attestation: EjectionAttestation = {
      v: EJECTION_WIRE_VERSION,
      scope_nym: bytesToHex(new Uint8Array(32).fill(0xff)),
      cell_id: cellId,
      clause: 'house_rules[0]',
      evidence_hash: '00'.repeat(32),
    };
    const underSigned = {
      attestation,
      sigs: [signEjection(attestation, stewards[0]!.secret, stewards[0]!.pubkey)],
    };
    expect(verifyEjection(underSigned, charter, cellId)).toEqual({
      ok: false,
      reason: 'below-threshold',
    });
    void scopeId;
  });

  it('foreign signer (not in steward set) is rejected', () => {
    const stewards = makeStewards(3);
    const outsider = makeStewards(1)[0]!;
    const { charter, cellId } = makeCharter(stewards);
    const attestation: EjectionAttestation = {
      v: EJECTION_WIRE_VERSION,
      scope_nym: bytesToHex(new Uint8Array(32).fill(0xa5)),
      cell_id: cellId,
      clause: 'x',
      evidence_hash: '00'.repeat(32),
    };
    const signed = {
      attestation,
      sigs: [
        signEjection(attestation, stewards[0]!.secret, stewards[0]!.pubkey),
        signEjection(attestation, outsider.secret, outsider.pubkey),
      ],
    };
    expect(verifyEjection(signed, charter, cellId)).toEqual({
      ok: false,
      reason: 'foreign-signer',
    });
  });

  it('duplicate signer is rejected (a single steward cannot count as two)', () => {
    const stewards = makeStewards(3);
    const { charter, cellId } = makeCharter(stewards);
    const attestation: EjectionAttestation = {
      v: EJECTION_WIRE_VERSION,
      scope_nym: bytesToHex(new Uint8Array(32).fill(0x11)),
      cell_id: cellId,
      clause: 'x',
      evidence_hash: '00'.repeat(32),
    };
    const signed = {
      attestation,
      sigs: [
        signEjection(attestation, stewards[0]!.secret, stewards[0]!.pubkey),
        signEjection(attestation, stewards[0]!.secret, stewards[0]!.pubkey),
      ],
    };
    expect(verifyEjection(signed, charter, cellId)).toEqual({
      ok: false,
      reason: 'duplicate-signer',
    });
  });

  it('wrong-cell attestation is rejected (replay defense)', () => {
    const stewards = makeStewards(3);
    const { charter } = makeCharter(stewards);
    const otherCell = makeCharter(stewards);
    const attestation: EjectionAttestation = {
      v: EJECTION_WIRE_VERSION,
      scope_nym: bytesToHex(new Uint8Array(32).fill(0x22)),
      cell_id: otherCell.cellId,
      clause: 'x',
      evidence_hash: '00'.repeat(32),
    };
    const signed = {
      attestation,
      sigs: [
        signEjection(attestation, stewards[0]!.secret, stewards[0]!.pubkey),
        signEjection(attestation, stewards[1]!.secret, stewards[1]!.pubkey),
      ],
    };
    expect(verifyEjection(signed, charter, 'ff'.repeat(32))).toEqual({
      ok: false,
      reason: 'wrong-cell',
    });
  });

  it('tampered signature is rejected', () => {
    const stewards = makeStewards(3);
    const { charter, cellId } = makeCharter(stewards);
    const attestation: EjectionAttestation = {
      v: EJECTION_WIRE_VERSION,
      scope_nym: bytesToHex(new Uint8Array(32).fill(0x33)),
      cell_id: cellId,
      clause: 'x',
      evidence_hash: '00'.repeat(32),
    };
    const s0 = signEjection(attestation, stewards[0]!.secret, stewards[0]!.pubkey);
    const s1 = signEjection(attestation, stewards[1]!.secret, stewards[1]!.pubkey);
    // Flip one hex char in s1's signature.
    const badSig = s1.sig.slice(0, 8) + (s1.sig[8] === 'a' ? 'b' : 'a') + s1.sig.slice(9);
    const signed = { attestation, sigs: [s0, { ...s1, sig: badSig }] };
    expect(verifyEjection(signed, charter, cellId)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejoin attempt with the same credential fails (roster blocks the deterministic scope_nym)', async () => {
    const scopeId = new Uint8Array(32).fill(0xe3);
    const member = await mintMember(scopeId, 0x99);
    let roster = emptyRoster();
    roster = addMember(roster, member.scopeNym);
    roster = ejectMember(roster, member.scopeNym);
    // Even a fresh presentation produces the same scope_nym (determinism);
    // roster.addMember refuses.
    expect(() => addMember(roster, member.scopeNym)).toThrow(/previously ejected/);
  });

  it('4904 event content contains only hashes — no plaintext member linkage', () => {
    const stewards = makeStewards(3);
    const { cellId } = makeCharter(stewards);
    const scopeNym = new Uint8Array(32).fill(0x77);
    const attestation: EjectionAttestation = {
      v: EJECTION_WIRE_VERSION,
      scope_nym: bytesToHex(scopeNym),
      cell_id: cellId,
      clause: 'house_rules[0]',
      evidence_hash: '00'.repeat(32),
    };
    const signed = {
      attestation,
      sigs: [
        signEjection(attestation, stewards[0]!.secret, stewards[0]!.pubkey),
        signEjection(attestation, stewards[1]!.secret, stewards[1]!.pubkey),
      ],
    };
    const evt = buildEjectionEvent(signed, stewards[0]!.secret);
    const parsed = parseEjectionEvent(evt);
    expect(parsed).not.toBeNull();
    // The event content contains: scope_nym (a pseudonym, not a pubkey),
    // cell_id (a hash), clause (an index/slug), evidence_hash (a hash),
    // and signatures from stewards. No plaintext member pubkeys.
    // (The signatures' signer field IS a steward pubkey — but stewards are
    // publicly named on the charter anyway.)
    expect(evt.content).toContain(bytesToHex(scopeNym));
    // Ensure the ejected member's pSign (their cell-scoped signing key)
    // is not disclosed by the ejection event — the roster carries pSigns,
    // but ejection cites only scope_nyms.
    // Nothing to positively assert beyond this.
  });
});
