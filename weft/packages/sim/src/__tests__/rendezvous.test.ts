// M12-T1 sim: vouched-anonymous rendezvous.
//
// A rendezvous is a group whose join is automatic on credential
// presentation — everyone proven-vouched, no one identified. Reuses M9
// credentials + M10 charter/roster/messaging/ejection primitives.
//
// This test verifies:
//   - a rendezvous charter is distinguishable from a regular cell charter
//   - any holder of a valid credential enters without greeter approval
//   - entry reveals no identity (only a scope_nym)
//   - ejection by scope_nym still sticks (rejoin fails via roster block)
//   - cross-rendezvous unlinkability: same credential at A vs B → different
//     scope_nyms
//   - restricted rendezvous rejects a credential whose issuer_scope_tag
//     isn't on the accepted list
//   - a non-rendezvous charter rejects auto-admit (defensive)

import { describe, it, expect } from 'vitest';
import {
  bytesToHex,
  generateKeypair,
  buildRendezvousCharterEvent,
  makeRendezvousPayload,
  isRendezvousCharter,
  acceptedIssuerScopeTags,
  autoAdmit,
  parseCharterEvent,
  cellId,
  emptyRoster,
  addMember,
  ejectMember,
  isEjected,
  currentEpoch,
  requestCredential,
  issueCredential,
  verifyCredential,
  presentCredential,
  generateIssuerKeypair,
  CHARTER_WIRE_VERSION,
  type Charter,
  type CharterPayload,
  type CleartextAttrs,
} from '@weft/core';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Steward {
  secret: Uint8Array;
  pubkey: Uint8Array;
  hex: string;
}

function makeSteward(): Steward {
  const kp = generateKeypair();
  return { secret: kp.secret, pubkey: kp.pubkey, hex: bytesToHex(kp.pubkey) };
}

function basePayload(
  stewards: Steward[],
  issuerBbsPubkey: Uint8Array,
): CharterPayload {
  return {
    v: CHARTER_WIRE_VERSION,
    title: 'Test venue',
    steward_pubkeys: stewards.map((s) => s.hex),
    amendment_rule: { m: 1, n: stewards.length },
    ejection_procedure: { m: 1, n: stewards.length },
    embedding_model: 'MiniLM-L6-v2',
    media_policy: 'text-only',
    credential_constants: { k_show: 3, epoch_length_days: 91 },
    issuer_bbs_pubkey: bytesToHex(issuerBbsPubkey),
    house_rules: ['Be kind'],
    prev: null,
  };
}

async function mintCredential(
  issuerBbs: { secretKey: Uint8Array; publicKey: Uint8Array },
  issuerScopeTag: Uint8Array,
): Promise<{
  cred: Awaited<ReturnType<typeof issueCredential>>;
  state: Awaited<ReturnType<typeof requestCredential>>['state'];
}> {
  const cleartext: CleartextAttrs = {
    tier: 2,
    ctx: 'anon',
    issued_epoch: currentEpoch(),
    expiry_epoch: currentEpoch() + 4,
    issuer_scope_tag: issuerScopeTag,
  };
  const { request, state } = await requestCredential(cleartext);
  const cred = await issueCredential(request, issuerBbs.secretKey, issuerBbs.publicKey);
  await verifyCredential(cred, state);
  return { cred, state };
}

// ---------------------------------------------------------------------------
// M12-T1 acceptance
// ---------------------------------------------------------------------------

describe('M12-T1 vouched-anonymous rendezvous', () => {
  it('rendezvous charter is distinguishable from a regular cell', async () => {
    const stewards = [makeSteward()];
    const issuerBbs = await generateIssuerKeypair();

    const regularEvt = (() => {
      const payload = basePayload(stewards, issuerBbs.publicKey);
      return { payload };
    })();
    const rendezvousEvt = buildRendezvousCharterEvent(
      basePayload(stewards, issuerBbs.publicKey),
      {},
      stewards[0]!.secret,
    );

    expect(isRendezvousCharter(regularEvt.payload)).toBe(false);
    const parsed = parseCharterEvent(rendezvousEvt)!;
    expect(isRendezvousCharter(parsed.payload)).toBe(true);
  });

  it('any holder of a valid credential enters (no greeter approval)', async () => {
    const stewards = [makeSteward()];
    const issuerBbs = await generateIssuerKeypair();
    const issuerScopeTag = new Uint8Array(32).fill(0xa1);

    const rendezvousEvt = buildRendezvousCharterEvent(
      basePayload(stewards, issuerBbs.publicKey),
      {}, // accepts any tag
      stewards[0]!.secret,
    );
    const charter = parseCharterEvent(rendezvousEvt)!;
    const rendezvousId = cellId(rendezvousEvt);
    const scopeId = hexToBytes(rendezvousId);

    const { cred, state } = await mintCredential(issuerBbs, issuerScopeTag);
    const p = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(1));

    const verdict = autoAdmit(p, charter, rendezvousId, issuerBbs.publicKey);
    expect(verdict).toEqual({ ok: true });
  });

  it('entry reveals no identity — only a scope_nym', async () => {
    const stewards = [makeSteward()];
    const issuerBbs = await generateIssuerKeypair();
    const holderIdentity = generateKeypair();

    const rendezvousEvt = buildRendezvousCharterEvent(
      basePayload(stewards, issuerBbs.publicKey),
      {},
      stewards[0]!.secret,
    );
    const charter = parseCharterEvent(rendezvousEvt)!;
    const rendezvousId = cellId(rendezvousEvt);
    const scopeId = hexToBytes(rendezvousId);

    const { cred, state } = await mintCredential(issuerBbs, new Uint8Array(32).fill(0xa2));
    const p = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(2));

    // Verdict OK — admitted.
    expect(autoAdmit(p, charter, rendezvousId, issuerBbs.publicKey).ok).toBe(true);

    // The presentation's bytes never contain the holder's identity pubkey.
    const wire = JSON.stringify({
      proof: bytesToHex(p.proof),
      pseudonym: bytesToHex(p.pseudonym),
    });
    expect(wire).not.toContain(bytesToHex(holderIdentity.pubkey));
    // The rendezvous learns only a 48-byte scope_nym.
    expect(p.pseudonym.length).toBe(48);
  });

  it('ejection by scope_nym still sticks — rejoin with the same credential fails', async () => {
    const issuerBbs = await generateIssuerKeypair();
    const scopeId = new Uint8Array(32).fill(0xb0);

    const { cred, state } = await mintCredential(issuerBbs, new Uint8Array(32).fill(0xa1));
    const p1 = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(1));

    let roster = emptyRoster();
    roster = addMember(roster, p1.pseudonym);
    roster = ejectMember(roster, p1.pseudonym);
    expect(isEjected(roster, p1.pseudonym)).toBe(true);

    // Same credential + same rendezvous → same scope_nym (M9-T3 determinism)
    // → roster refuses on previously-ejected grounds.
    const p2 = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(2));
    expect(Array.from(p2.pseudonym)).toEqual(Array.from(p1.pseudonym));
    expect(() => addMember(roster, p2.pseudonym)).toThrow(/previously ejected/);
  });

  it('cross-rendezvous unlinkability: same credential at A vs B → different scope_nyms', async () => {
    const issuerBbs = await generateIssuerKeypair();
    const scopeA = new Uint8Array(32).fill(0xc1);
    const scopeB = new Uint8Array(32).fill(0xc2);

    const { cred, state } = await mintCredential(issuerBbs, new Uint8Array(32).fill(0xa1));
    const pA = await presentCredential(cred, state, [], scopeA, new Uint8Array(16).fill(1));
    const pB = await presentCredential(cred, state, [], scopeB, new Uint8Array(16).fill(2));

    expect(Array.from(pA.pseudonym)).not.toEqual(Array.from(pB.pseudonym));
    // Colluding rendezvous operators comparing rosters see two unrelated
    // scope_nyms; they cannot link them from wire evidence alone.
  });

  it('restricted rendezvous rejects a credential with a non-accepted issuer_scope_tag', async () => {
    const stewards = [makeSteward()];
    const issuerBbs = await generateIssuerKeypair();

    const acceptedTag = new Uint8Array(32).fill(0xaa);
    const otherTag = new Uint8Array(32).fill(0xbb);

    const rendezvousEvt = buildRendezvousCharterEvent(
      basePayload(stewards, issuerBbs.publicKey),
      { acceptedIssuerScopeTags: [bytesToHex(acceptedTag)] },
      stewards[0]!.secret,
    );
    const charter = parseCharterEvent(rendezvousEvt)!;
    const rendezvousId = cellId(rendezvousEvt);
    const scopeId = hexToBytes(rendezvousId);

    // Holder has a credential from the OTHER (non-accepted) tag.
    const { cred, state } = await mintCredential(issuerBbs, otherTag);
    // Must disclose index 4 (issuer_scope_tag) so the rendezvous can inspect it.
    const p = await presentCredential(cred, state, [4], scopeId, new Uint8Array(16).fill(5));

    const verdict = autoAdmit(p, charter, rendezvousId, issuerBbs.publicKey);
    expect(verdict).toEqual({ ok: false, reason: 'issuer-tag-not-accepted' });
  });

  it('restricted rendezvous rejects if the presentation omits the issuer_scope_tag disclosure', async () => {
    const stewards = [makeSteward()];
    const issuerBbs = await generateIssuerKeypair();
    const acceptedTag = new Uint8Array(32).fill(0xaa);

    const rendezvousEvt = buildRendezvousCharterEvent(
      basePayload(stewards, issuerBbs.publicKey),
      { acceptedIssuerScopeTags: [bytesToHex(acceptedTag)] },
      stewards[0]!.secret,
    );
    const charter = parseCharterEvent(rendezvousEvt)!;
    const rendezvousId = cellId(rendezvousEvt);
    const scopeId = hexToBytes(rendezvousId);

    // Presentation discloses nothing — restricted rendezvous can't decide.
    const { cred, state } = await mintCredential(issuerBbs, acceptedTag);
    const p = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(6));

    const verdict = autoAdmit(p, charter, rendezvousId, issuerBbs.publicKey);
    expect(verdict).toEqual({ ok: false, reason: 'issuer-tag-not-accepted' });
  });

  it('a non-rendezvous charter rejects auto-admit (defensive: prevents misuse against regular cells)', async () => {
    const stewards = [makeSteward()];
    const issuerBbs = await generateIssuerKeypair();
    const scopeId = new Uint8Array(32).fill(0xd0);

    // Build a REGULAR charter (no rendezvous marker).
    const payload = basePayload(stewards, issuerBbs.publicKey);
    const regular: Charter = { payload, sigs: [] };

    const { cred, state } = await mintCredential(issuerBbs, new Uint8Array(32).fill(0xa1));
    const p = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(7));

    const verdict = autoAdmit(p, regular, bytesToHex(scopeId), issuerBbs.publicKey);
    expect(verdict).toEqual({ ok: false, reason: 'not-a-rendezvous' });
  });

  it('wrong-scope presentation is rejected (bound to a different rendezvous)', async () => {
    const stewards = [makeSteward()];
    const issuerBbs = await generateIssuerKeypair();
    const rendezvousEvt = buildRendezvousCharterEvent(
      basePayload(stewards, issuerBbs.publicKey),
      {},
      stewards[0]!.secret,
    );
    const charter = parseCharterEvent(rendezvousEvt)!;
    const rendezvousId = cellId(rendezvousEvt);
    // Present against a different scope.
    const otherScope = new Uint8Array(32).fill(0xe0);

    const { cred, state } = await mintCredential(issuerBbs, new Uint8Array(32).fill(0xa1));
    const p = await presentCredential(cred, state, [], otherScope, new Uint8Array(16).fill(8));

    const verdict = autoAdmit(p, charter, rendezvousId, issuerBbs.publicKey);
    expect(verdict).toEqual({ ok: false, reason: 'wrong-scope' });
  });

  it('acceptedIssuerScopeTags helper round-trips through makeRendezvousPayload', () => {
    const stewards = [makeSteward()];
    const bbsPub = new Uint8Array(96).fill(0);
    const base = basePayload(stewards, bbsPub);
    const openPayload = makeRendezvousPayload(base, {}); // no restriction
    expect(acceptedIssuerScopeTags(openPayload)).toEqual([]);
    const restrictedPayload = makeRendezvousPayload(base, {
      acceptedIssuerScopeTags: ['aa'.repeat(32), 'bb'.repeat(32)],
    });
    expect(acceptedIssuerScopeTags(restrictedPayload)).toEqual([
      'aa'.repeat(32),
      'bb'.repeat(32),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Local hex helper
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
