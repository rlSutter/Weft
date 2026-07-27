// WeftContext + provider + useWeft hook — the React glue over WeftClient.
//
// The provider owns the client instance and re-renders every subscriber when
// client state changes. Keys are persisted in localStorage (v0 minimum;
// SECURITY.md notes this is a known limitation — passphrase-wrapped storage
// is a v2 IOU).
//
// **Persona-aware as of M11.5.** The provider tracks:
//   - the ROOT secret (32 bytes, in localStorage)
//   - a persona directory (in IdbStore under the `personas` table)
//   - the ACTIVE persona index (in localStorage; defaults to 0 = root)
//
// The WeftClient instance is scoped to the active persona: its Nostr
// keypair is `personaRoot(rootSecret, activePersonaIndex)`. Switching
// personas rebuilds the client with the new derived keypair; the client
// then rehydrates its state from IdbStore filtered by the active index
// (interests especially — see idb-store.ts v3 migration).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  bytesToHex,
  generateKeypair,
  personaRoot,
  publicKeyFromSecret,
  type PersonaRecord,
} from '@weft/core';
import { WeftClient, type ClientState, type WeftClient as ClientType } from './weft-client';
import { IdbStore } from './idb-store';

/** localStorage keys. Bumping any of these keys is a client-facing migration. */
const KEY_ROOT_SECRET_HEX = 'weft:secret:hex';
const KEY_DISPLAY_NAME = 'weft:displayName';
const KEY_ACTIVE_PERSONA_INDEX = 'weft:persona:activeIndex';

/** Persona shown to the user. Root persona = index 0, uses the root displayName. */
export interface ActivePersona {
  index: number;
  label: string;
  /** The derived pubkey — never the root's when active persona is non-zero. */
  pubkeyHex: string;
}

interface WeftContextValue {
  readonly client: ClientType | null;
  readonly state: ClientState | null;
  /** The persona currently in use. `null` before onboarding completes. */
  readonly activePersona: ActivePersona | null;
  /** Legacy alias — mirrors the pre-M11.5 `identity` shape. For root-only
   *  users this IS the root; when a persona is active it's the persona.
   *  Screens written before M11.5 keep working via this alias. */
  readonly identity: { pubkeyHex: string; displayName: string } | null;
  /** All personas known on this device. Root at index 0 is always first. */
  readonly personas: readonly PersonaRecord[];
  /** Complete onboarding: generate + persist a fresh root keypair and displayName. */
  completeOnboarding(displayName: string): void;
  /** Replace the current identity with a redeemed keypair (invite path). */
  adoptRedeemedIdentity(secret: Uint8Array, displayName: string): void;
  /** Create a new persona (index chosen automatically) and switch to it. */
  createPersona(label: string): Promise<void>;
  /** Switch to an existing persona by index. Root = 0. */
  switchPersona(index: number): Promise<void>;
  /** Remove a persona (refuses index 0 — that's the root). */
  removePersona(index: number): Promise<void>;
  /** Wipe all local state and start over. */
  reset(): Promise<void>;
}

const WeftContext = createContext<WeftContextValue | null>(null);

export function WeftProvider({ children }: { children: ReactNode }): JSX.Element {
  const [client, setClient] = useState<ClientType | null>(null);
  const [state, setState] = useState<ClientState | null>(null);
  const [activePersona, setActivePersona] = useState<ActivePersona | null>(null);
  const [personas, setPersonas] = useState<readonly PersonaRecord[]>([]);

  /** Load the persona directory from IdbStore. Seeds a root record if empty. */
  const loadPersonas = useCallback(async (displayName: string): Promise<PersonaRecord[]> => {
    const store = new IdbStore();
    const dir = await store.listPersonas();
    if (dir.length === 0) {
      // First run under M11.5 with an existing v0 root identity → seed index 0.
      const now = Math.floor(Date.now() / 1000);
      const rootRecord: PersonaRecord = { index: 0, label: displayName, createdAt: now };
      await store.putPersona(rootRecord);
      return [rootRecord];
    }
    return dir;
  }, []);

  /** Build a WeftClient for the given persona. */
  const buildClient = useCallback(
    (rootSecret: Uint8Array, index: number, label: string): { client: ClientType; pubkeyHex: string } => {
      const kp = index === 0
        ? { secret: rootSecret, pubkey: publicKeyFromSecret(rootSecret) }
        : personaRoot(rootSecret, index);
      const c = new WeftClient({ me: kp, displayName: label });
      return { client: c, pubkeyHex: bytesToHex(kp.pubkey) };
    },
    [],
  );

  // Bootstrap on mount.
  useEffect(() => {
    const hex = localStorage.getItem(KEY_ROOT_SECRET_HEX);
    const name = localStorage.getItem(KEY_DISPLAY_NAME);
    if (!hex || !name) return;

    const rootSecret = hexToBytes(hex);
    const activeIndexStr = localStorage.getItem(KEY_ACTIVE_PERSONA_INDEX) ?? '0';
    const activeIndex = Math.max(0, parseInt(activeIndexStr, 10) || 0);

    void (async () => {
      const dir = await loadPersonas(name);
      setPersonas(dir);
      const chosen = dir.find((p) => p.index === activeIndex) ?? dir[0]!;
      const { client: c, pubkeyHex } = buildClient(rootSecret, chosen.index, chosen.label);
      setClient(c);
      setActivePersona({ index: chosen.index, label: chosen.label, pubkeyHex });
    })();
  }, [buildClient, loadPersonas]);

  // Subscribe to client state.
  useEffect(() => {
    if (!client) {
      setState(null);
      return;
    }
    return client.subscribeState((s) => setState(s));
  }, [client]);

  const completeOnboarding = useCallback((displayName: string) => {
    const kp = generateKeypair();
    localStorage.setItem(KEY_ROOT_SECRET_HEX, bytesToHex(kp.secret));
    localStorage.setItem(KEY_DISPLAY_NAME, displayName);
    localStorage.setItem(KEY_ACTIVE_PERSONA_INDEX, '0');

    void (async () => {
      const now = Math.floor(Date.now() / 1000);
      const rootRecord: PersonaRecord = { index: 0, label: displayName, createdAt: now };
      const store = new IdbStore();
      await store.putPersona(rootRecord);
      setPersonas([rootRecord]);
      const c = new WeftClient({ me: kp, displayName });
      setClient(c);
      setActivePersona({ index: 0, label: displayName, pubkeyHex: bytesToHex(kp.pubkey) });
    })();
  }, []);

  const adoptRedeemedIdentity = useCallback(
    (secret: Uint8Array, displayName: string) => {
      const pubkey = publicKeyFromSecret(secret);
      localStorage.setItem(KEY_ROOT_SECRET_HEX, bytesToHex(secret));
      localStorage.setItem(KEY_DISPLAY_NAME, displayName);
      localStorage.setItem(KEY_ACTIVE_PERSONA_INDEX, '0');
      if (client) client.destroy();
      void (async () => {
        const now = Math.floor(Date.now() / 1000);
        const rootRecord: PersonaRecord = { index: 0, label: displayName, createdAt: now };
        const store = new IdbStore();
        await store.putPersona(rootRecord);
        setPersonas([rootRecord]);
        const c = new WeftClient({ me: { secret, pubkey }, displayName });
        setClient(c);
        setActivePersona({ index: 0, label: displayName, pubkeyHex: bytesToHex(pubkey) });
      })();
    },
    [client],
  );

  const createPersona = useCallback(
    async (label: string): Promise<void> => {
      const hex = localStorage.getItem(KEY_ROOT_SECRET_HEX);
      if (!hex) throw new Error('createPersona: no root identity yet');
      const rootSecret = hexToBytes(hex);
      const store = new IdbStore();

      // Pick the next unused index (walk from 1 upward; index 0 is root).
      const dir = await store.listPersonas();
      const used = new Set(dir.map((p) => p.index));
      let next = 1;
      while (used.has(next)) next++;

      const now = Math.floor(Date.now() / 1000);
      const record: PersonaRecord = { index: next, label, createdAt: now };
      await store.putPersona(record);
      const updated = [...dir, record].sort((a, b) => a.index - b.index);
      setPersonas(updated);

      // Switch immediately to the new persona.
      localStorage.setItem(KEY_ACTIVE_PERSONA_INDEX, String(next));
      if (client) client.destroy();
      const { client: c, pubkeyHex } = buildClient(rootSecret, next, label);
      setClient(c);
      setActivePersona({ index: next, label, pubkeyHex });
    },
    [buildClient, client],
  );

  const switchPersona = useCallback(
    async (index: number): Promise<void> => {
      const hex = localStorage.getItem(KEY_ROOT_SECRET_HEX);
      if (!hex) throw new Error('switchPersona: no root identity');
      const rootSecret = hexToBytes(hex);
      const record = personas.find((p) => p.index === index);
      if (!record) throw new Error(`switchPersona: no persona at index ${index}`);
      localStorage.setItem(KEY_ACTIVE_PERSONA_INDEX, String(index));
      if (client) client.destroy();
      const { client: c, pubkeyHex } = buildClient(rootSecret, index, record.label);
      setClient(c);
      setActivePersona({ index, label: record.label, pubkeyHex });
    },
    [buildClient, client, personas],
  );

  const removePersona = useCallback(
    async (index: number): Promise<void> => {
      if (index === 0) throw new Error('cannot remove the root persona (index 0)');
      const store = new IdbStore();
      await store.deletePersona(index);
      const updated = personas.filter((p) => p.index !== index);
      setPersonas(updated);
      // If we removed the active persona, switch back to root.
      if (activePersona?.index === index) {
        await switchPersona(0);
      }
    },
    [activePersona, personas, switchPersona],
  );

  const reset = useCallback(async () => {
    if (client) {
      try {
        await client.store.clear();
      } catch {
        // Best-effort.
      }
      client.destroy();
    }
    localStorage.removeItem(KEY_ROOT_SECRET_HEX);
    localStorage.removeItem(KEY_DISPLAY_NAME);
    localStorage.removeItem(KEY_ACTIVE_PERSONA_INDEX);
    setClient(null);
    setActivePersona(null);
    setPersonas([]);
    setState(null);
  }, [client]);

  const identity = activePersona
    ? { pubkeyHex: activePersona.pubkeyHex, displayName: activePersona.label }
    : null;

  const value = useMemo(
    () => ({
      client,
      state,
      activePersona,
      identity,
      personas,
      completeOnboarding,
      adoptRedeemedIdentity,
      createPersona,
      switchPersona,
      removePersona,
      reset,
    }),
    [
      client,
      state,
      activePersona,
      identity,
      personas,
      completeOnboarding,
      adoptRedeemedIdentity,
      createPersona,
      switchPersona,
      removePersona,
      reset,
    ],
  );

  return <WeftContext.Provider value={value}>{children}</WeftContext.Provider>;
}

export function useWeft(): WeftContextValue {
  const ctx = useContext(WeftContext);
  if (!ctx) throw new Error('useWeft must be used inside WeftProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Backward-compat alias — some legacy screens read `identity` from the context.
// The alias mirrors the pre-M11.5 shape so those screens keep working, but
// now returns the ACTIVE persona (which for a root-only user IS the root).
// ---------------------------------------------------------------------------

/** Legacy shape some screens read. Prefer `activePersona` in new code. */
export function useIdentity(): { pubkeyHex: string; displayName: string } | null {
  const { activePersona } = useWeft();
  if (!activePersona) return null;
  return { pubkeyHex: activePersona.pubkeyHex, displayName: activePersona.label };
}

// ---------------------------------------------------------------------------
// Router — unchanged from pre-M11.5 except for the new `settings` route.
// ---------------------------------------------------------------------------

export type Route =
  | { name: 'home' }
  | { name: 'ask' }
  | { name: 'invite' }
  | { name: 'why' }
  | { name: 'about' }
  | { name: 'settings' }
  | { name: 'match'; queryId: string }
  | { name: 'chat'; peerPubkey: string }
  | { name: 'redeem'; token: string };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h === '' || h === '/') return { name: 'home' };
  if (h === 'ask') return { name: 'ask' };
  if (h === 'invite') return { name: 'invite' };
  if (h === 'why') return { name: 'why' };
  if (h === 'about') return { name: 'about' };
  if (h === 'settings') return { name: 'settings' };
  if (h.startsWith('match/')) return { name: 'match', queryId: h.slice(6) };
  if (h.startsWith('chat/')) return { name: 'chat', peerPubkey: h.slice(5) };
  if (h.startsWith('i/')) return { name: 'redeem', token: h.slice(2) };
  return { name: 'home' };
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((r: Route) => {
    const h = routeToHash(r);
    if (window.location.hash === h) {
      setRoute(r);
    } else {
      window.location.hash = h;
    }
  }, []);
  return [route, navigate];
}

function routeToHash(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'ask': return '#ask';
    case 'invite': return '#invite';
    case 'why': return '#why';
    case 'about': return '#about';
    case 'settings': return '#settings';
    case 'match': return `#match/${r.queryId}`;
    case 'chat': return `#chat/${r.peerPubkey}`;
    case 'redeem': return `#i/${r.token}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
