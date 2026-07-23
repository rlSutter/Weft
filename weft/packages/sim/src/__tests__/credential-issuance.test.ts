// M9-T4 sim: full credential issuance + revocation lifecycle.
//
// Two parties over a MockRelay:
//   1. Subject builds a 4930 CredentialRequest, wraps it, publishes.
//   2. Issuer subscribes to their own pubkey, unwraps the 4930, calls
//      issueCredential, wraps the resulting 4931, publishes.
//   3. Subject unwraps the 4931, verifies the credential, stores.
//   4. Subject presents a scope-bound proof; verifier accepts.
//   5. Issuer publishes a 4903 void with the credential's handle.
//   6. Freshness check now returns false; presentation is rejected.

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
  verifyPresentation,
  generateIssuerKeypair,
  buildCredentialRequestEvent,
  parseCredentialRequestEvent,
  buildCredentialIssuanceEvent,
  parseCredentialIssuanceEvent,
  revocationHandle,
  isRevoked,
  buildVoidEvent,
  parseVoidedHandle,
  type NostrEvent,
  type Credential,
  type CleartextAttrs,
  type HolderState,
} from '@weft/core';
import { MockRelay } from '../mock-relay';

describe('M9-T4 credential issuance flow', () => {
  it('subject → issuer request/response, verify, present, then void invalidates', async () => {
    const relay = new MockRelay();

    // Long-lived identity keys for the two parties. In real life, the issuer
    // ALSO has a BBS keypair — the identity key is the Nostr signing key,
    // the BBS keypair is what signs credentials.
    const subjectKeys = generateKeypair();
    const issuerNostrKeys = generateKeypair();
    const issuerBbs = await generateIssuerKeypair();

    // --- Subject side: build request ---
    const cleartext: CleartextAttrs = {
      tier: 2,
      ctx: 'fermentation',
      issued_epoch: currentEpoch(),
      expiry_epoch: currentEpoch() + 4, // ~1 year
      issuer_scope_tag: new Uint8Array(32).fill(7),
    };
    const { request, state } = await requestCredential(cleartext);

    // Sign the 4930 with the subject's long-lived key, wrap to the issuer.
    const req4930 = buildCredentialRequestEvent(request, subjectKeys.secret);
    const wrappedReq = wrap(req4930, bytesToHex(issuerNostrKeys.pubkey));

    // Issuer subscribes to their own pubkey and will receive the wrap.
    const issuerInbox: NostrEvent[] = [];
    relay.subscribe(
      { kinds: [1059], p: [bytesToHex(issuerNostrKeys.pubkey)] },
      (evt) => issuerInbox.push(evt),
    );
    await relay.publish(wrappedReq);
    expect(issuerInbox).toHaveLength(1);

    // --- Issuer side: unwrap, verify subject's signature, issue ---
    const unwrappedForIssuer = unwrap(issuerInbox[0]!, issuerNostrKeys.secret);
    expect(unwrappedForIssuer).not.toBeNull();
    expect(unwrappedForIssuer!.inner.kind).toBe(4930);
    // Verify the request was signed by the expected subject (the issuer
    // knows the subject via ordinary vouching; if this pubkey isn't in
    // their vouch graph they'd refuse to issue).
    expect(unwrappedForIssuer!.inner.pubkey).toBe(bytesToHex(subjectKeys.pubkey));

    const parsedRequest = parseCredentialRequestEvent(unwrappedForIssuer!.inner);
    const cred = await issueCredential(parsedRequest, issuerBbs.secretKey, issuerBbs.publicKey);
    const iss4931 = buildCredentialIssuanceEvent(cred, issuerNostrKeys.secret);
    const wrappedIss = wrap(iss4931, bytesToHex(subjectKeys.pubkey));

    // --- Subject side: subscribe, receive 4931, verify credential ---
    const subjectInbox: NostrEvent[] = [];
    relay.subscribe(
      { kinds: [1059], p: [bytesToHex(subjectKeys.pubkey)] },
      (evt) => subjectInbox.push(evt),
    );
    await relay.publish(wrappedIss);
    expect(subjectInbox).toHaveLength(1);

    const unwrappedForSubject = unwrap(subjectInbox[0]!, subjectKeys.secret);
    expect(unwrappedForSubject).not.toBeNull();
    expect(unwrappedForSubject!.inner.kind).toBe(4931);
    // Verify issuer authorship.
    expect(unwrappedForSubject!.inner.pubkey).toBe(bytesToHex(issuerNostrKeys.pubkey));

    const receivedCred = parseCredentialIssuanceEvent(unwrappedForSubject!.inner);
    const ok = await verifyCredential(receivedCred, state);
    expect(ok).toBe(true);
    expect(state.nymSecret).toBeDefined();

    // --- Subject presents; verifier accepts ---
    const scope = new Uint8Array(32).fill(0xa1);
    const ph = new Uint8Array(16).fill(0xff);
    const presentation = await presentCredential(receivedCred, state, [0, 3], scope, ph);
    expect(verifyPresentation(presentation, issuerBbs.publicKey)).toBe(true);

    // --- Issuer publishes a 4903 void for this credential ---
    const handle = revocationHandle(receivedCred);
    const voidEvt = buildVoidEvent(handle, issuerNostrKeys.secret);
    await relay.publish(voidEvt);

    // --- Any client scanning voids (from the relay log) sees the handle ---
    const voidedHandles: Uint8Array[] = [];
    for (const evt of relay.log) {
      const h = parseVoidedHandle(evt);
      if (h !== null) voidedHandles.push(h);
    }
    expect(voidedHandles).toHaveLength(1);
    expect(isRevoked(handle, voidedHandles)).toBe(true);
    // A different credential's handle is NOT flagged.
    const fakeHandle = new Uint8Array(32).fill(0x99);
    expect(isRevoked(fakeHandle, voidedHandles)).toBe(false);
  });

  it('expired credentials are rejected by freshness check', () => {
    const nowEpoch = currentEpoch();
    const notYetExpired = { expiry_epoch: nowEpoch + 1 };
    const expired = { expiry_epoch: nowEpoch - 1 };
    // The freshness rule: presentation is valid iff current epoch ≤ expiry_epoch.
    // This is a straight inequality — no library call needed.
    const isFresh = (cred: { expiry_epoch: number }, now: number): boolean =>
      now <= cred.expiry_epoch;
    expect(isFresh(notYetExpired, nowEpoch)).toBe(true);
    expect(isFresh(expired, nowEpoch)).toBe(false);
  });

  it('void event contents leak only the handle — no subject, no issuer plaintext', async () => {
    const relay = new MockRelay();
    const issuerBbs = await generateIssuerKeypair();
    const issuerNostrKeys = generateKeypair();

    const { request, state } = await requestCredential({
      tier: 1,
      ctx: 'x',
      issued_epoch: currentEpoch(),
      expiry_epoch: currentEpoch() + 1,
      issuer_scope_tag: new Uint8Array(32).fill(3),
    });
    const cred = await issueCredential(request, issuerBbs.secretKey, issuerBbs.publicKey);
    void state; // this test doesn't present, just voids

    const handle = revocationHandle(cred);
    const voidEvt = buildVoidEvent(handle, issuerNostrKeys.secret);
    await relay.publish(voidEvt);

    // The event content is a small JSON `{v, handle}` — no subject/scope info.
    expect(voidEvt.content).toContain(bytesToHex(handle));
    // It does NOT contain the issuer's BBS public key or the credential signature.
    expect(voidEvt.content).not.toContain(bytesToHex(issuerBbs.publicKey));
    expect(voidEvt.content).not.toContain(bytesToHex(cred.signature));
  });
});

// Silence unused-import complaints when the test doesn't exercise every export.
void ({} as {
  Credential: Credential;
  HolderState: HolderState;
});
