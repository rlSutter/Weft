// Gate 6 — ACCOUNTABILITY IS SCOPED.
//
// **The property.** An ejected scope_nym cannot re-enter its scope. Once
// stewards eject a member, the deterministic derivation of scope_nym from
// (nym_secret, scope_id) means the same credential re-presented produces
// the same scope_nym, which the roster refuses on "previously ejected"
// grounds. This holds without the roster or the stewards ever learning the
// ejected person's real identity — accountability without deanonymization.
//
// **This test is release-gate class.** It exists to prove the property,
// not to explore edge cases. Weakening or removing this file requires
// Fable review — same rule as Gates 1–4.
//
// Enforced by:
//   - M9-T3   scope_nym = PRF(k_cred, scope_id) is deterministic per (cred, scope)
//   - M10-T1  Roster.addMember refuses BOTH already-active AND previously-ejected nyms
//   - M10-T4  Ejection moves a member from active → ejected (which sticks)
//
// Sources of law:
//   DD §7, §18.2, §36.2 (with 2026-07-19 amendment)
//   Build list M13-T1   gate 6 goes live
//   SECURITY.md invariant-5 row (updated M13-T3)

import { describe, it, expect } from 'vitest';
import {
  currentEpoch,
  requestCredential,
  issueCredential,
  verifyCredential,
  presentCredential,
  generateIssuerKeypair,
  emptyRoster,
  addMember,
  ejectMember,
  isEjected,
  type CleartextAttrs,
} from '../../index';

describe('Gate 6 — ACCOUNTABILITY IS SCOPED (release gate)', () => {
  it('an ejected scope_nym cannot re-enter its scope — even with a fresh presentation of the same credential', async () => {
    const issuerBbs = await generateIssuerKeypair();
    const scopeId = new Uint8Array(32).fill(0xa1);

    // A member holds a valid credential; joins; is ejected.
    const cleartext: CleartextAttrs = {
      tier: 2,
      ctx: 'test',
      issued_epoch: currentEpoch(),
      expiry_epoch: currentEpoch() + 4,
      issuer_scope_tag: new Uint8Array(32).fill(0xff),
    };
    const { request, state } = await requestCredential(cleartext);
    const cred = await issueCredential(request, issuerBbs.secretKey, issuerBbs.publicKey);
    await verifyCredential(cred, state);

    const p1 = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(1));

    let roster = emptyRoster();
    roster = addMember(roster, p1.pseudonym);
    roster = ejectMember(roster, p1.pseudonym);
    expect(isEjected(roster, p1.pseudonym)).toBe(true);

    // The member tries to rejoin with a FRESH presentation (new challenge,
    // fresh randomness in the ZK proof). The credential is unchanged, so
    // determinism (M9-T3) means the scope_nym is unchanged.
    const p2 = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(99));
    expect(Array.from(p2.pseudonym)).toEqual(Array.from(p1.pseudonym));

    // Roster refuses. Ejection sticks against a member the roster never
    // identified.
    expect(() => addMember(roster, p2.pseudonym)).toThrow(/previously ejected/);
  });

  it('a different scope with the same credential produces a NEW scope_nym — accountability is per-scope', async () => {
    // Ejection from cell A does NOT block entry to cell B. This is the
    // "scoped" half of the invariant — accountability is bounded to the
    // scope that voted to eject, not global.
    const issuerBbs = await generateIssuerKeypair();
    const cellA = new Uint8Array(32).fill(0xb1);
    const cellB = new Uint8Array(32).fill(0xb2);

    const cleartext: CleartextAttrs = {
      tier: 2,
      ctx: 'test',
      issued_epoch: currentEpoch(),
      expiry_epoch: currentEpoch() + 4,
      issuer_scope_tag: new Uint8Array(32).fill(0xff),
    };
    const { request, state } = await requestCredential(cleartext);
    const cred = await issueCredential(request, issuerBbs.secretKey, issuerBbs.publicKey);
    await verifyCredential(cred, state);

    // Cell A ejects.
    const pA = await presentCredential(cred, state, [], cellA, new Uint8Array(16).fill(1));
    let _rosterA = emptyRoster();
    _rosterA = addMember(_rosterA, pA.pseudonym);
    _rosterA = ejectMember(_rosterA, pA.pseudonym);

    // Same credential in cell B produces a NEW scope_nym.
    const pB = await presentCredential(cred, state, [], cellB, new Uint8Array(16).fill(2));
    expect(Array.from(pB.pseudonym)).not.toEqual(Array.from(pA.pseudonym));

    // Cell B has never seen this scope_nym, so cell B admits.
    let rosterB = emptyRoster();
    expect(() => {
      rosterB = addMember(rosterB, pB.pseudonym);
    }).not.toThrow();
  });

  it('two DIFFERENT credentials (different subject_secret/nym_secret) produce different scope_nyms in the same scope', async () => {
    // Two independent members join the same cell. Each has their own
    // credential, so each has a different scope_nym. Ejecting one does
    // not affect the other — accountability is per-member, not per-cell.
    const issuerBbs = await generateIssuerKeypair();
    const scopeId = new Uint8Array(32).fill(0xc1);
    const cleartext = (): CleartextAttrs => ({
      tier: 2,
      ctx: 'test',
      issued_epoch: currentEpoch(),
      expiry_epoch: currentEpoch() + 4,
      issuer_scope_tag: new Uint8Array(32).fill(0xff),
    });

    const a = await requestCredential(cleartext());
    const credA = await issueCredential(a.request, issuerBbs.secretKey, issuerBbs.publicKey);
    await verifyCredential(credA, a.state);
    const pA = await presentCredential(credA, a.state, [], scopeId, new Uint8Array(16).fill(1));

    const b = await requestCredential(cleartext());
    const credB = await issueCredential(b.request, issuerBbs.secretKey, issuerBbs.publicKey);
    await verifyCredential(credB, b.state);
    const pB = await presentCredential(credB, b.state, [], scopeId, new Uint8Array(16).fill(2));

    expect(Array.from(pA.pseudonym)).not.toEqual(Array.from(pB.pseudonym));

    // Eject A. B remains admittable.
    let roster = emptyRoster();
    roster = addMember(roster, pA.pseudonym);
    roster = ejectMember(roster, pA.pseudonym);
    expect(() => {
      roster = addMember(roster, pB.pseudonym);
    }).not.toThrow();
  });

  it('the roster carries scope_nyms only — the stewards never learn the ejected member`s real identity', async () => {
    // Structural property. The Roster type exposes `active` and `ejected`
    // maps keyed by scope_nym hex. No field points at a Nostr pubkey or
    // any other identifier of the underlying member.
    const issuerBbs = await generateIssuerKeypair();
    const scopeId = new Uint8Array(32).fill(0xd1);
    const cleartext: CleartextAttrs = {
      tier: 2,
      ctx: 'x',
      issued_epoch: currentEpoch(),
      expiry_epoch: currentEpoch() + 4,
      issuer_scope_tag: new Uint8Array(32).fill(0xff),
    };
    const { request, state } = await requestCredential(cleartext);
    const cred = await issueCredential(request, issuerBbs.secretKey, issuerBbs.publicKey);
    await verifyCredential(cred, state);
    const p = await presentCredential(cred, state, [], scopeId, new Uint8Array(16).fill(1));

    let roster = emptyRoster();
    roster = addMember(roster, p.pseudonym);
    roster = ejectMember(roster, p.pseudonym);

    // The ejected map contains ONLY the scope_nym — no identity, no
    // nym_secret, no credential bytes.
    const [ejectedNymHex] = [...roster.ejected.keys()];
    expect(ejectedNymHex).toBeDefined();
    expect(ejectedNymHex!.length).toBe(48 * 2); // 48 bytes hex
    // The scope_nym is a G1 point derived via PRF — it does not reveal
    // subject_secret, nym_secret, or any Nostr identity.
  });
});
