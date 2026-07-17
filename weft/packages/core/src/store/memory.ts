// In-memory reference implementation of WeftStore.
//
// Purpose: use in tests, in the sim, and as the semantics contract that
// IdbStore (M3, pwa/) must match — the same conformance suite runs against
// both (build-list M3-T1).

import type { NostrEvent } from 'nostr-tools/pure';

import { Tags } from '../kinds/tags';
import {
  CURRENT_SCHEMA_VERSION,
  type CachedVouch,
  type Contact,
  type EventQuery,
  type OutgoingInvite,
  type QueryState,
  type ReaperResult,
  type ReverseRoute,
  type WeftStore,
} from './types';

interface MemoryStoreOptions {
  /** The user pubkey that owns *this* device. Vouches whose subject matches
   *  are considered "my vouches" (getMyVouches). */
  readonly userPubkey?: string;
}

export class MemoryStore implements WeftStore {
  readonly schemaVersion = CURRENT_SCHEMA_VERSION;

  private readonly events = new Map<string, NostrEvent>();
  private readonly contacts = new Map<string, Contact>();
  private readonly vouchesByHash = new Map<string, CachedVouch>();
  private readonly stamps = new Map<string, number>();
  private readonly queryStates = new Map<string, QueryState>();
  private readonly reverseRoutes = new Map<string, ReverseRoute>();
  private readonly invites = new Map<string, OutgoingInvite>();
  private userPubkey: string | undefined;

  constructor(opts: MemoryStoreOptions = {}) {
    this.userPubkey = opts.userPubkey;
  }

  setUserPubkey(pk: string): void {
    this.userPubkey = pk;
  }

  // --- events ---
  async putEvent(evt: NostrEvent): Promise<void> {
    this.events.set(evt.id, evt);
  }
  async getEvent(id: string): Promise<NostrEvent | undefined> {
    return this.events.get(id);
  }
  async queryEvents(q: EventQuery): Promise<NostrEvent[]> {
    let out: NostrEvent[] = [];
    for (const e of this.events.values()) {
      if (q.kinds && !q.kinds.includes(e.kind)) continue;
      if (q.since !== undefined && e.created_at < q.since) continue;
      if (q.tags) {
        let ok = true;
        for (const [name, wantValues] of Object.entries(q.tags)) {
          const eventValues = e.tags.filter((t) => t[0] === name).map((t) => t[1]);
          if (!wantValues.some((v) => eventValues.includes(v))) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      out.push(e);
    }
    out.sort((a, b) => b.created_at - a.created_at);
    if (q.limit !== undefined) out = out.slice(0, q.limit);
    return out;
  }
  async deleteEvent(id: string): Promise<void> {
    this.events.delete(id);
  }

  // --- contacts ---
  async upsertContact(c: Contact): Promise<void> {
    this.contacts.set(c.pubkey, c);
  }
  async getContact(pubkey: string): Promise<Contact | undefined> {
    return this.contacts.get(pubkey);
  }
  async listContacts(): Promise<Contact[]> {
    return [...this.contacts.values()];
  }
  async removeContact(pubkey: string): Promise<void> {
    this.contacts.delete(pubkey);
  }

  // --- vouches ---
  async putVouch(v: CachedVouch): Promise<void> {
    this.vouchesByHash.set(v.attestationHash, v);
  }
  async getVouchesForSubject(subject: string): Promise<CachedVouch[]> {
    return [...this.vouchesByHash.values()].filter((v) => v.subject === subject);
  }
  async getMyVouches(): Promise<CachedVouch[]> {
    if (this.userPubkey === undefined) return [];
    const me = this.userPubkey;
    return [...this.vouchesByHash.values()].filter((v) => v.subject === me);
  }
  async removeVouch(attestationHash: string): Promise<void> {
    this.vouchesByHash.delete(attestationHash);
  }

  // --- stamps ---
  async getStamp(contact: string): Promise<number> {
    return this.stamps.get(contact) ?? 0;
  }
  async adjustStamp(contact: string, delta: number): Promise<number> {
    const next = (this.stamps.get(contact) ?? 0) + delta;
    this.stamps.set(contact, next);
    return next;
  }
  async setStamp(contact: string, balance: number): Promise<void> {
    this.stamps.set(contact, balance);
  }

  // --- query state ---
  async putQueryState(s: QueryState): Promise<void> {
    this.queryStates.set(s.queryId, s);
  }
  async getQueryState(queryId: string): Promise<QueryState | undefined> {
    return this.queryStates.get(queryId);
  }
  async listExpiredQueryStates(now: number): Promise<QueryState[]> {
    return [...this.queryStates.values()].filter((s) => s.expiresAt <= now);
  }
  async deleteQueryState(queryId: string): Promise<void> {
    this.queryStates.delete(queryId);
  }

  // --- reverse routes ---
  async putReverseRoute(r: ReverseRoute): Promise<void> {
    this.reverseRoutes.set(r.myRouteToken, r);
  }
  async getReverseRoute(myRouteToken: string): Promise<ReverseRoute | undefined> {
    return this.reverseRoutes.get(myRouteToken);
  }
  async listExpiredReverseRoutes(now: number): Promise<ReverseRoute[]> {
    return [...this.reverseRoutes.values()].filter((r) => r.expiresAt <= now);
  }
  async deleteReverseRoute(myRouteToken: string): Promise<void> {
    this.reverseRoutes.delete(myRouteToken);
  }

  // --- invites ---
  async putInvite(inv: OutgoingInvite): Promise<void> {
    this.invites.set(inv.iid, inv);
  }
  async getInvite(iid: string): Promise<OutgoingInvite | undefined> {
    return this.invites.get(iid);
  }
  async listInvites(): Promise<OutgoingInvite[]> {
    return [...this.invites.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async updateInviteStatus(
    iid: string,
    status: OutgoingInvite['status'],
    patch: Partial<Pick<OutgoingInvite, 'redeemerPubkey' | 'redeemerName'>> = {},
  ): Promise<OutgoingInvite | undefined> {
    const cur = this.invites.get(iid);
    if (!cur) return undefined;
    const next: OutgoingInvite = { ...cur, ...patch, status };
    this.invites.set(iid, next);
    return next;
  }

  // --- reaper ---
  async expireSweep(now: number): Promise<ReaperResult> {
    // Query states + reverse routes: expiresAt <= now.
    const qs = await this.listExpiredQueryStates(now);
    for (const s of qs) this.queryStates.delete(s.queryId);
    const rr = await this.listExpiredReverseRoutes(now);
    for (const r of rr) this.reverseRoutes.delete(r.myRouteToken);
    // Events: expiration tag <= now (NIP-40).
    let eventCount = 0;
    for (const [id, e] of this.events) {
      const expTag = e.tags.find((t) => t[0] === Tags.EXPIRATION);
      if (expTag && Number(expTag[1]) <= now) {
        this.events.delete(id);
        eventCount++;
      }
    }
    return { events: eventCount, queryStates: qs.length, reverseRoutes: rr.length };
  }

  // --- lifecycle ---
  async clear(): Promise<void> {
    this.events.clear();
    this.contacts.clear();
    this.vouchesByHash.clear();
    this.stamps.clear();
    this.queryStates.clear();
    this.reverseRoutes.clear();
    this.invites.clear();
  }
}
