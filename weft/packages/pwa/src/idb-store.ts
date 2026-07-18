// IndexedDB-backed WeftStore for the PWA. Matches the semantics of
// MemoryStore (the shared conformance suite covers both — build-list M3-T1).

import { openDB, type IDBPDatabase } from 'idb';
import type { NostrEvent } from '@weft/core';
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
} from '@weft/core';

const DB_NAME = 'weft';
const DB_VERSION = 1;

type Tables = {
  events: NostrEvent;
  contacts: Contact;
  vouches: CachedVouch;
  stamps: { contact: string; balance: number };
  queryStates: QueryState;
  reverseRoutes: ReverseRoute;
  invites: OutgoingInvite;
  meta: { key: string; value: unknown };
};

let db: IDBPDatabase | undefined;
async function getDb(): Promise<IDBPDatabase> {
  if (db) return db;
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, _old, _next) {
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('contacts'))
        db.createObjectStore('contacts', { keyPath: 'pubkey' });
      if (!db.objectStoreNames.contains('vouches'))
        db.createObjectStore('vouches', { keyPath: 'attestationHash' });
      if (!db.objectStoreNames.contains('stamps'))
        db.createObjectStore('stamps', { keyPath: 'contact' });
      if (!db.objectStoreNames.contains('queryStates'))
        db.createObjectStore('queryStates', { keyPath: 'queryId' });
      if (!db.objectStoreNames.contains('reverseRoutes'))
        db.createObjectStore('reverseRoutes', { keyPath: 'myRouteToken' });
      if (!db.objectStoreNames.contains('invites'))
        db.createObjectStore('invites', { keyPath: 'iid' });
      if (!db.objectStoreNames.contains('meta'))
        db.createObjectStore('meta', { keyPath: 'key' });
    },
  });
  return db;
}

export class IdbStore implements WeftStore {
  readonly schemaVersion = CURRENT_SCHEMA_VERSION;

  private userPubkey?: string;
  setUserPubkey(pk: string): void {
    this.userPubkey = pk;
  }

  async putEvent(evt: NostrEvent): Promise<void> {
    (await getDb()).put('events', evt);
  }
  async getEvent(id: string): Promise<NostrEvent | undefined> {
    return (await getDb()).get('events', id);
  }
  async queryEvents(q: EventQuery): Promise<NostrEvent[]> {
    const all: NostrEvent[] = await (await getDb()).getAll('events');
    let out = all;
    if (q.kinds) out = out.filter((e) => q.kinds!.includes(e.kind));
    if (q.since !== undefined) out = out.filter((e) => e.created_at >= q.since!);
    if (q.tags) {
      out = out.filter((e) => {
        for (const [name, wantValues] of Object.entries(q.tags!)) {
          const eventValues = e.tags.filter((t) => t[0] === name).map((t) => t[1]);
          if (!wantValues.some((v) => eventValues.includes(v))) return false;
        }
        return true;
      });
    }
    out.sort((a, b) => b.created_at - a.created_at);
    if (q.limit !== undefined) out = out.slice(0, q.limit);
    return out;
  }
  async deleteEvent(id: string): Promise<void> {
    (await getDb()).delete('events', id);
  }

  async upsertContact(c: Contact): Promise<void> {
    (await getDb()).put('contacts', c);
  }
  async getContact(pubkey: string): Promise<Contact | undefined> {
    return (await getDb()).get('contacts', pubkey);
  }
  async listContacts(): Promise<Contact[]> {
    return (await getDb()).getAll('contacts');
  }
  async removeContact(pubkey: string): Promise<void> {
    (await getDb()).delete('contacts', pubkey);
  }

  async putVouch(v: CachedVouch): Promise<void> {
    (await getDb()).put('vouches', v);
  }
  async getVouchesForSubject(subject: string): Promise<CachedVouch[]> {
    const all: CachedVouch[] = await (await getDb()).getAll('vouches');
    return all.filter((v) => v.subject === subject);
  }
  async getMyVouches(): Promise<CachedVouch[]> {
    if (!this.userPubkey) return [];
    return this.getVouchesForSubject(this.userPubkey);
  }
  async removeVouch(attestationHash: string): Promise<void> {
    (await getDb()).delete('vouches', attestationHash);
  }

  async getStamp(contact: string): Promise<number> {
    const row: Tables['stamps'] | undefined = await (await getDb()).get('stamps', contact);
    return row?.balance ?? 0;
  }
  async adjustStamp(contact: string, delta: number): Promise<number> {
    const next = (await this.getStamp(contact)) + delta;
    (await getDb()).put('stamps', { contact, balance: next });
    return next;
  }
  async setStamp(contact: string, balance: number): Promise<void> {
    (await getDb()).put('stamps', { contact, balance });
  }

  async putQueryState(s: QueryState): Promise<void> {
    (await getDb()).put('queryStates', s);
  }
  async getQueryState(queryId: string): Promise<QueryState | undefined> {
    return (await getDb()).get('queryStates', queryId);
  }
  async listExpiredQueryStates(now: number): Promise<QueryState[]> {
    const all: QueryState[] = await (await getDb()).getAll('queryStates');
    return all.filter((s) => s.expiresAt <= now);
  }
  async deleteQueryState(queryId: string): Promise<void> {
    (await getDb()).delete('queryStates', queryId);
  }

  async putReverseRoute(r: ReverseRoute): Promise<void> {
    (await getDb()).put('reverseRoutes', r);
  }
  async getReverseRoute(myRouteToken: string): Promise<ReverseRoute | undefined> {
    return (await getDb()).get('reverseRoutes', myRouteToken);
  }
  async listExpiredReverseRoutes(now: number): Promise<ReverseRoute[]> {
    const all: ReverseRoute[] = await (await getDb()).getAll('reverseRoutes');
    return all.filter((r) => r.expiresAt <= now);
  }
  async deleteReverseRoute(myRouteToken: string): Promise<void> {
    (await getDb()).delete('reverseRoutes', myRouteToken);
  }

  async putInvite(inv: OutgoingInvite): Promise<void> {
    (await getDb()).put('invites', inv);
  }
  async getInvite(iid: string): Promise<OutgoingInvite | undefined> {
    return (await getDb()).get('invites', iid);
  }
  async listInvites(): Promise<OutgoingInvite[]> {
    return (await getDb()).getAll('invites');
  }
  async updateInviteStatus(
    iid: string,
    status: OutgoingInvite['status'],
    patch: Partial<Pick<OutgoingInvite, 'redeemerPubkey' | 'redeemerName'>> = {},
  ): Promise<OutgoingInvite | undefined> {
    const cur = await this.getInvite(iid);
    if (!cur) return undefined;
    const next: OutgoingInvite = { ...cur, ...patch, status };
    await this.putInvite(next);
    return next;
  }

  async expireSweep(now: number): Promise<ReaperResult> {
    const qs = await this.listExpiredQueryStates(now);
    for (const s of qs) await this.deleteQueryState(s.queryId);
    const rr = await this.listExpiredReverseRoutes(now);
    for (const r of rr) await this.deleteReverseRoute(r.myRouteToken);
    let events = 0;
    const all: NostrEvent[] = await (await getDb()).getAll('events');
    for (const e of all) {
      const expTag = e.tags.find((t) => t[0] === 'expiration');
      if (expTag && Number(expTag[1]) <= now) {
        await this.deleteEvent(e.id);
        events++;
      }
    }
    return { events, queryStates: qs.length, reverseRoutes: rr.length };
  }

  async clear(): Promise<void> {
    const d = await getDb();
    for (const store of ['events', 'contacts', 'vouches', 'stamps', 'queryStates', 'reverseRoutes', 'invites', 'meta']) {
      await d.clear(store);
    }
  }
}
