// Persona k-show binding — the load-bearing property that makes
// plurality bounded (DD §18.2, §36.3).
//
// **The problem this solves.** Personas derive their identity keys from
// the root (derivation.ts), so keys are unlinkable. But if we stopped
// there, one root could spin up thousands of personas — the antithesis
// of "plurality is bounded."
//
// **The mechanism.** At presentation time, each persona attaches a
// **share ticket** whose nullifier is keyed by the *root secret* (not
// the persona key) and whose `show_index` is derived from the persona
// index modulo `k`. Two personas at the same slot-in-epoch produce the
// same nullifier → M9-T2's `detectDoubleSpend` recovers the root secret.
// Cheating is self-incriminating; honest use within k personas per epoch
// per issuer is fully unlinkable.
//
// **What k means here.** Per DD §36.1, k is a cell-charter constant
// (default 3 per quarter-epoch). A user with 3 personas active in a
// given cell over one epoch is fine; the 4th forces collision.
//
// Sources of law:
//   DD §18.2, §36.1, §36.3
//   Build list M11-T1 (k-bound acceptance)

import { DEFAULT_K, makeShareTicket, type IssuerId, type Epoch, type ShareTicket } from '../cred/nullifier';
import type { PersonaIndex } from './derivation';
import type { SecretKey } from '../keys/keys';

/**
 * Build a k-show share ticket for a persona presentation.
 *
 * The persona index is folded into `show_index` modulo `k`. All personas
 * with `personaIndex % k === same` share a nullifier for the same
 * (issuer, epoch), which is the trapdoor: any two such presentations
 * with distinct verifier challenges recover the root via
 * `detectDoubleSpend`.
 *
 * The root secret must be present at presentation time — this is a
 * deliberate design constraint (personas cannot present without root
 * access). In the alpha, persona operations are gated by a root-unlock
 * step per DD §36.3's "separate unlock by default" (a UX concern
 * landing in M11-T3, deferred).
 */
export function personaShareTicket(
  rootSecret: SecretKey,
  personaIndex: PersonaIndex,
  issuerId: IssuerId,
  epoch: Epoch,
  challenge: Uint8Array,
  k: number = DEFAULT_K,
): ShareTicket {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`k must be a positive integer (got ${String(k)})`);
  }
  if (personaIndex < 0 || !Number.isInteger(personaIndex)) {
    throw new Error(`personaIndex must be a non-negative integer (got ${String(personaIndex)})`);
  }
  const showIndex = personaIndex % k;
  return makeShareTicket(rootSecret, issuerId, epoch, showIndex, challenge);
}
