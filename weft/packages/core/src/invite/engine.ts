// Invite engine — DD §30.3 across two devices.
//
// Alice (inviter):
//   createInvite → tokenStr + ledger entry {status: 'sent'}
//   handleRedemption(4918) → single-use check; awaitingConfirm
//   confirm(iid, yes) → build 4902 attestation, WRAP to redeemer (never
//                       publish plaintext — Gate 3, DD §35 F1), enqueue 4919
//                       hello, add contact
//   confirm(iid, no)  → publish 4903 void referencing the invite iid
//
// Bob (redeemer):
//   redeemInvite(tokenStr) → validate + describe; generate root key;
//                            enqueue 4918 wrapped to inviter
//   handleVouchDelivery(4902 wrapped) → verify, store privately (never emit)
//
// Sources of law:
//   DD §30.3 redemption steps 1–7
//   DD §35 F1 vouches are private (Gate 3)
//   Build list M5-T2

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import type { NostrEvent } from 'nostr-tools/pure';

import { buildAndSign, verifyEvent } from '../codec/event';
import { generateKeypair, publicKeyFromSecret, sign, type Keypair } from '../keys/keys';
import type { Relay } from '../relay/types';
import type { OutgoingInvite, WeftStore } from '../store/types';
import { unwrap, wrap } from '../wrap/gift';
import {
  decodeInviteToken,
  describeToken,
  encodeInviteToken,
  type InviteToken,
  type InviteTokenBody,
  type InviteTokenDescription,
} from './token';

export type InviteEngineEvent =
  | { type: 'replayAlert'; iid: string; note: string }
  | { type: 'inviteConfirmed'; iid: string; contactPubkey: string }
  | { type: 'inviteVoided'; iid: string }
  | { type: 'vouchReceived'; issuer: string; attestationHash: string }
  | { type: 'redemptionReceived'; iid: string; redeemerPubkey: string; redeemerName: string };

export type InviteEngineListener = (e: InviteEngineEvent) => void;

export interface CreateInviteInput {
  readonly sentTo: string;
  readonly tier: 1 | 2 | 3;
  readonly ctx: string;
  readonly relays: readonly string[];
  readonly charterId: Uint8Array; // 32 bytes
  readonly tokenExpiresAt?: number; // unix seconds; defaults to now+14d
  readonly vouchValidityDays?: number; // defaults to 90
}

export interface RedeemResult {
  readonly ok: true;
  readonly description: InviteTokenDescription;
  readonly bobKeypair: Keypair;
  readonly redemptionEvent: NostrEvent; // wrapped 4918 already enqueued
}

export interface RedeemFailure {
  readonly ok: false;
  readonly reason: 'invalid' | 'expired';
  readonly detail?: string;
}

export class InviteEngine {
  private readonly listeners = new Set<InviteEngineListener>();

  constructor(
    private readonly store: WeftStore,
    private readonly relay: Relay,
    private readonly me: Keypair,
    private readonly relaysToPublish: readonly string[] = [],
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  on(listener: InviteEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(e: InviteEngineEvent): void {
    for (const l of this.listeners) l(e);
  }

  // ---------------------------------------------------------------------
  // Alice side — create the invite
  // ---------------------------------------------------------------------

  async createInvite(input: CreateInviteInput): Promise<{ tokenStr: string; iid: string }> {
    const now = this.now();
    const iidBytes = randomBytes(16);
    const body: InviteTokenBody = {
      ver: 1,
      iid: iidBytes,
      inv: this.me.pubkey,
      vtpl: {
        tier: input.tier,
        ctx: input.ctx,
        vexp: input.vouchValidityDays ?? 90,
      },
      exp: input.tokenExpiresAt ?? now + 14 * 24 * 60 * 60,
      flags: 0b11, // single_use | confirm_required
      relays: input.relays,
      chp: input.charterId,
    };
    const tokenStr = encodeInviteToken(body, this.me.secret);
    const iidHex = bytesToHex(iidBytes);
    await this.store.putInvite({
      iid: iidHex,
      tokenStr,
      sentTo: input.sentTo,
      status: 'sent',
      createdAt: now,
    });
    return { tokenStr, iid: iidHex };
  }

  /** Revoke an invite before it's redeemed (publishes a 4903 void referencing the iid). */
  async revokeInvite(iid: string): Promise<void> {
    const inv = await this.store.getInvite(iid);
    if (!inv) return;
    if (inv.status !== 'sent' && inv.status !== 'awaitingConfirm') return;
    await this.publishVoid(iid);
    await this.store.updateInviteStatus(iid, 'voided');
  }

  // ---------------------------------------------------------------------
  // Bob side — redeem an invite
  // ---------------------------------------------------------------------

  async redeemInvite(tokenStr: string, displayName: string): Promise<RedeemResult | RedeemFailure> {
    const parsed = decodeInviteToken(tokenStr, this.now());
    if (!parsed.ok) {
      return { ok: false, reason: parsed.error === 'expired' ? 'expired' : 'invalid', detail: parsed.error };
    }
    const token = parsed.token;
    // We don't reuse this.me here — Bob just generated a fresh root key
    // externally, or (more commonly) the *caller* uses generateKeypair()
    // and passes it in. But for the engine we support both patterns:
    //   - engine.redeemInvite creates the key
    //   - PWA layer may pre-generate and pass in
    // We take the former for simplicity; PWA can swap later.
    const bobKeypair = generateKeypair();
    // Build a 4918 redemption event: {iid, new_pubkey, display_name}.
    const iidHex = bytesToHex(token.iid);
    const inviterHex = bytesToHex(token.inv);
    const redemption4918 = buildAndSign(
      {
        kind: 4918,
        content: JSON.stringify({
          iid: iidHex,
          new_pubkey: bytesToHex(bobKeypair.pubkey),
          display_name: displayName,
        }),
      },
      bobKeypair.secret,
    );
    const wrapped = wrap(redemption4918, inviterHex, this.now());
    // Publish (fire-and-forget from the engine — outbox integration is a PWA
    // concern; here we go direct).
    await this.relay.publish(wrapped, token.relays);
    return {
      ok: true,
      description: describeToken(token),
      bobKeypair,
      redemptionEvent: wrapped,
    };
  }

  // ---------------------------------------------------------------------
  // Alice side — handle an incoming 4918 redemption
  // ---------------------------------------------------------------------

  async handleIncomingWrap(outer: NostrEvent): Promise<void> {
    if (outer.kind !== 1059) return;
    const opened = unwrap(outer, this.me.secret);
    if (!opened) return;
    const inner = opened.inner;

    switch (inner.kind) {
      case 4918:
        await this.handleRedemption(inner);
        break;
      case 4902:
        await this.handleVouchDelivery(inner, opened.wrapperPubkey);
        break;
      case 4919:
        // pairwise hello — for M5-T2 acceptance we just note it; the query
        // engine will consume the ratchet init when M5-T3 lands.
        break;
      default:
        // Unknown inner kinds are ignored (forward compat, DD §33.4).
        break;
    }
  }

  private async handleRedemption(inner4918: NostrEvent): Promise<void> {
    if (!verifyEvent(inner4918)) return;
    let payload: { iid?: string; new_pubkey?: string; display_name?: string };
    try {
      payload = JSON.parse(inner4918.content);
    } catch {
      return;
    }
    const { iid, new_pubkey, display_name } = payload;
    if (typeof iid !== 'string' || typeof new_pubkey !== 'string' || typeof display_name !== 'string') {
      return;
    }
    // The 4918's signature is by Bob's fresh key — confirm the pubkey matches.
    if (inner4918.pubkey !== new_pubkey) return;

    const existing = await this.store.getInvite(iid);
    if (!existing) return; // not our invite
    if (existing.status !== 'sent') {
      // Second redemption of the same iid — surface as replayAlert.
      this.emit({ type: 'replayAlert', iid, note: `status was ${existing.status}` });
      return;
    }
    await this.store.updateInviteStatus(iid, 'awaitingConfirm', {
      redeemerPubkey: new_pubkey,
      redeemerName: display_name,
    });
    this.emit({
      type: 'redemptionReceived',
      iid,
      redeemerPubkey: new_pubkey,
      redeemerName: display_name,
    });
  }

  /**
   * Alice confirms or rejects the invite after the "is this your Bob?" card.
   *
   * yes → build a 4902 attestation, WRAP to Bob (never publish plaintext —
   *       Gate 3), enqueue a 4919 hello, add Bob as a contact.
   * no  → publish a 4903 void referencing the invite iid.
   */
  async confirmInvite(iid: string, yes: boolean): Promise<void> {
    const inv = await this.store.getInvite(iid);
    if (!inv || inv.status !== 'awaitingConfirm' || !inv.redeemerPubkey) return;

    if (!yes) {
      await this.publishVoid(iid);
      await this.store.updateInviteStatus(iid, 'voided');
      this.emit({ type: 'inviteVoided', iid });
      return;
    }

    // yes path — construct the vouch attestation (kind 4902).
    // The 4902's content is a compact record; the *event signature* by Alice's
    // key is the attestation. The kind is `privateOnly: true` in the registry
    // (kinds/registry.ts) — this codepath MUST NOT publish it publicly.
    const now = this.now();
    const parsedToken = decodeInviteToken(inv.tokenStr, undefined);
    if (!parsedToken.ok) return;
    const token = parsedToken.token;

    const attestationBody = {
      subject: inv.redeemerPubkey,
      tier: token.vtpl.tier,
      ctx: token.vtpl.ctx,
      issued_at: now,
      expires_at: now + token.vtpl.vexp * 24 * 60 * 60,
      // The invite iid ties this attestation to its originating invite for
      // audit and revocation (DD §30.3 step 6, §35 F1).
      iid,
    };
    const attestation4902 = buildAndSign(
      {
        kind: 4902,
        content: JSON.stringify(attestationBody),
        tags: [
          ['p', inv.redeemerPubkey],
          ['tier', String(token.vtpl.tier)],
          ['ctx', token.vtpl.ctx],
        ],
      },
      this.me.secret,
    );

    // WRAP the attestation and deliver to Bob privately.
    // NEVER call relay.publish on the plaintext 4902.
    const wrappedAttestation = wrap(attestation4902, inv.redeemerPubkey, now);
    await this.relay.publish(wrappedAttestation, this.relaysToPublish);

    // 4919 pairwise hello.
    const hello4919 = buildAndSign(
      {
        kind: 4919,
        content: JSON.stringify({ from: bytesToHex(this.me.pubkey), iid }),
      },
      this.me.secret,
    );
    const wrappedHello = wrap(hello4919, inv.redeemerPubkey, now);
    await this.relay.publish(wrappedHello, this.relaysToPublish);

    // Add Bob to our contacts and initialize the stamp ledger.
    await this.store.upsertContact({
      pubkey: inv.redeemerPubkey,
      displayName: inv.redeemerName ?? 'unknown',
      relayHints: token.relays,
      addedAt: now,
    });
    await this.store.setStamp(inv.redeemerPubkey, 20); // initial per-contact budget

    // Alice also caches her own copy of the attestation locally, so she can
    // point at what she attested to later.
    const attHash = bytesToHex(sha256(new TextEncoder().encode(attestation4902.id)));
    await this.store.putVouch({
      subject: inv.redeemerPubkey,
      issuer: bytesToHex(this.me.pubkey),
      event: attestation4902,
      expiresAt: attestationBody.expires_at,
      attestationHash: attHash,
    });

    await this.store.updateInviteStatus(iid, 'confirmed');
    this.emit({ type: 'inviteConfirmed', iid, contactPubkey: inv.redeemerPubkey });
  }

  // ---------------------------------------------------------------------
  // Bob side — handle an incoming 4902 vouch delivery
  // ---------------------------------------------------------------------

  private async handleVouchDelivery(inner4902: NostrEvent, wrapperPubkey: string): Promise<void> {
    if (inner4902.kind !== 4902) return;
    if (!verifyEvent(inner4902)) return;
    let body: {
      subject?: string;
      tier?: number;
      ctx?: string;
      issued_at?: number;
      expires_at?: number;
      iid?: string;
    };
    try {
      body = JSON.parse(inner4902.content);
    } catch {
      return;
    }
    if (typeof body.subject !== 'string' || typeof body.expires_at !== 'number') return;
    // The subject MUST equal *this device's* pubkey — anyone else's vouch is
    // not ours to cache.
    const mePubHex = bytesToHex(this.me.pubkey);
    if (body.subject !== mePubHex) return;

    const attHash = bytesToHex(sha256(new TextEncoder().encode(inner4902.id)));
    await this.store.putVouch({
      subject: mePubHex,
      issuer: inner4902.pubkey,
      event: inner4902,
      expiresAt: body.expires_at,
      attestationHash: attHash,
    });

    // Also promote the issuer to a contact (mutual — Alice adds Bob on
    // confirm, Bob adds Alice on receipt of vouch).
    if (!(await this.store.getContact(inner4902.pubkey))) {
      await this.store.upsertContact({
        pubkey: inner4902.pubkey,
        displayName: 'inviter', // will be replaced when 4919 hello arrives
        relayHints: [],
        addedAt: this.now(),
      });
      await this.store.setStamp(inner4902.pubkey, 20);
    }

    this.emit({ type: 'vouchReceived', issuer: inner4902.pubkey, attestationHash: attHash });

    // wrapperPubkey is intentionally unused here (it's the ephemeral wrap
    // key, not authenticating). Keep it in the signature for symmetry with
    // other handlers.
    void wrapperPubkey;
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /**
   * Publish a 4903 void event referencing an invite by iid hash. This is the
   * ONE vouch-related object that legitimately touches a relay (DD §33.2).
   * The reference is the sha256 of the iid string, so the void does not
   * reveal the redeemer, the subject, or any edge.
   */
  private async publishVoid(iid: string): Promise<void> {
    const iidHash = bytesToHex(sha256(new TextEncoder().encode(iid)));
    const void4903 = buildAndSign(
      {
        kind: 4903,
        content: '',
        tags: [['e', iidHash]],
      },
      this.me.secret,
    );
    await this.relay.publish(void4903, this.relaysToPublish);
  }
}

// Re-export a couple of helpers callers commonly need.
export { decodeInviteToken, describeToken, encodeInviteToken };
export { hexToBytes, sign, publicKeyFromSecret };
export type { InviteToken, OutgoingInvite };
