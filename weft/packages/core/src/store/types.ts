// WeftStore — the client-side database (DD §9.2).
//
// Design invariant: persistence is inversely proportional to sensitivity.
// Vouches are durable-but-private (cached by subject); handshake state is
// hours-scale; the routing sketch is lossy by design (per-contact centroid
// EMA, never a log of who answered what).
//
// Sources of law:
//   DD §9.2         three stores, opposite requirements
//   DD §35 F2       reverseRoutes are keyed by *my* route token, never queryId
//   DD §35 F12      schema_version migrations (see migrations.ts)
//   Build list M3-T1 typed tables + shared conformance suite
//   OBSERVABILITY.md never log per-contact ranking or vouch issuer↔subject

import type { NostrEvent } from 'nostr-tools/pure';

// ---------------------------------------------------------------------------
// Table row types
// ---------------------------------------------------------------------------

export interface Contact {
  readonly pubkey: string;
  readonly displayName: string;
  readonly relayHints: readonly string[];
  readonly addedAt: number; // unix seconds
}

/**
 * A cached vouch attestation (kind 4902) — always private, held by the
 * subject. Never republished; presented inside match tokens / reveals.
 * DD §35 F1 (Gate 3).
 */
export interface CachedVouch {
  /** The subject's pubkey (this device's user, in the common case). */
  readonly subject: string;
  /** The voucher's pubkey. */
  readonly issuer: string;
  /** The signed 4902 event, verbatim. */
  readonly event: NostrEvent;
  /** Vouch expiry, unix seconds — when the attestation stops being valid. */
  readonly expiresAt: number;
  /** SHA-256 of the event id in hex — used for 4903 void references. */
  readonly attestationHash: string;
}

/**
 * Per-contact postage balance. Positive means "they can send us more"; going
 * below zero causes silent drop (DD §6 postage economy).
 */
export interface StampRow {
  readonly contact: string;
  readonly balance: number;
}

/** In-flight ask (this device authored) or forwarded route we're tracking. */
export interface QueryState {
  readonly queryId: string;
  readonly ephemeralSecretHex: string; // hex-encoded 32-byte secret
  readonly ttlAtSend: number;
  readonly expiresAt: number; // unix seconds
}

/**
 * Reverse route entry — keyed by the token WE minted for the downstream
 * neighbor. When a reply arrives with `rt = myRouteToken`, relabel to
 * `upstreamRouteToken` and forward to `cameFromPubkey`. See DD §35 F2.
 */
export interface ReverseRoute {
  readonly myRouteToken: string; // hex
  readonly upstreamRouteToken: string; // hex — what we tell the reply to carry
  readonly cameFromPubkey: string; // where the reply should be sent
  readonly expiresAt: number; // unix seconds
}

/**
 * Local ledger row for an invite the user has issued. Used to enforce
 * single-use (DD §30.3 step 5 "first redemption wins") and to power the
 * "Invites out" list in UX §14.
 */
export interface OutgoingInvite {
  readonly iid: string; // hex — invite id
  readonly tokenStr: string; // base64url encoded token (opaque blob for UI)
  readonly sentTo: string; // human label the inviter typed ("Bob T.")
  readonly status: 'sent' | 'awaitingConfirm' | 'confirmed' | 'voided';
  readonly redeemerPubkey?: string; // set once we receive a 4918
  readonly redeemerName?: string; // display name from the 4918
  readonly createdAt: number;
}

// ---------------------------------------------------------------------------
// Query interfaces
// ---------------------------------------------------------------------------

export interface EventQuery {
  readonly kinds?: readonly number[];
  /** Filter tags: `{ p: ['pub...'] }` matches events with `p` tag `pub...`. */
  readonly tags?: Readonly<Record<string, readonly string[]>>;
  /** Include events with created_at >= since. */
  readonly since?: number;
  /** Limit result count (most-recent first). */
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// The store interface
// ---------------------------------------------------------------------------

export interface WeftStore {
  /** Schema version this adapter reads/writes. Used by migrations (DD §35 F12). */
  readonly schemaVersion: number;

  // --- events ---
  putEvent(evt: NostrEvent): Promise<void>;
  getEvent(id: string): Promise<NostrEvent | undefined>;
  queryEvents(q: EventQuery): Promise<NostrEvent[]>;
  deleteEvent(id: string): Promise<void>;

  // --- contacts ---
  upsertContact(c: Contact): Promise<void>;
  getContact(pubkey: string): Promise<Contact | undefined>;
  listContacts(): Promise<Contact[]>;
  removeContact(pubkey: string): Promise<void>;

  // --- vouches (private, cached by subject) ---
  putVouch(v: CachedVouch): Promise<void>;
  getVouchesForSubject(subject: string): Promise<CachedVouch[]>;
  getMyVouches(): Promise<CachedVouch[]>; // vouches held by *this device's user*
  removeVouch(attestationHash: string): Promise<void>;

  // --- stamp ledger ---
  getStamp(contact: string): Promise<number>;
  adjustStamp(contact: string, delta: number): Promise<number>;
  setStamp(contact: string, balance: number): Promise<void>;

  // --- query state ---
  putQueryState(s: QueryState): Promise<void>;
  getQueryState(queryId: string): Promise<QueryState | undefined>;
  listExpiredQueryStates(now: number): Promise<QueryState[]>;
  deleteQueryState(queryId: string): Promise<void>;

  // --- reverse routes ---
  putReverseRoute(r: ReverseRoute): Promise<void>;
  getReverseRoute(myRouteToken: string): Promise<ReverseRoute | undefined>;
  listExpiredReverseRoutes(now: number): Promise<ReverseRoute[]>;
  deleteReverseRoute(myRouteToken: string): Promise<void>;

  // --- invite ledger (M5-T2, DD §30.3) ---
  putInvite(inv: OutgoingInvite): Promise<void>;
  getInvite(iid: string): Promise<OutgoingInvite | undefined>;
  listInvites(): Promise<OutgoingInvite[]>;
  updateInviteStatus(
    iid: string,
    status: OutgoingInvite['status'],
    patch?: Partial<Pick<OutgoingInvite, 'redeemerPubkey' | 'redeemerName'>>,
  ): Promise<OutgoingInvite | undefined>;

  // --- reaper (M3-T2) ---
  /**
   * Actively delete expired query state, reverse routes, and cached events
   * whose `expiration` tag is past. Returns per-table counts of items
   * removed — this metric is a device-local health signal for the reaper
   * itself, not part of the OBSERVABILITY.md counter set.
   */
  expireSweep(now: number): Promise<ReaperResult>;

  // --- backup / restore (M6 uses this) ---
  clear(): Promise<void>;

  // --- lifecycle ---
  close?(): Promise<void>;
}

export interface ReaperResult {
  readonly events: number;
  readonly queryStates: number;
  readonly reverseRoutes: number;
}

// Latest schema version this codebase writes.
export const CURRENT_SCHEMA_VERSION = 1;
