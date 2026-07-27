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
  type StoredMessage,
  type WeftStore,
} from '@weft/core';

const DB_NAME = 'weft';
// v3 adds `personas` store and scopes `interests` per persona
// (composite key `${personaIndex}:${text}`). v2→v3 migration re-keys
// any existing interest records under persona 0 (the root) so pre-M11.5
// users' interests survive.
const DB_VERSION = 3;

type Tables = {
  events: NostrEvent;
  contacts: Contact;
  vouches: CachedVouch;
  stamps: { contact: string; balance: number };
  queryStates: QueryState;
  reverseRoutes: ReverseRoute;
  invites: OutgoingInvite;
  /** Composite key = `${personaIndex}:${text}`. Persona 0 = root. */
  interests: { key: string; personaIndex: number; text: string };
  messages: StoredMessage;
  personas: { index: number; label: string; createdAt: number };
  meta: { key: string; value: unknown };
};

/** Encode the composite key for a persona-scoped interest. */
function interestKey(personaIndex: number, text: string): string {
  return `${personaIndex}:${text}`;
}

let db: IDBPDatabase | undefined;
async function getDb(): Promise<IDBPDatabase> {
  if (db) return db;
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _next, transaction) {
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
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id' });
        store.createIndex('peerPubkey', 'peerPubkey', { unique: false });
      }
      // v3 additions (M11.5).
      if (!db.objectStoreNames.contains('personas')) {
        db.createObjectStore('personas', { keyPath: 'index' });
      }

      // v2→v3 interest migration: the pre-M11.5 `interests` store was keyed
      // by `text` and had shape `{text}`. v3 uses composite key
      // `${personaIndex}:${text}` and shape `{key, personaIndex, text}`.
      // Re-key any existing records under persona 0.
      if (db.objectStoreNames.contains('interests') && oldVersion < 3) {
        // Read pre-migration records, wipe the store, replace with v3 shape.
        const oldStore = transaction.objectStore('interests');
        void oldStore.getAll().then((rows: Array<{ text: string }>) => {
          db.deleteObjectStore('interests');
          const newStore = db.createObjectStore('interests', { keyPath: 'key' });
          for (const r of rows) {
            if (typeof r?.text === 'string') {
              newStore.put({
                key: interestKey(0, r.text),
                personaIndex: 0,
                text: r.text,
              });
            }
          }
        });
      } else if (!db.objectStoreNames.contains('interests')) {
        db.createObjectStore('interests', { keyPath: 'key' });
      }
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

  // --- interests (persona-scoped as of M11.5) ---
  async listInterests(personaIndex: number = 0): Promise<string[]> {
    const all: Tables['interests'][] = await (await getDb()).getAll('interests');
    return all.filter((r) => r.personaIndex === personaIndex).map((r) => r.text);
  }
  async addInterest(text: string, personaIndex: number = 0): Promise<void> {
    (await getDb()).put('interests', {
      key: interestKey(personaIndex, text),
      personaIndex,
      text,
    });
  }
  async removeInterest(text: string, personaIndex: number = 0): Promise<void> {
    (await getDb()).delete('interests', interestKey(personaIndex, text));
  }
  async listInterestsAcrossPersonas(): Promise<Array<{ personaIndex: number; text: string }>> {
    const all: Tables['interests'][] = await (await getDb()).getAll('interests');
    return all.map((r) => ({ personaIndex: r.personaIndex, text: r.text }));
  }

  // --- persona directory (M11.5) ---
  async listPersonas(): Promise<Array<{ index: number; label: string; createdAt: number }>> {
    const all: Tables['personas'][] = await (await getDb()).getAll('personas');
    return all.sort((a, b) => a.index - b.index);
  }
  async putPersona(record: { index: number; label: string; createdAt: number }): Promise<void> {
    await (await getDb()).put('personas', record);
  }
  async deletePersona(index: number): Promise<void> {
    if (index === 0) throw new Error('cannot delete the root persona (index 0)');
    const d = await getDb();
    await d.delete('personas', index);
    // Also delete this persona's interests.
    const all: Tables['interests'][] = await d.getAll('interests');
    const tx = d.transaction('interests', 'readwrite');
    for (const r of all) {
      if (r.personaIndex === index) await tx.store.delete(r.key);
    }
    await tx.done;
  }

  // --- messages ---
  async appendMessage(msg: StoredMessage): Promise<void> {
    (await getDb()).put('messages', msg);
  }
  async listMessagesForPeer(peerPubkey: string): Promise<StoredMessage[]> {
    const d = await getDb();
    const idx = d.transaction('messages').store.index('peerPubkey');
    const list: StoredMessage[] = await idx.getAll(peerPubkey);
    list.sort((a, b) => a.at - b.at);
    return list;
  }
  async listConversationPeers(): Promise<string[]> {
    const all: StoredMessage[] = await (await getDb()).getAll('messages');
    const set = new Set<string>();
    for (const m of all) set.add(m.peerPubkey);
    return [...set];
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
    for (const store of [
      'events',
      'contacts',
      'vouches',
      'stamps',
      'queryStates',
      'reverseRoutes',
      'invites',
      'interests',
      'messages',
      'meta',
    ]) {
      await d.clear(store);
    }
  }
}
