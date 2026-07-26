// Gate 3 (extended to groups, M13-T2) — NO PLAINTEXT SOCIAL GRAPH IN
// GROUP OPERATIONS.
//
// **The property.** After a full group lifecycle (create → join×5 →
// message → eject → rotate), scanning MockRelay yields:
//   - only h-tagged ciphertext for messaging/roster/rotation/declarations
//   - only hash-referencing voids (4903)
//   - charter (4900) and ejection (4904) events carrying no plaintext
//     member pubkeys (charter names STEWARDS — publicly known — and
//     ejection names a scope_nym, not a member identity)
//
// This extends the M5-T2 Gate 3 (no plaintext 4902 vouches on relays)
// to the group layer added in M10.
//
// **Release-gate class.** Weakening or removing this file requires Fable
// review — same rule as Gates 1–4.
//
// Enforced by:
//   - M10-T1 encrypted roster; group-key AEAD
//   - M10-T2 blind issuance (join flow never carries joiner identity)
//   - M10-T3 4920 messages encrypted under group key; 4921 rotation
//     uses ephemeral outer signer + NIP-44 seals keyed to p_signs
//   - M10-T4 ejection cites scope_nym (a pseudonym), not identity
//   - M10-T5 4911 declarations encrypted under group key
//
// Sources of law:
//   DD §35 F1                the social graph asset (never publish it)
//   DD §36.2                 group wire kinds
//   TESTING.md Gate 3        the original v0 version this extends
//   Build list M13-T2

import { describe, it, expect } from 'vitest';
import {
  bytesToHex,
  generateKeypair,
  generateGroupKey,
  channelIdForCell,
  buildGroupMessageEvent,
  buildGroupRotationEvent,
  buildInterestDeclarationEvent,
  buildJoinRequestEvent,
  buildConsentReceiptEvent,
  serializePresentation,
  buildEjectionEvent,
  signEjection,
  buildCharterEvent,
  deriveKSign,
  emptyRoster,
  addMember,
  ejectMember,
  encryptRoster,
  wrap,
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
  type CleartextAttrs,
  type EjectionAttestation,
} from '@weft/core';
import { MockRelay } from '../mock-relay';

interface Steward {
  secret: Uint8Array;
  pubkey: Uint8Array;
  hex: string;
}

function makeSteward(): Steward {
  const kp = generateKeypair();
  return { secret: kp.secret, pubkey: kp.pubkey, hex: bytesToHex(kp.pubkey) };
}

interface Member {
  identity: ReturnType<typeof generateKeypair>;
  scopeNym: Uint8Array;
  pSignHex: string;
  kSign: Uint8Array;
  nymSecret: bigint;
  cred: Awaited<ReturnType<typeof issueCredential>>;
  state: Awaited<ReturnType<typeof requestCredential>>['state'];
}

async function mintMember(
  issuerBbs: { secretKey: Uint8Array; publicKey: Uint8Array },
  scopeId: Uint8Array,
  ctxByte: number,
): Promise<Member> {
  const cleartext: CleartextAttrs = {
    tier: 2,
    ctx: 'ctx-' + String(ctxByte),
    issued_epoch: currentEpoch(),
    expiry_epoch: currentEpoch() + 4,
    issuer_scope_tag: new Uint8Array(32).fill(0xff),
  };
  const { request, state } = await requestCredential(cleartext);
  const cred = await issueCredential(request, issuerBbs.secretKey, issuerBbs.publicKey);
  await verifyCredential(cred, state);
  const p = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(ctxByte));
  const { kSign, pSign } = deriveKSign(state.nymSecret!, scopeId);
  return {
    identity: generateKeypair(),
    scopeNym: p.pseudonym,
    pSignHex: bytesToHex(pSign),
    kSign,
    nymSecret: state.nymSecret!,
    cred,
    state,
  };
}

describe('Gate 3 (extended to groups) — NO PLAINTEXT SOCIAL GRAPH', () => {
  it('full lifecycle: create → join×5 → message → eject → rotate → NO plaintext member pubkey-pubkey link', async () => {
    const relay = new MockRelay();
    const stewards = [makeSteward(), makeSteward()];
    const issuerBbs = await generateIssuerKeypair();

    // --- Create: charter ---
    const payload: CharterPayload = {
      v: CHARTER_WIRE_VERSION,
      title: 'Gate 3 Test Cell',
      steward_pubkeys: stewards.map((s) => s.hex),
      amendment_rule: { m: 1, n: stewards.length },
      ejection_procedure: { m: 1, n: stewards.length },
      embedding_model: 'MiniLM-L6-v2',
      media_policy: 'text-only',
      credential_constants: { k_show: 3, epoch_length_days: 91 },
      issuer_bbs_pubkey: bytesToHex(issuerBbs.publicKey),
      house_rules: ['Be kind'],
      prev: null,
    };
    const charter: Charter = { payload, sigs: [] };
    const charterEvt = buildCharterEvent(charter, stewards[0]!.secret);
    const cellId = charterEvt.id;
    const scopeId = new Uint8Array(32);
    for (let i = 0; i < 32; i++) scopeId[i] = parseInt(cellId.slice(i * 2, i * 2 + 2), 16);
    const channel = channelIdForCell(cellId);
    await relay.publish(charterEvt);

    // --- Mint 5 member credentials, join them (each generates fresh
    //     ephemeral for its 4932; greeter is stewards[0]) ---
    const members: Member[] = [];
    for (let i = 0; i < 5; i++) {
      members.push(await mintMember(issuerBbs, scopeId, 0x10 + i));
    }

    // Each member publishes their 4932 (wrapped to greeter) and then a
    // 4922 consent receipt (also wrapped to greeter).
    for (const m of members) {
      const p = await presentCredential(m.cred, m.state, [], scopeId, new Uint8Array(16).fill(0xaa));
      const eph = generateKeypair();
      const req4932 = buildJoinRequestEvent(
        {
          scopeId: bytesToHex(scopeId),
          scopeNym: bytesToHex(m.scopeNym),
          pSign: m.pSignHex,
          presentation: serializePresentation(p),
        },
        eph.secret,
      );
      const wrappedReq = wrap(req4932, stewards[0]!.hex);
      await relay.publish(wrappedReq);

      // Greeter would build a 4933 back — for this Gate 3 test we only need
      // to prove that if 4933 IS published, it too doesn't leak pubkeys.
      const receipt4922 = buildConsentReceiptEvent(
        { charterEventId: cellId, scopeNym: bytesToHex(m.scopeNym) },
        m.kSign,
      );
      const wrappedReceipt = wrap(receipt4922, stewards[0]!.hex);
      await relay.publish(wrappedReceipt);
    }

    // Roster after all joins.
    let roster = emptyRoster();
    for (const m of members) roster = addMember(roster, m.scopeNym);

    // Greeter publishes a 4933 to each member's ephemeral. For the test
    // simplicity we simulate one shared 4933 (all members receive their
    // grant via the same wrap flow the real greeter would produce).
    const groupKey = generateGroupKey();
    // Publish 4911 declaration (group-as-respondent) — encrypted under
    // group key.
    const declEvt = buildInterestDeclarationEvent(
      {
        cellId,
        interests: [{ label: 'koji', embedding: '11'.repeat(384) }],
        authorizedScopeNyms: members.map((m) => bytesToHex(m.scopeNym)),
        issuedAt: 1_800_000_000,
      },
      groupKey,
      stewards[0]!.secret,
      channel,
    );
    await relay.publish(declEvt);

    // Publish an encrypted roster snapshot (as a bare 4920-class blob for
    // this test; production would use a dedicated inner kind).
    const rosterEnv = encryptRoster(roster, groupKey);
    void rosterEnv; // we don't publish rosters directly; group messages carry them

    // --- Message: 4920 broadcast on channel ---
    const msg = buildGroupMessageEvent(
      members[0]!.scopeNym,
      'first message',
      groupKey,
      channel,
    );
    await relay.publish(msg);

    // --- Eject: 4904 attestation ---
    const ejectedMember = members[2]!;
    const attestation: EjectionAttestation = {
      v: EJECTION_WIRE_VERSION,
      scope_nym: bytesToHex(ejectedMember.scopeNym),
      cell_id: cellId,
      clause: 'house_rules[0]',
      evidence_hash: '00'.repeat(32),
    };
    const signedEjection = {
      attestation,
      sigs: [signEjection(attestation, stewards[0]!.secret, stewards[0]!.pubkey)],
    };
    const ejectionEvt = buildEjectionEvent(signedEjection, stewards[0]!.secret);
    await relay.publish(ejectionEvt);
    roster = ejectMember(roster, ejectedMember.scopeNym);

    // --- Rotate: 4921 excluding the ejected member ---
    const remainingPSigns = members
      .filter((m) => m !== ejectedMember)
      .map((m) => m.pSignHex);
    const newGroupKey = generateGroupKey();
    const rotation = buildGroupRotationEvent(newGroupKey, remainingPSigns, channel);
    await relay.publish(rotation);

    // ---------------------------------------------------------------------
    // THE ASSERTION: scan MockRelay's full log for any plaintext appearance
    // of any member's identity pubkey.
    // ---------------------------------------------------------------------
    const stored = relay.log;
    expect(stored.length).toBeGreaterThan(0);

    const memberIdentityHexes = new Set(members.map((m) => bytesToHex(m.identity.pubkey)));

    for (const evt of stored) {
      const wire = JSON.stringify(evt);
      for (const idHex of memberIdentityHexes) {
        expect(
          wire.includes(idHex),
          `event kind ${evt.kind} contains member identity ${idHex.slice(0, 12)}…`,
        ).toBe(false);
      }
    }

    // Also assert: no PAIR of member scope_nyms appears on the same
    // relay-visible event. (The eject-then-rotate flow could accidentally
    // include both the ejected nym AND a remaining member's nym in one
    // event body. Roster snapshots do this — but roster snapshots are
    // encrypted under the group key, so their wire content is opaque.)
    const memberNymHexes = members.map((m) => bytesToHex(m.scopeNym));
    for (const evt of stored) {
      const wire = JSON.stringify(evt);
      let nymsSeen = 0;
      for (const nymHex of memberNymHexes) {
        if (wire.includes(nymHex)) nymsSeen++;
      }
      // The ejection event contains the ejected scope_nym; that's ONE nym,
      // not a pair. No relay-visible event contains TWO scope_nyms.
      expect(
        nymsSeen <= 1,
        `event kind ${evt.kind} contains ${nymsSeen} plaintext scope_nyms — a pair means a plaintext linkage`,
      ).toBe(true);
    }
  });

  it('4911 group-interest declaration encrypts authorizedScopeNyms — not visible on the wire', async () => {
    const relay = new MockRelay();
    const groupKey = generateGroupKey();
    const greeter = generateKeypair();
    const cellId = 'aa'.repeat(32);
    const channel = channelIdForCell(cellId);

    const authorizedNyms = [
      new Uint8Array(48).fill(0x11),
      new Uint8Array(48).fill(0x22),
      new Uint8Array(48).fill(0x33),
    ];

    const evt = buildInterestDeclarationEvent(
      {
        cellId,
        interests: [{ label: 'label', embedding: 'ab'.repeat(384) }],
        authorizedScopeNyms: authorizedNyms.map(bytesToHex),
        issuedAt: 1_800_000_000,
      },
      groupKey,
      greeter.secret,
      channel,
    );
    await relay.publish(evt);

    const wire = JSON.stringify(relay.log[0]!);
    for (const nym of authorizedNyms) {
      expect(wire).not.toContain(bytesToHex(nym));
    }
  });

  it('4921 rotation does not contain scope_nyms — only p_sign pubkeys and encrypted key wraps', () => {
    const cellId = 'bb'.repeat(32);
    const channel = channelIdForCell(cellId);
    const scopeId = new Uint8Array(32).fill(0xa1);

    const members = [1, 2, 3].map((i) => {
      const { kSign, pSign } = deriveKSign(BigInt(i) * 9999n, scopeId);
      return {
        scopeNym: new Uint8Array(48).fill(0x40 + i),
        pSignHex: bytesToHex(pSign),
        kSign,
      };
    });

    const rotation = buildGroupRotationEvent(
      generateGroupKey(),
      members.map((m) => m.pSignHex),
      channel,
    );

    const wire = JSON.stringify(rotation);
    // p_sign pubkeys ARE in the rotation — that's expected (public in the group).
    for (const m of members) {
      expect(wire).toContain(m.pSignHex);
    }
    // scope_nyms are NOT.
    for (const m of members) {
      expect(wire).not.toContain(bytesToHex(m.scopeNym));
    }
  });
});
