// Handshake engine — DD §5 five-stage consent handshake.
//
// Wire kinds (all wrapped inside 1059 gift wraps, per DD §33):
//   4913 intent ping     (stage 1)
//   4914 terms response  (stage 2)
//   4915 commit          (stage 3, commitment ciphertext of identity payload)
//   4916 reveal          (stage 3, decryption key — only after both commits received)
//   4917 channel handoff (stage 5, pairwise channel established)
//
// The design's most load-bearing property lives here: **silent decline = zero
// events on the wire, ever** (TESTING.md Gate 2). There is no 'decline'
// enum value, no NACK, no receipt. If a user taps Pass, we simply drop the
// state.
//
// Sources of law:
//   DD §5 stages 0–5
//   DD §35 F1 vouches ride inside identity payloads, self-contained
//   Build list M5-T4 acceptance (channelOpen for happy path, Gate 2 for pass)

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import type { NostrEvent } from 'nostr-tools/pure';

import { buildAndSign, verifyEvent } from '../codec/event';
import { generateKeypair, type Keypair } from '../keys/keys';
import type { Relay } from '../relay/types';
import type { CachedVouch, WeftStore } from '../store/types';
import { openTextFrom, sealTextTo } from '../wrap/nip44';
import { unwrap, wrap } from '../wrap/gift';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HandshakeStage =
  | 'idle'
  | 'pinged'
  | 'termsAgreed'
  | 'committed'
  | 'revealed'
  | 'channelOpen'
  | 'expired';

export type HandshakeRole = 'asker' | 'responder';

export interface IdentityPayload {
  readonly pubkey: string; // real pubkey (hex)
  readonly displayName: string;
  /** Full 4902 attestations (self-contained, DD §35 F1) — verified locally. */
  readonly vouches: readonly NostrEvent[];
}

interface HandshakeState {
  matchId: string;
  role: HandshakeRole;
  stage: HandshakeStage;
  /** MY ephemeral keypair for this handshake (used for wrap + sign). */
  myEph: Keypair;
  /** Their ephemeral pubkey (hex). For asker: from match reply. For responder: from 4913. */
  theirEphPub: string;
  /** MY commit symmetric key (32 bytes) — sent in 4916 after both commits received. */
  myCommitKey?: Uint8Array;
  /** Their commit ciphertext (from 4915). */
  theirCommitCiphertext?: string;
  /** Both-committed flag (used to trigger reveal). */
  theirCommitReceived: boolean;
  myCommitSent: boolean;
  theirRevealKey?: Uint8Array;
  /** Terms offered (asker) or accepted (responder). */
  terms: readonly string[];
  /** Deadline unix seconds — reaper drops stalled state past this. */
  expiresAt: number;
}

export type HandshakeEvent =
  | { type: 'termsRequested'; matchId: string; theirTerms: readonly string[]; theirEphPub: string }
  | { type: 'channelOpen'; matchId: string; theirIdentity: IdentityPayload }
  | { type: 'impersonationAlert'; matchId: string; note: string }
  | { type: 'expired'; matchId: string };

export type HandshakeListener = (e: HandshakeEvent) => void;

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

const HANDSHAKE_TTL_SECONDS = 60 * 60 * 6; // E-class: 6 hours

export interface HandshakeEngineOptions {
  readonly me: Keypair; // real keypair — used ONLY in identity payloads, never on the wire
  readonly displayName: string;
  readonly store: WeftStore;
  readonly relay: Relay;
  readonly relaysToPublish?: readonly string[];
  readonly now?: () => number;
}

export class HandshakeEngine {
  private readonly me: Keypair;
  private readonly displayName: string;
  private readonly store: WeftStore;
  private readonly relay: Relay;
  private readonly relaysToPublish: readonly string[];
  private readonly now: () => number;

  /** matchId → state. */
  private readonly states = new Map<string, HandshakeState>();
  /** myEphPubHex → matchId. Lets us route incoming wraps to their state. */
  private readonly ephRoster = new Map<string, string>();

  private readonly listeners = new Set<HandshakeListener>();

  /** Convenience: pubkeys we're actively watching (for the caller to subscribe). */
  ephPubkeys(): string[] {
    return [...this.ephRoster.keys()];
  }

  constructor(opts: HandshakeEngineOptions) {
    this.me = opts.me;
    this.displayName = opts.displayName;
    this.store = opts.store;
    this.relay = opts.relay;
    this.relaysToPublish = opts.relaysToPublish ?? [];
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  on(l: HandshakeListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(e: HandshakeEvent): void {
    for (const l of this.listeners) l(e);
  }

  /**
   * Responder-side: after emitting a match reply from a query, `register` an
   * ephemeral key so we can receive the follow-up 4913 intent ping.
   * The caller should also subscribe the relay to `p = ephPubHex` so wraps arrive.
   */
  registerResponderMatch(matchId: string): { ephPubHex: string } {
    const myEph = generateKeypair();
    const st: HandshakeState = {
      matchId,
      role: 'responder',
      stage: 'idle',
      myEph,
      theirEphPub: '', // learned when 4913 arrives
      theirCommitReceived: false,
      myCommitSent: false,
      terms: [],
      expiresAt: this.now() + HANDSHAKE_TTL_SECONDS,
    };
    this.states.set(matchId, st);
    const ephPubHex = bytesToHex(myEph.pubkey);
    this.ephRoster.set(ephPubHex, matchId);
    return { ephPubHex };
  }

  /**
   * Asker-side: after receiving a match arrival, send an intent ping to the
   * responder's ephemeralReplyPub.
   */
  async initiate(
    matchId: string,
    theirEphPub: string,
    offeredTerms: readonly string[] = [],
  ): Promise<{ myEphPubHex: string }> {
    const myEph = generateKeypair();
    const st: HandshakeState = {
      matchId,
      role: 'asker',
      stage: 'pinged',
      myEph,
      theirEphPub,
      theirCommitReceived: false,
      myCommitSent: false,
      terms: offeredTerms,
      expiresAt: this.now() + HANDSHAKE_TTL_SECONDS,
    };
    this.states.set(matchId, st);
    const myEphPubHex = bytesToHex(myEph.pubkey);
    this.ephRoster.set(myEphPubHex, matchId);

    // 4913 intent ping: {matchId, terms, myEphPub}
    const inner = buildAndSign(
      {
        kind: 4913,
        content: JSON.stringify({ matchId, terms: [...offeredTerms], myEphPub: myEphPubHex }),
      },
      myEph.secret,
    );
    const outer = wrap(inner, theirEphPub, this.now());
    await this.relay.publish(outer, this.relaysToPublish);

    return { myEphPubHex };
  }

  /**
   * Called by both sides when a Pass decision is made (user tapped Pass, or
   * we detected a mismatch we don't want to reveal). **Emits zero events.**
   * Just drops the state. This is Gate 2 in code.
   */
  pass(matchId: string): void {
    const st = this.states.get(matchId);
    if (!st) return;
    this.ephRoster.delete(bytesToHex(st.myEph.pubkey));
    (st.myEph.secret as Uint8Array).fill(0);
    this.states.delete(matchId);
    // NO EMIT of a wire event. NO listener notification of a "decline".
  }

  /**
   * Responder-side: accept terms from the asker. Advances stage `pinged →
   * termsAgreed` and sends the 4914 terms response, then immediately builds
   * and sends our 4915 commit.
   */
  async acceptTerms(matchId: string, myIdentity: IdentityPayload): Promise<void> {
    const st = this.states.get(matchId);
    if (!st || st.role !== 'responder' || st.stage !== 'pinged') return;
    st.stage = 'termsAgreed';

    // 4914 terms response: accept.
    const terms4914 = buildAndSign(
      {
        kind: 4914,
        content: JSON.stringify({ matchId, accept: true, terms: [...st.terms] }),
      },
      st.myEph.secret,
    );
    const outer4914 = wrap(terms4914, st.theirEphPub, this.now());
    await this.relay.publish(outer4914, this.relaysToPublish);

    // Immediately send our commit.
    await this.sendCommit(matchId, myIdentity);
  }

  /**
   * Asker-side: called when we've decided to proceed after the 4914 arrives.
   * The engine advances asker to `termsAgreed` internally on 4914 receipt and
   * caller then invokes `sendMyCommit` to move to `committed`.
   *
   * Simplified for v0: both sides commit immediately on 4914; caller supplies
   * identity payload once and we handle the rest.
   */
  async sendMyCommit(matchId: string, myIdentity: IdentityPayload): Promise<void> {
    const st = this.states.get(matchId);
    if (!st) return;
    if (st.role === 'asker' && st.stage !== 'termsAgreed') return;
    if (st.myCommitSent) return;
    await this.sendCommit(matchId, myIdentity);
  }

  /** Route an incoming wrapped event whose `p` tag matches one of our ephemeral pubkeys. */
  async handleIncomingWrap(outer: NostrEvent): Promise<void> {
    if (outer.kind !== 1059) return;
    // Find which of our ephemeral keys the wrap is addressed to (via `p`).
    const pTag = outer.tags.find((t) => t[0] === 'p')?.[1];
    if (!pTag) return;
    const matchId = this.ephRoster.get(pTag);
    if (!matchId) return;
    const st = this.states.get(matchId);
    if (!st) return;

    const opened = unwrap(outer, st.myEph.secret);
    if (!opened) return;
    if (!verifyEvent(opened.inner)) return;

    // Dispatch by inner kind.
    switch (opened.inner.kind) {
      case 4913:
        await this.onIntentPing(st, opened.inner);
        break;
      case 4914:
        await this.onTermsResponse(st, opened.inner);
        break;
      case 4915:
        await this.onCommit(st, opened.inner);
        break;
      case 4916:
        await this.onReveal(st, opened.inner);
        break;
      default:
        // Unknown handshake kinds ignored (forward compat).
        break;
    }
  }

  // ---------------------------------------------------------------------
  // Stage handlers
  // ---------------------------------------------------------------------

  private async onIntentPing(st: HandshakeState, inner: NostrEvent): Promise<void> {
    if (st.role !== 'responder' || st.stage !== 'idle') return;
    let body: { matchId?: string; terms?: string[]; myEphPub?: string };
    try {
      body = JSON.parse(inner.content);
    } catch {
      return;
    }
    if (body.matchId !== st.matchId || typeof body.myEphPub !== 'string') return;
    st.theirEphPub = body.myEphPub;
    st.stage = 'pinged';
    st.terms = body.terms ?? [];
    // Notify the UI so the "Connect / Pass" card can appear.
    this.emit({
      type: 'termsRequested',
      matchId: st.matchId,
      theirTerms: st.terms,
      theirEphPub: st.theirEphPub,
    });
  }

  private async onTermsResponse(st: HandshakeState, inner: NostrEvent): Promise<void> {
    if (st.role !== 'asker' || st.stage !== 'pinged') return;
    let body: { matchId?: string; accept?: boolean; terms?: string[] };
    try {
      body = JSON.parse(inner.content);
    } catch {
      return;
    }
    if (body.matchId !== st.matchId) return;
    if (!body.accept) {
      // Silent decline is unrepresentable on the wire; a 4914 with accept=false
      // would still be an event. We tolerate it in case a client encodes an
      // explicit rejection, but the design's canonical decline is silence.
      this.pass(st.matchId);
      return;
    }
    st.stage = 'termsAgreed';
  }

  private async sendCommit(matchId: string, myIdentity: IdentityPayload): Promise<void> {
    const st = this.states.get(matchId);
    if (!st) return;
    // Generate a fresh symmetric commit key (will be sent in 4916 later).
    const commitKey = randomBytes(32);
    st.myCommitKey = commitKey;

    // Encrypt identity payload with the commit key (naive NIP-44 use: seal
    // to a throwaway pubkey derived from commit key — for v0 we just use
    // the commit key as an HMAC key over the payload. Simpler: use NIP-44
    // between myEph and theirEph, with the commit-key XORed in as a second
    // layer.)
    //
    // For v0 clarity, the simpler ciphertext scheme: we NIP-44 seal
    // JSON(identity) with a per-commit ephemeral secret whose pubkey we
    // then embed in the ciphertext. The commit-key IS the second ephemeral
    // secret. Reveal (4916) discloses the key.
    const inner = JSON.stringify(myIdentity);
    const commitEph: Keypair = { secret: commitKey, pubkey: computePubkeyFromSecret(commitKey) };
    const ciphertext = sealTextTo(st.theirEphPub, inner, commitEph.secret);

    const commit4915 = buildAndSign(
      {
        kind: 4915,
        content: JSON.stringify({
          matchId,
          ciphertext,
          commitPub: bytesToHex(commitEph.pubkey),
        }),
      },
      st.myEph.secret,
    );
    const outer = wrap(commit4915, st.theirEphPub, this.now());
    await this.relay.publish(outer, this.relaysToPublish);
    st.myCommitSent = true;
    if (st.role === 'asker') st.stage = 'committed';
    if (st.role === 'responder') st.stage = 'committed';

    // If we already have their commit, we can reveal now.
    if (st.theirCommitReceived) {
      await this.sendReveal(matchId);
    }
  }

  private async onCommit(st: HandshakeState, inner: NostrEvent): Promise<void> {
    let body: { matchId?: string; ciphertext?: string; commitPub?: string };
    try {
      body = JSON.parse(inner.content);
    } catch {
      return;
    }
    if (body.matchId !== st.matchId || typeof body.ciphertext !== 'string') return;
    st.theirCommitCiphertext = body.ciphertext;
    st.theirCommitReceived = true;
    // If we've also sent our commit, we can reveal.
    if (st.myCommitSent) {
      await this.sendReveal(st.matchId);
    }
  }

  private async sendReveal(matchId: string): Promise<void> {
    const st = this.states.get(matchId);
    if (!st || !st.myCommitKey) return;
    if (st.stage === 'revealed' || st.stage === 'channelOpen') return;
    // 4916 reveal: send the commit key so the other side can decrypt our commit ciphertext.
    const reveal4916 = buildAndSign(
      {
        kind: 4916,
        content: JSON.stringify({
          matchId,
          key: bytesToHex(st.myCommitKey),
        }),
      },
      st.myEph.secret,
    );
    const outer = wrap(reveal4916, st.theirEphPub, this.now());
    await this.relay.publish(outer, this.relaysToPublish);
    st.stage = 'revealed';
    // If we also have their reveal key, we can decrypt their identity now.
    if (st.theirRevealKey) {
      await this.finalize(matchId);
    }
  }

  private async onReveal(st: HandshakeState, inner: NostrEvent): Promise<void> {
    let body: { matchId?: string; key?: string };
    try {
      body = JSON.parse(inner.content);
    } catch {
      return;
    }
    if (body.matchId !== st.matchId || typeof body.key !== 'string') return;
    const key = hexToBytesLocal(body.key);
    if (key.length !== 32) return;
    st.theirRevealKey = key;
    // If we've revealed ours too, finalize.
    if (st.stage === 'revealed' || st.stage === 'channelOpen') {
      await this.finalize(st.matchId);
    }
  }

  private async finalize(matchId: string): Promise<void> {
    const st = this.states.get(matchId);
    if (!st || !st.theirCommitCiphertext || !st.theirRevealKey) return;
    if (st.stage === 'channelOpen') return;

    // Decrypt their identity. We need their commit-key-derived pubkey to
    // compute the NIP-44 convKey. We embedded commitPub in the 4915 body.
    // Re-parse from the stashed ciphertext + the pubkey derived from their key.
    let identity: IdentityPayload;
    try {
      // Their commit pubkey = derive from their reveal key.
      const theirCommitPub = bytesToHex(computePubkeyFromSecret(st.theirRevealKey));
      const plaintext = openTextFrom(theirCommitPub, st.theirCommitCiphertext, st.myEph.secret);
      identity = JSON.parse(plaintext);
    } catch {
      this.emit({
        type: 'impersonationAlert',
        matchId,
        note: 'failed to decrypt commit ciphertext with revealed key',
      });
      st.stage = 'expired';
      return;
    }

    // Vouch verification: each 4902 attestation must be signed correctly
    // AND have subject == identity.pubkey.
    for (const v of identity.vouches) {
      if (!verifyEvent(v)) {
        this.emit({
          type: 'impersonationAlert',
          matchId,
          note: 'vouch signature invalid',
        });
        st.stage = 'expired';
        return;
      }
      let vbody: { subject?: string };
      try {
        vbody = JSON.parse(v.content);
      } catch {
        continue;
      }
      if (vbody.subject !== identity.pubkey) {
        this.emit({
          type: 'impersonationAlert',
          matchId,
          note: 'vouch subject does not match revealed pubkey',
        });
        st.stage = 'expired';
        return;
      }
    }

    st.stage = 'channelOpen';
    this.emit({ type: 'channelOpen', matchId, theirIdentity: identity });
  }

  /**
   * Called periodically (by the reaper). Any handshake past its deadline
   * moves to `expired` and its state is dropped. **Does not emit wire events.**
   */
  sweep(now: number): void {
    for (const [matchId, st] of this.states) {
      if (st.expiresAt <= now) {
        this.ephRoster.delete(bytesToHex(st.myEph.pubkey));
        (st.myEph.secret as Uint8Array).fill(0);
        this.states.delete(matchId);
        this.emit({ type: 'expired', matchId });
      }
    }
  }

  /** Test helper: read a state (returns a copy, safe to log). */
  peekState(matchId: string): { stage: HandshakeStage; role: HandshakeRole } | undefined {
    const st = this.states.get(matchId);
    if (!st) return undefined;
    return { stage: st.stage, role: st.role };
  }

  /** Convenience for tests: get my identity payload from the store. */
  async buildMyIdentity(): Promise<IdentityPayload> {
    const vouches = await this.store.getMyVouches();
    return {
      pubkey: bytesToHex(this.me.pubkey),
      displayName: this.displayName,
      vouches: vouches.map((v: CachedVouch) => v.event),
    };
  }
}

// Local helpers.
function hexToBytesLocal(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

import { publicKeyFromSecret } from '../keys/keys';
function computePubkeyFromSecret(sk: Uint8Array): Uint8Array {
  return publicKeyFromSecret(sk);
}

// Re-export sha256 in case future callers need to compute attestation hashes here.
export { sha256 };
