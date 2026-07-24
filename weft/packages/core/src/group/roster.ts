// Group membership roster — the encrypted list of scope_nyms currently in
// the cell. DD §36.2 calls it "a 4920-class record, never public": same
// message primitive as regular group messages, distinguished by an inner
// type tag rather than a separate kind.
//
// The roster IS the source of truth for who's in:
//   - stewards consult it when verifying a new join (scope_nym collision =
//     already-present or previously-ejected → reject)
//   - the group re-serializes it after every join / ejection
//   - it never touches a relay in plaintext (Gate 3 extended to groups,
//     M13-T2)
//
// Sources of law:
//   DD §36.2   membership roster is a group-key-encrypted 4920-class record
//   DD §36.2   ejection is deterministic per scope_nym — roster tracks both
//              active and previously-ejected nyms so a rejoin fails
//   Build list M10-T1

import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { openWithGroupKey, sealWithGroupKey } from './group-crypto';

/** Bumped whenever the roster wire schema changes. */
export const ROSTER_WIRE_VERSION = 1;

/** A member's stable pseudonym in this cell (32 bytes; DD §36.1 scope_nym). */
export type ScopeNym = Uint8Array;

/**
 * Roster state — active members and the graveyard of ejected pseudonyms.
 * The set structure is exposed via hex conversion to keep byte-equality
 * comparisons cheap (JavaScript's Uint8Array equality is by reference).
 */
export interface Roster {
  /** hex → ScopeNym; active membership set. */
  readonly active: Map<string, ScopeNym>;
  /** hex → ScopeNym; previously ejected, permanently blocked. */
  readonly ejected: Map<string, ScopeNym>;
}

/** Build an empty roster (used by a genesis charter before any join). */
export function emptyRoster(): Roster {
  return { active: new Map(), ejected: new Map() };
}

/**
 * Add `nym` to the active set. Throws if the nym is already active or
 * previously ejected — the caller (M10-T2 join flow) uses this to reject
 * scope_nym collisions before issuing a 4933 grant.
 */
export function addMember(roster: Roster, nym: ScopeNym): Roster {
  const hex = bytesToHex(nym);
  if (roster.active.has(hex)) {
    throw new Error(`scope_nym already active: ${hex.slice(0, 12)}…`);
  }
  if (roster.ejected.has(hex)) {
    throw new Error(`scope_nym previously ejected — cannot rejoin: ${hex.slice(0, 12)}…`);
  }
  const active = new Map(roster.active);
  active.set(hex, nym);
  return { active, ejected: roster.ejected };
}

/**
 * Move `nym` from active → ejected. Throws if not currently active
 * (ejecting an ejected nym is a no-op error; ejecting a stranger is a bug
 * that should surface, not be swallowed).
 */
export function ejectMember(roster: Roster, nym: ScopeNym): Roster {
  const hex = bytesToHex(nym);
  if (!roster.active.has(hex)) {
    throw new Error(`cannot eject: scope_nym not active (${hex.slice(0, 12)}…)`);
  }
  const active = new Map(roster.active);
  active.delete(hex);
  const ejected = new Map(roster.ejected);
  ejected.set(hex, nym);
  return { active, ejected };
}

/** True iff `nym` is currently in the active membership set. */
export function isMember(roster: Roster, nym: ScopeNym): boolean {
  return roster.active.has(bytesToHex(nym));
}

/** True iff `nym` has previously been ejected. */
export function isEjected(roster: Roster, nym: ScopeNym): boolean {
  return roster.ejected.has(bytesToHex(nym));
}

/** Active member count (never publicly visible; used by stewards + tests). */
export function activeSize(roster: Roster): number {
  return roster.active.size;
}

// ---------------------------------------------------------------------------
// Wire format — encrypted under the group key
// ---------------------------------------------------------------------------

interface RosterWire {
  readonly v: number;
  /** hex list; order preserved for deterministic serialization. */
  readonly active: readonly string[];
  readonly ejected: readonly string[];
}

/**
 * Serialize a roster to canonical bytes (sorted hex lists). Callers wrap
 * these bytes with `sealWithGroupKey` for a 4920-class event payload;
 * they can also be hashed for equality comparisons in tests.
 */
export function serializeRoster(roster: Roster): Uint8Array {
  const wire: RosterWire = {
    v: ROSTER_WIRE_VERSION,
    active: [...roster.active.keys()].sort(),
    ejected: [...roster.ejected.keys()].sort(),
  };
  return new TextEncoder().encode(JSON.stringify(wire));
}

/**
 * Deserialize roster bytes (produced by `serializeRoster` and then
 * decrypted from an envelope). Returns null on malformed input.
 */
export function deserializeRoster(bytes: Uint8Array): Roster | null {
  try {
    const wire = JSON.parse(new TextDecoder().decode(bytes)) as RosterWire;
    if (wire.v !== ROSTER_WIRE_VERSION) return null;
    if (!Array.isArray(wire.active) || !Array.isArray(wire.ejected)) return null;
    const roster = emptyRoster();
    const active = new Map<string, ScopeNym>();
    const ejected = new Map<string, ScopeNym>();
    for (const hex of wire.active) {
      if (typeof hex !== 'string' || hex.length !== 64) return null;
      active.set(hex, hexToBytes(hex));
    }
    for (const hex of wire.ejected) {
      if (typeof hex !== 'string' || hex.length !== 64) return null;
      ejected.set(hex, hexToBytes(hex));
    }
    // Discard the mutable initial roster; keep the loaded one.
    void roster;
    return { active, ejected };
  } catch {
    return null;
  }
}

/**
 * Encrypt a roster under the group key into a self-contained envelope
 * (ready to become the `content` of a 4920-class Nostr event). Never
 * published as plaintext (Gate 3).
 */
export function encryptRoster(roster: Roster, groupKey: Uint8Array): Uint8Array {
  return sealWithGroupKey(groupKey, serializeRoster(roster));
}

/** Decrypt an encrypted roster envelope. Returns null on any failure. */
export function decryptRoster(envelope: Uint8Array, groupKey: Uint8Array): Roster | null {
  const plaintext = openWithGroupKey(groupKey, envelope);
  if (plaintext === null) return null;
  return deserializeRoster(plaintext);
}
