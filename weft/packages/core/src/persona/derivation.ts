// Persona derivation — hardened HKDF from the root secret (DD §36.3).
//
// A persona is an unlinkable secondary self carrying anonymous proof of
// backing (§18). Its identity keypair is derived from the root secret via
// hardened HKDF, indexed by a small integer. Given a persona_root, you
// cannot recover root_secret; given persona A's key, you cannot derive
// persona B's key without root_secret. Siblings and root are
// cryptographically unlinkable.
//
// **Backup story.** The persona *index list* travels in the encrypted
// backup blob (§9.2); persona keys are re-derived from root on restore.
// A single social-recovery of the root reconstructs every persona by
// walking the indices (§18.5). The persona directory itself is never
// stored on relays.
//
// **k-show binding.** Personas share the underlying root_secret for
// M9-T2 nullifier purposes (see nullifier.ts). This is what enforces
// "no root exceeds k active personas per epoch" — see share-ticket.ts.
//
// Sources of law:
//   DD §36.3    persona derivation, standing, lifecycle
//   DD §18.5    "network can't link your selves; your habits can"
//   DD §9.2     encrypted backup blob
//   Build list M11-T1

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { publicKeyFromSecret, type PublicKey, type SecretKey } from '../keys/keys';
import { secp256k1 } from '@noble/curves/secp256k1';

/** HKDF domain-separator for persona derivations. Bump on schema change. */
const HKDF_INFO = new TextEncoder().encode('weft-v2/persona-root/1');
/** Salt used by HKDF-extract for personas. Kept public per HKDF convention. */
const HKDF_SALT = new TextEncoder().encode('weft-v2/persona-salt/1');

/** Persona indices are small non-negative integers. The root persona is
 *  index 0 by convention (== the real identity); non-zero indices are
 *  additional personas. */
export type PersonaIndex = number;

/** Max persona index the client will accept in the local index list. Chosen
 *  large enough that hitting it is a bug; small enough to prevent an
 *  attacker from tricking the client into deriving a billion keys. */
export const MAX_PERSONA_INDEX = 1024;

/**
 * Derive a persona's secret key from `rootSecret` and `index`.
 *
 * Hardened: given the derived key, you can't reverse to `rootSecret`.
 * Given one persona's key, you can't derive a sibling's without the
 * root — the HKDF `info` mixes in the index and each index is
 * independent under HKDF-SHA256's uniformity.
 *
 * Uses rejection-resampling if the raw HKDF output happens to fall
 * outside secp256k1's [1, n) valid-scalar range. In practice this fires
 * with probability ~2^-128, so the retry bound is a defensive cap.
 */
export function personaRoot(rootSecret: SecretKey, index: PersonaIndex): {
  secret: SecretKey;
  pubkey: PublicKey;
} {
  if (rootSecret.length !== 32) {
    throw new Error(`root secret must be exactly 32 bytes (got ${rootSecret.length})`);
  }
  if (!Number.isInteger(index) || index < 0 || index > MAX_PERSONA_INDEX) {
    throw new Error(`persona index must be an integer in [0, ${MAX_PERSONA_INDEX}] (got ${String(index)})`);
  }
  // Mix the index into HKDF info as big-endian uint32 so the same index
  // always produces the same key across runs.
  const idxBE = Uint8Array.of((index >>> 24) & 0xff, (index >>> 16) & 0xff, (index >>> 8) & 0xff, index & 0xff);
  const info = concatBytes(HKDF_INFO, idxBE);

  let counter = 0;
  while (counter < 8) {
    const infoWithCounter = counter === 0 ? info : concatBytes(info, Uint8Array.of(counter));
    const seed = hkdf(sha256, rootSecret, HKDF_SALT, infoWithCounter, 32);
    if (secp256k1.utils.isValidPrivateKey(seed)) {
      return { secret: seed, pubkey: publicKeyFromSecret(seed) };
    }
    counter++;
  }
  throw new Error('personaRoot: HKDF exhausted retries (statistically impossible)');
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ---------------------------------------------------------------------------
// PersonaIndex tracking — the local directory of active personas
// ---------------------------------------------------------------------------

/**
 * Per-persona metadata the client stores locally alongside the root.
 * Never leaves the device except inside the encrypted backup blob.
 */
export interface PersonaRecord {
  /** The derivation index. */
  index: PersonaIndex;
  /**
   * Human-readable label the user sees in settings ("Alice", "AliceQuiet").
   * Never presented to counterparties.
   */
  label: string;
  /** Unix seconds of creation — informational only. */
  createdAt: number;
}

/**
 * The list of active personas. Serialized into the encrypted backup blob
 * (§9.2) so a social-recovery of the root re-derives every persona key.
 */
export interface PersonaDirectory {
  /** Records for every currently-active persona (including index 0). */
  personas: readonly PersonaRecord[];
}

/** Bumped whenever the directory wire schema changes. */
export const PERSONA_DIRECTORY_VERSION = 1;

/**
 * Create an initial directory containing just the root persona (index 0)
 * with a user-chosen label ("main" by default).
 */
export function initialDirectory(rootLabel = 'main', now = Math.floor(Date.now() / 1000)): PersonaDirectory {
  return {
    personas: [{ index: 0, label: rootLabel, createdAt: now }],
  };
}

/**
 * Add a persona to the directory. Chooses the next unused index by scanning
 * existing records; throws if MAX_PERSONA_INDEX is hit.
 *
 * Returns the new directory AND the new persona's record so the caller
 * can immediately derive its keys with `personaRoot`.
 */
export function addPersona(
  dir: PersonaDirectory,
  label: string,
  now = Math.floor(Date.now() / 1000),
): { dir: PersonaDirectory; record: PersonaRecord } {
  const usedIndexes = new Set(dir.personas.map((p) => p.index));
  let nextIndex = 0;
  while (usedIndexes.has(nextIndex)) nextIndex++;
  if (nextIndex > MAX_PERSONA_INDEX) {
    throw new Error(`persona directory exhausted (max ${MAX_PERSONA_INDEX})`);
  }
  const record: PersonaRecord = { index: nextIndex, label, createdAt: now };
  return {
    dir: { personas: [...dir.personas, record] },
    record,
  };
}

/**
 * Remove a persona from the directory. Client discipline: on removal,
 * every downstream state associated with this persona should be discarded
 * (analogous to `dropForCellOnLeave` for k_cred). Removing index 0 is
 * refused — the root persona is load-bearing.
 */
export function removePersona(dir: PersonaDirectory, index: PersonaIndex): PersonaDirectory {
  if (index === 0) {
    throw new Error('cannot remove the root persona (index 0)');
  }
  const filtered = dir.personas.filter((p) => p.index !== index);
  if (filtered.length === dir.personas.length) {
    throw new Error(`persona index ${index} not found in directory`);
  }
  return { personas: filtered };
}

/** Find a persona record by index. */
export function findPersona(dir: PersonaDirectory, index: PersonaIndex): PersonaRecord | undefined {
  return dir.personas.find((p) => p.index === index);
}

// ---------------------------------------------------------------------------
// Serialization for the encrypted backup blob
// ---------------------------------------------------------------------------

interface DirectoryWire {
  v: number;
  personas: PersonaRecord[];
}

/** Canonical bytes for the encrypted backup blob. Callers wrap with their
 *  existing backup encryption (see pwa/src/key-backup.ts). */
export function serializeDirectory(dir: PersonaDirectory): Uint8Array {
  const wire: DirectoryWire = {
    v: PERSONA_DIRECTORY_VERSION,
    personas: [...dir.personas],
  };
  return new TextEncoder().encode(JSON.stringify(wire));
}

export function deserializeDirectory(bytes: Uint8Array): PersonaDirectory | null {
  try {
    const wire = JSON.parse(new TextDecoder().decode(bytes)) as DirectoryWire;
    if (wire.v !== PERSONA_DIRECTORY_VERSION) return null;
    if (!Array.isArray(wire.personas)) return null;
    for (const p of wire.personas) {
      if (
        typeof p.index !== 'number' ||
        typeof p.label !== 'string' ||
        typeof p.createdAt !== 'number'
      ) {
        return null;
      }
    }
    return { personas: wire.personas };
  } catch {
    return null;
  }
}
