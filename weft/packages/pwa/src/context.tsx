// WeftContext + provider + useWeft hook — the React glue over WeftClient.
//
// The provider owns the client instance and re-renders every subscriber when
// client state changes. Keys are persisted in localStorage (v0 minimum;
// SECURITY.md notes this is a known limitation — passphrase-wrapped storage
// is a v2 IOU).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { bytesToHex, generateKeypair, publicKeyFromSecret } from '@weft/core';
import { WeftClient, type ClientState, type WeftClient as ClientType } from './weft-client';

const KEY_SECRET_HEX = 'weft:secret:hex';
const KEY_DISPLAY_NAME = 'weft:displayName';

interface WeftContextValue {
  readonly client: ClientType | null;
  readonly state: ClientState | null;
  readonly identity: { pubkeyHex: string; displayName: string } | null;
  /** Complete onboarding: generate + persist a fresh keypair and display name. */
  completeOnboarding(displayName: string): void;
  /** Replace the current identity with a redeemed keypair (invite path). */
  adoptRedeemedIdentity(secret: Uint8Array, displayName: string): void;
  /** Wipe all local state and start over. */
  reset(): void;
}

const WeftContext = createContext<WeftContextValue | null>(null);

export function WeftProvider({ children }: { children: ReactNode }): JSX.Element {
  const [client, setClient] = useState<ClientType | null>(null);
  const [state, setState] = useState<ClientState | null>(null);
  const [identity, setIdentity] = useState<{ pubkeyHex: string; displayName: string } | null>(null);

  // Bootstrap on mount.
  useEffect(() => {
    const hex = localStorage.getItem(KEY_SECRET_HEX);
    const name = localStorage.getItem(KEY_DISPLAY_NAME);
    if (hex && name) {
      const secret = hexToBytes(hex);
      const pubkey = publicKeyFromSecret(secret);
      const c = new WeftClient({ me: { secret, pubkey }, displayName: name });
      setClient(c);
      setIdentity({ pubkeyHex: bytesToHex(pubkey), displayName: name });
    }
  }, []);

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
    localStorage.setItem(KEY_SECRET_HEX, bytesToHex(kp.secret));
    localStorage.setItem(KEY_DISPLAY_NAME, displayName);
    const c = new WeftClient({ me: kp, displayName });
    setClient(c);
    setIdentity({ pubkeyHex: bytesToHex(kp.pubkey), displayName });
  }, []);

  const adoptRedeemedIdentity = useCallback((secret: Uint8Array, displayName: string) => {
    const pubkey = publicKeyFromSecret(secret);
    localStorage.setItem(KEY_SECRET_HEX, bytesToHex(secret));
    localStorage.setItem(KEY_DISPLAY_NAME, displayName);
    // Tear down old client if any.
    if (client) client.destroy();
    const c = new WeftClient({ me: { secret, pubkey }, displayName });
    setClient(c);
    setIdentity({ pubkeyHex: bytesToHex(pubkey), displayName });
  }, [client]);

  const reset = useCallback(() => {
    localStorage.removeItem(KEY_SECRET_HEX);
    localStorage.removeItem(KEY_DISPLAY_NAME);
    if (client) client.destroy();
    setClient(null);
    setIdentity(null);
    setState(null);
  }, [client]);

  const value = useMemo(
    () => ({ client, state, identity, completeOnboarding, adoptRedeemedIdentity, reset }),
    [client, state, identity, completeOnboarding, adoptRedeemedIdentity, reset],
  );

  return <WeftContext.Provider value={value}>{children}</WeftContext.Provider>;
}

export function useWeft(): WeftContextValue {
  const ctx = useContext(WeftContext);
  if (!ctx) throw new Error('useWeft must be used inside WeftProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Simple hash-based router. Weft URLs are all fragment-based so the tokens
// in `#/i/<token>` never reach a server.
// ---------------------------------------------------------------------------

export type Route =
  | { name: 'home' }
  | { name: 'ask' }
  | { name: 'invite' }
  | { name: 'why' }
  | { name: 'about' }
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
  if (h.startsWith('match/')) return { name: 'match', queryId: h.slice(6) };
  if (h.startsWith('chat/')) return { name: 'chat', peerPubkey: h.slice(5) };
  if (h.startsWith('i/')) return { name: 'redeem', token: h.slice(2) };
  return { name: 'home' };
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((r: Route) => {
    const h = routeToHash(r);
    if (window.location.hash === h) {
      setRoute(r); // force re-render if already on this hash
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
