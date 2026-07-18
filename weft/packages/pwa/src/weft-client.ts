// WeftClient — the top-level PWA runtime. Owns the store, relay, embedder,
// and every engine, wires their subscriptions, and exposes a small
// listener-based API the React layer consumes via WeftContext.
//
// One instance per authenticated user (per browser profile). All engines
// share one Relay adapter (SimplePool + WebSocket) and one MemoryStore-
// or-Idb store.

import { SimplePool } from 'nostr-tools/pool';
import {
  HandshakeEngine,
  HealthLog,
  InviteEngine,
  QueryEngine,
  StubEmbedder,
  bytesToHex,
  publicKeyFromSecret,
  sealTextTo,
  openTextFrom,
  buildAndSign,
  verifyEvent,
  unwrap,
  wrap,
  type EventCallback,
  type Embedder,
  type HandshakeEvent,
  type IdentityPayload,
  type InviteTokenDescription,
  type Keypair,
  type NostrEvent,
  type OutgoingInvite,
  type QueryEngineEvent,
  type Relay,
  type RelayFilter,
  type Subscription,
  type MatchArrival,
  type WeftStore,
  type InviteEngineEvent,
  decodeInviteToken,
  describeToken,
  parseCarrier,
  Tags,
} from '@weft/core';
import { IdbStore } from './idb-store';

// ---------------------------------------------------------------------------
// Relay adapter — SimplePool over WSS. Same shape as porch's, with the
// nostr-tools 2.23 filter fix.
// ---------------------------------------------------------------------------

class PoolRelay implements Relay {
  private readonly pool = new SimplePool();
  constructor(readonly urls: readonly string[]) {}

  async publish(evt: NostrEvent, urls?: readonly string[]): Promise<void> {
    const target = [...(urls ?? this.urls)];
    await Promise.any(this.pool.publish(target, evt)).catch(() => {
      // All relays failed — soft failure; caller may retry.
    });
  }

  subscribe(filter: RelayFilter, onEvent: EventCallback): Subscription {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nostrFilter: any = {};
    if (filter.kinds) nostrFilter.kinds = [...filter.kinds];
    if (filter.p) nostrFilter['#p'] = [...filter.p];
    if (filter.ids) nostrFilter.ids = [...filter.ids];
    if (filter.since !== undefined) nostrFilter.since = filter.since;
    const sub = (
      this.pool as unknown as {
        subscribeMany: (
          urls: string[],
          filter: unknown,
          opts: { onevent: (e: NostrEvent) => void },
        ) => { close(): void };
      }
    ).subscribeMany([...this.urls], nostrFilter, {
      onevent: (evt: NostrEvent) => onEvent(evt),
    });
    return { close: () => sub.close() };
  }
}

// ---------------------------------------------------------------------------
// Client state, event types
// ---------------------------------------------------------------------------

export interface AskOut {
  readonly queryId: string;
  readonly text: string;
  readonly status: 'traveling' | 'matched' | 'dead';
  readonly sentAt: number;
  readonly matches: MatchArrival[];
}

export interface PendingConfirmation {
  readonly iid: string;
  readonly redeemerName: string;
  readonly redeemerPubkey: string;
}

export interface ImpersonationAlert {
  readonly matchId: string;
  readonly note: string;
}

export interface RevealedContact {
  readonly matchId: string;
  readonly identity: IdentityPayload;
  readonly openedAt: number;
}

export interface Message {
  readonly from: 'me' | 'them';
  readonly text: string;
  readonly at: number;
}

export interface Conversation {
  readonly peerPubkey: string;
  readonly peerName: string;
  readonly messages: Message[];
}

/** The set of state slices the React layer needs to render. */
export interface ClientState {
  readonly asksOut: readonly AskOut[];
  readonly invites: readonly OutgoingInvite[];
  readonly pendingConfirmations: readonly PendingConfirmation[];
  readonly activeMatches: readonly MatchArrival[];
  readonly revealed: readonly RevealedContact[];
  readonly impersonationAlerts: readonly ImpersonationAlert[];
  readonly conversations: readonly Conversation[];
  readonly interests: readonly string[];
  readonly counters: { asksSent: number; asksMatched: number; handshakesCompleted: number; forwardsRelayed: number; deadQueries: number };
}

export type StateListener = (s: ClientState) => void;

// ---------------------------------------------------------------------------
// Default relay set (public, well-known, filter-compatible).
// ---------------------------------------------------------------------------

export const DEFAULT_RELAYS: readonly string[] = ['wss://relay.damus.io', 'wss://nos.lol'];

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export interface WeftClientOptions {
  readonly me: Keypair;
  readonly displayName: string;
  readonly relays?: readonly string[];
}

export class WeftClient {
  private readonly me: Keypair;
  private readonly displayName: string;
  private readonly relays: readonly string[];

  readonly store: WeftStore;
  private readonly relay: Relay;
  private readonly embedder: Embedder;
  readonly invite: InviteEngine;
  readonly query: QueryEngine;
  readonly handshake: HandshakeEngine;
  readonly health: HealthLog;

  private state: ClientState = {
    asksOut: [],
    invites: [],
    pendingConfirmations: [],
    activeMatches: [],
    revealed: [],
    impersonationAlerts: [],
    conversations: [],
    interests: [],
    counters: {
      asksSent: 0,
      asksMatched: 0,
      handshakesCompleted: 0,
      forwardsRelayed: 0,
      deadQueries: 0,
    },
  };
  private readonly listeners = new Set<StateListener>();
  private readonly subs: Subscription[] = [];

  /** Map queryId → text so we can label match arrivals in the UI. */
  private readonly askTexts = new Map<string, string>();

  constructor(opts: WeftClientOptions) {
    this.me = opts.me;
    this.displayName = opts.displayName;
    this.relays = opts.relays ?? DEFAULT_RELAYS;

    const pubHex = bytesToHex(this.me.pubkey);
    const idb = new IdbStore();
    idb.setUserPubkey(pubHex);
    this.store = idb;
    this.relay = new PoolRelay(this.relays);
    this.embedder = new StubEmbedder();
    this.health = new HealthLog();

    this.invite = new InviteEngine(this.store, this.relay, this.me, this.relays);
    this.query = new QueryEngine({
      me: this.me,
      store: this.store,
      relay: this.relay,
      embedder: this.embedder,
      relaysToPublish: this.relays,
    });
    this.handshake = new HandshakeEngine({
      me: this.me,
      displayName: this.displayName,
      store: this.store,
      relay: this.relay,
      relaysToPublish: this.relays,
    });

    this.wireEvents();
    this.subscribe();
    void this.refreshInvites();
  }

  // ---------------------------------------------------------------------
  // Public API — the React layer calls these.
  // ---------------------------------------------------------------------

  subscribeState(l: StateListener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }

  getState(): ClientState {
    return this.state;
  }

  async declareInterest(text: string): Promise<void> {
    const t = text.trim();
    if (t.length === 0) return;
    await this.query.declareInterest(t);
    this.setState((s) => ({ ...s, interests: [...s.interests, t] }));
  }

  async ask(text: string): Promise<string> {
    const { queryId } = await this.query.ask(text);
    this.askTexts.set(queryId, text);
    this.health.askSent();
    this.setState((s) => ({
      ...s,
      asksOut: [
        ...s.asksOut,
        { queryId, text, status: 'traveling', sentAt: Math.floor(Date.now() / 1000), matches: [] },
      ],
      counters: this.health.snapshot(),
    }));
    return queryId;
  }

  async createInvite(input: { sentTo: string; tier: 1 | 2 | 3; ctx: string; charterId?: Uint8Array }): Promise<{ tokenStr: string; iid: string; url: string }> {
    const charterId = input.charterId ?? new Uint8Array(32).fill(0);
    const { tokenStr, iid } = await this.invite.createInvite({
      sentTo: input.sentTo,
      tier: input.tier,
      ctx: input.ctx,
      relays: this.relays,
      charterId,
    });
    const url = `${window.location.origin}${window.location.pathname}#/i/${tokenStr}`;
    await this.refreshInvites();
    return { tokenStr, iid, url };
  }

  async redeemInvite(tokenStr: string, displayName: string): Promise<{ ok: boolean; error?: string; bobKeypair?: Keypair; description?: InviteTokenDescription }> {
    const result = await this.invite.redeemInvite(tokenStr, displayName);
    if (!result.ok) return { ok: false, error: result.reason };
    // Reload page with Bob's new key (the initial WeftClient was built with a
    // temporary key; after redemption the redeemer key becomes the identity).
    // We return the new keypair; caller persists + reloads.
    return { ok: true, bobKeypair: result.bobKeypair, description: result.description };
  }

  async confirmInvite(iid: string, yes: boolean): Promise<void> {
    await this.invite.confirmInvite(iid, yes);
    this.setState((s) => ({
      ...s,
      pendingConfirmations: s.pendingConfirmations.filter((p) => p.iid !== iid),
    }));
    await this.refreshInvites();
  }

  async connectToMatch(match: MatchArrival): Promise<void> {
    const identity = await this.buildMyIdentity();
    const { myEphPubHex } = await this.handshake.initiate(
      match.queryId,
      match.responderEphemeralPub,
      ['reveal.name', 'reveal.vouches'],
      identity, // auto-send commit when terms are accepted
    );
    // Subscribe to this ephemeral key's inbox so responder wraps route into
    // the handshake engine.
    const sub = this.relay.subscribe({ kinds: [1059], p: [myEphPubHex] }, (evt: NostrEvent) => {
      void this.handshake.handleIncomingWrap(evt);
    });
    this.subs.push(sub);
  }

  async passOnMatch(match: MatchArrival): Promise<void> {
    // Gate 2: this must NOT publish anything to the wire.
    this.handshake.pass(match.queryId);
    this.setState((s) => ({
      ...s,
      activeMatches: s.activeMatches.filter((m) => m.queryId !== match.queryId),
    }));
  }

  async sendMessage(peerPubkey: string, text: string): Promise<void> {
    // v0 "channel": pairwise NIP-44 message wrapped in a plain event.
    // The receiver decrypts via their own pairwise secret.
    const inner = buildAndSign(
      {
        kind: 4917,
        content: JSON.stringify({ text }),
      },
      this.me.secret,
    );
    const outer = wrap(inner, peerPubkey);
    await this.relay.publish(outer, this.relays);
    this.appendMessage(peerPubkey, { from: 'me', text, at: Math.floor(Date.now() / 1000) });
  }

  // ---------------------------------------------------------------------
  // Wire-up
  // ---------------------------------------------------------------------

  private wireEvents(): void {
    this.invite.on((e: InviteEngineEvent) => this.onInviteEvent(e));
    this.query.on((e: QueryEngineEvent) => this.onQueryEvent(e));
    this.handshake.on((e: HandshakeEvent) => this.onHandshakeEvent(e));
  }

  private subscribe(): void {
    const pubHex = bytesToHex(this.me.pubkey);
    const primary = this.relay.subscribe({ kinds: [1059], p: [pubHex] }, (evt: NostrEvent) => {
      void this.invite.handleIncomingWrap(evt);
      void this.query.handleIncomingWrap(evt);
      void this.handshake.handleIncomingWrap(evt);
      void this.tryHandleChannelMessage(evt);
    });
    this.subs.push(primary);
  }

  private async tryHandleChannelMessage(evt: NostrEvent): Promise<void> {
    // Post-reveal channel messages are wrapped 4917 events. Try to unwrap
    // and, if inner is 4917 with a text payload, append to conversation.
    if (evt.kind !== 1059) return;
    const opened = unwrap(evt, this.me.secret);
    if (!opened) return;
    if (opened.inner.kind !== 4917) return;
    if (!verifyEvent(opened.inner)) return;
    try {
      const body = JSON.parse(opened.inner.content) as { text?: string };
      if (typeof body.text !== 'string') return;
      const peerPub = opened.inner.pubkey;
      this.appendMessage(peerPub, {
        from: 'them',
        text: body.text,
        at: Math.floor(Date.now() / 1000),
      });
    } catch {
      // Not a channel message — some other 4917 (channel handoff during
      // handshake stage 5). Ignore here; handshake engine handles it.
    }
  }

  private async onInviteEvent(e: InviteEngineEvent): Promise<void> {
    switch (e.type) {
      case 'redemptionReceived':
        this.setState((s) => ({
          ...s,
          pendingConfirmations: [
            ...s.pendingConfirmations,
            { iid: e.iid, redeemerName: e.redeemerName, redeemerPubkey: e.redeemerPubkey },
          ],
        }));
        break;
      case 'inviteConfirmed':
      case 'inviteVoided':
        await this.refreshInvites();
        break;
      case 'vouchReceived':
      case 'replayAlert':
        // Surface to the UI later — for now, refresh invites.
        await this.refreshInvites();
        break;
    }
  }

  private onQueryEvent(e: QueryEngineEvent): void {
    if (e.type === 'match') {
      this.health.askMatched();
      const { arrival } = e;
      this.setState((s) => ({
        ...s,
        activeMatches: [...s.activeMatches, arrival],
        asksOut: s.asksOut.map((a) =>
          a.queryId === arrival.queryId
            ? { ...a, status: 'matched', matches: [...a.matches, arrival] }
            : a,
        ),
        counters: this.health.snapshot(),
      }));
    } else if (e.type === 'droppedForward') {
      this.health.deadQuery();
      this.setState((s) => ({ ...s, counters: this.health.snapshot() }));
    }
  }

  private onHandshakeEvent(e: HandshakeEvent): void {
    if (e.type === 'channelOpen') {
      this.health.handshakeCompleted();
      this.setState((s) => ({
        ...s,
        activeMatches: s.activeMatches.filter((m) => m.queryId !== e.matchId),
        revealed: [
          ...s.revealed,
          { matchId: e.matchId, identity: e.theirIdentity, openedAt: Math.floor(Date.now() / 1000) },
        ],
        conversations: s.conversations.some((c) => c.peerPubkey === e.theirIdentity.pubkey)
          ? s.conversations
          : [
              ...s.conversations,
              {
                peerPubkey: e.theirIdentity.pubkey,
                peerName: e.theirIdentity.displayName,
                messages: [],
              },
            ],
        counters: this.health.snapshot(),
      }));
    } else if (e.type === 'impersonationAlert') {
      this.setState((s) => ({
        ...s,
        activeMatches: s.activeMatches.filter((m) => m.queryId !== e.matchId),
        impersonationAlerts: [
          ...s.impersonationAlerts,
          { matchId: e.matchId, note: e.note },
        ],
      }));
    } else if (e.type === 'termsRequested') {
      // Responder side — auto-accept with our identity for v0. (A future UX
      // pass surfaces the terms card here.)
      void this.acceptTermsAndCommit(e.matchId);
    }
  }

  private async acceptTermsAndCommit(matchId: string): Promise<void> {
    const identity = await this.buildMyIdentity();
    await this.handshake.acceptTerms(matchId, identity);
  }

  private async buildMyIdentity(): Promise<IdentityPayload> {
    const vouches = await this.store.getMyVouches();
    return {
      pubkey: bytesToHex(this.me.pubkey),
      displayName: this.displayName,
      vouches: vouches.map((v) => v.event),
    };
  }

  private appendMessage(peerPubkey: string, msg: Message): void {
    this.setState((s) => {
      const idx = s.conversations.findIndex((c) => c.peerPubkey === peerPubkey);
      if (idx < 0) {
        return {
          ...s,
          conversations: [
            ...s.conversations,
            { peerPubkey, peerName: peerPubkey.slice(0, 8), messages: [msg] },
          ],
        };
      }
      const next = [...s.conversations];
      next[idx] = { ...next[idx], messages: [...next[idx].messages, msg] };
      return { ...s, conversations: next };
    });
  }

  private async refreshInvites(): Promise<void> {
    const invites = await this.store.listInvites();
    this.setState((s) => ({ ...s, invites }));
  }

  private setState(fn: (s: ClientState) => ClientState): void {
    this.state = fn(this.state);
    for (const l of this.listeners) l(this.state);
  }

  destroy(): void {
    for (const s of this.subs) s.close();
  }
}

// ---------------------------------------------------------------------------
// Static helpers exposed for the URL-fragment redemption path.
// ---------------------------------------------------------------------------

export { decodeInviteToken, describeToken, parseCarrier, publicKeyFromSecret };
export type { InviteTokenDescription };

// Suppress unused imports flagged by linter — these are re-exported.
void sealTextTo;
void openTextFrom;
void Tags;
