// Kind registry — the single source of truth for every Nostr event kind Weft uses.
//
// Sources of law:
//   DD §33.1  wrapper (kind 1059) + retention classes E/D/P
//   DD §33.2  public kinds
//   DD §33.3  inner kinds (including F1's private-vouch 4902, F9's group kinds
//             4911/4912-grp, F11's terms-vocabulary registry 4927)
//   DD §33.4  normative tag vocabulary
//   DD §35    second adversarial pass (F1 privateOnly, F3 timestamp discipline)
//   DD §36.4  v2 credential/group additions (4930–4933)
//   Build list M0-T2  what this file must expose and prove
//
// Flags:
//   privateOnly   never appears in plaintext on any relay (DD §35 F1).
//                 Currently: 4902 vouch attestations.
//   v2Only        registered so no future kind reuses the number; engines
//                 must never emit these in v0. Includes group behavior,
//                 personas, beacons, escrow, etc. (build-list §13).
//   registryOnly  a reserved number that is *not* an event kind — reserves
//                 the slot so nothing later mutates it. Currently: 4927 terms
//                 vocabulary reference (DD §33.3, F11).

export type RetentionClass = 'E' | 'D' | 'P';

/** Seconds until an event of a given retention class expires. `null` = no expiration. */
export const RETENTION_SECONDS: Readonly<Record<RetentionClass, number | null>> = Object.freeze({
  E: 6 * 60 * 60, //          6 hours   — ephemeral handshake state
  D: 5 * 24 * 60 * 60, //     5 days    — discovery / delivery
  P: null, //                 persistent — public record (charter, void, manifest…)
});

export interface KindDef {
  /** Nostr event kind number. */
  readonly number: number;
  /** Human-friendly name matching DD §33 nomenclature. */
  readonly name: string;
  /** Retention class per DD §33.1, or `null` if this number is a registry reservation
   *  (see `registryOnly`) that never rides on the wire. */
  readonly retentionClass: RetentionClass | null;
  /** Seconds until expiration, derived from retentionClass. `null` = no expiration
   *  tag emitted (either persistent, or a registryOnly reservation). */
  readonly expirationSeconds: number | null;
  /** DD §35 F1: this kind is delivered wrapped to its subject and cached locally,
   *  and MUST NEVER appear as a plaintext event on a relay. Only 4902 in v0. */
  readonly privateOnly?: boolean;
  /** Registered to prevent future reuse of the number; v0 engines MUST NOT emit
   *  events of this kind (per build-list §13). */
  readonly v2Only?: boolean;
  /** This "kind" reserves a number without being an event — it's a registry ref
   *  (e.g. 4927 terms vocabulary). Reading/writing a Nostr event of this kind is a bug. */
  readonly registryOnly?: boolean;
  /** DD section(s) that specify this kind, for humans reading the registry. */
  readonly implements: string;
}

function derive(def: Omit<KindDef, 'expirationSeconds'>): KindDef {
  const exp =
    def.retentionClass === null ? null : RETENTION_SECONDS[def.retentionClass];
  return { ...def, expirationSeconds: exp };
}

// ---------------------------------------------------------------------------
// Wrapper (external — NIP-59). Included so retention lookups work uniformly.
// ---------------------------------------------------------------------------

const WRAPPER: readonly KindDef[] = [
  derive({
    number: 1059,
    name: 'GiftWrap',
    retentionClass: 'D', // wrapper's own expiration is set from the *inner* kind at wrap time;
    //                    'D' is the safe fallback for the registry (M2's wrapper overrides).
    implements: 'NIP-59 · DD §33.1',
  }),
];

// ---------------------------------------------------------------------------
// Public kinds (DD §33.2) — plaintext, signed, stored.
// ---------------------------------------------------------------------------

const PUBLIC_KINDS: readonly KindDef[] = [
  derive({
    number: 4900,
    name: 'Charter',
    retentionClass: 'P',
    implements: 'DD §7, §29, §30, §33.2',
  }),
  derive({
    number: 4903,
    name: 'Void',
    retentionClass: 'P',
    // The only vouch-related object that ever appears on a relay. References the
    // sha256 of the voided object (vouch attestation hash, invite iid, or "not my Bob").
    implements: 'DD §4, §15, §30, §33.2, §35 F1',
  }),
  derive({
    number: 4904,
    name: 'EjectionAttestation',
    retentionClass: 'P',
    v2Only: true, // groups (and thus ejections) do not exist in v0
    implements: 'DD §7, §18.2, §24.3, §33.2',
  }),
  derive({
    number: 4905,
    name: 'HealthBeacon',
    retentionClass: 'P',
    v2Only: true, // v0 emits nothing; local counters only (OBSERVABILITY.md)
    implements: 'DD §10.2, §33.2',
  }),
  derive({
    number: 4906,
    name: 'RelayOpsMetrics',
    retentionClass: 'P',
    v2Only: true,
    implements: 'DD §10.4, §11.4, §33.2',
  }),
  derive({
    number: 4907,
    name: 'ModelRegistryEntry',
    retentionClass: 'P',
    v2Only: true,
    implements: 'DD §19.2, §33.2',
  }),
  derive({
    number: 4909,
    name: 'ReleaseManifest',
    retentionClass: 'P',
    // Weft clients verify these; the foundation publishes them. Not marked v2Only:
    // v0 verification is a supply-chain control (SECURITY.md), even if no manifest
    // has been signed yet.
    implements: 'DD §28.2, §32.5, §33.2',
  }),
];

// ---------------------------------------------------------------------------
// Inner kinds (DD §33.3) — inside the 1059 gift wrap.
// ---------------------------------------------------------------------------

const INNER_KINDS: readonly KindDef[] = [
  derive({
    number: 4902,
    name: 'VouchAttestation',
    retentionClass: 'D', // wire class when delivered wrapped; subject caches durably
    privateOnly: true, //   DD §35 F1 — never published plaintext to relays; Gate 3
    implements: 'DD §4, §21, §30.3, §33.3, §35 F1',
  }),
  derive({
    number: 4910,
    name: 'Query',
    retentionClass: 'D',
    implements: 'DD §3, §8, §17, §25, §33.3, §35 F2/F5',
  }),
  derive({
    number: 4911,
    name: 'GroupInterestDeclaration',
    retentionClass: 'P', // published under the group's key on the group's charter relays
    v2Only: true, //        group behavior is v2; registry-complete so number is reserved
    implements: 'DD §5, §7, §20.3, §33.3, §35 F9',
  }),
  derive({
    number: 4912,
    name: 'MatchReply',
    retentionClass: 'D',
    // A grp-tagged variant answers on behalf of a group (v2, F9). The kind number
    // is shared; v0 must never emit or accept the grp-tagged form.
    implements: 'DD §5 stage 0, §33.3, §35 F2/F9',
  }),
  derive({
    number: 4913,
    name: 'IntentPing',
    retentionClass: 'E',
    implements: 'DD §5 stage 1, §33.3',
  }),
  derive({
    number: 4914,
    name: 'TermsResponse',
    retentionClass: 'E',
    // Silent decline = no event, ever. The protocol has no decline message. Gate 2.
    implements: 'DD §5 stage 2, §33.3',
  }),
  derive({
    number: 4915,
    name: 'Commit',
    retentionClass: 'E',
    implements: 'DD §5 stage 3, §33.3',
  }),
  derive({
    number: 4916,
    name: 'Reveal',
    retentionClass: 'E',
    implements: 'DD §5 stage 3, §33.3',
  }),
  derive({
    number: 4917,
    name: 'ChannelHandoff',
    retentionClass: 'E',
    implements: 'DD §5 stage 5, §33.3',
  }),
  derive({
    number: 4918,
    name: 'InviteRedemption',
    retentionClass: 'D',
    implements: 'DD §30.3 step 4, §33.3',
  }),
  derive({
    number: 4919,
    name: 'PairwiseHello',
    retentionClass: 'D',
    implements: 'DD §9.1, §15, §33.3',
  }),
  derive({
    number: 4920,
    name: 'GroupMessage',
    retentionClass: 'D',
    v2Only: true,
    implements: 'DD §7, §9.1, §33.3',
  }),
  derive({
    number: 4921,
    name: 'GroupKeyRotation',
    retentionClass: 'D',
    v2Only: true,
    implements: 'DD §7, §9.1, §33.3',
  }),
  derive({
    number: 4922,
    name: 'CharterConsentReceipt',
    retentionClass: 'D',
    v2Only: true, // charters beyond the invite-displayed one are v2 (build-list §13)
    implements: 'DD §14.6, §29, §33.3',
  }),
  derive({
    number: 4923,
    name: 'Tombstone',
    retentionClass: 'P',
    v2Only: true,
    implements: 'DD §23, §33.3',
  }),
  derive({
    number: 4924,
    name: 'EscrowShare',
    retentionClass: 'E',
    v2Only: true, // meetup escrow is v2 (build-list §13)
    implements: 'DD §24.2, §33.3',
  }),
  derive({
    number: 4927,
    name: 'TermsVocabulary',
    // Not an event — reserves the number for the versioned terms-predicate registry.
    // Actual predicates live in TERMS_PREDICATES below.
    retentionClass: null,
    registryOnly: true,
    implements: 'DD §33.3, §35 F11',
  }),
  derive({
    number: 4930,
    name: 'CredentialRequest',
    retentionClass: 'E',
    v2Only: true,
    implements: 'DD §36.1, §36.4',
  }),
  derive({
    number: 4931,
    name: 'CredentialIssuance',
    retentionClass: 'D',
    v2Only: true,
    implements: 'DD §36.1, §36.4',
  }),
  derive({
    number: 4932,
    name: 'GroupJoinRequest',
    retentionClass: 'E',
    v2Only: true,
    implements: 'DD §36.2, §36.4',
  }),
  derive({
    number: 4933,
    name: 'MembershipGrant',
    retentionClass: 'D',
    v2Only: true,
    implements: 'DD §36.2, §36.4',
  }),
];

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** All kinds Weft is aware of, in registration order (wrapper → public → inner). */
export const KINDS: readonly KindDef[] = Object.freeze([
  ...WRAPPER,
  ...PUBLIC_KINDS,
  ...INNER_KINDS,
]);

const BY_NUMBER: ReadonlyMap<number, KindDef> = new Map(KINDS.map((k) => [k.number, k]));
const BY_NAME: ReadonlyMap<string, KindDef> = new Map(KINDS.map((k) => [k.name, k]));

/** Look up a kind by its Nostr event kind number. */
export function kindByNumber(n: number): KindDef | undefined {
  return BY_NUMBER.get(n);
}

/** Look up a kind by its Weft nomenclature name. */
export function kindByName(name: string): KindDef | undefined {
  return BY_NAME.get(name);
}

// ---------------------------------------------------------------------------
// Terms-predicate registry (DD §33.3 kind 4927, F11).
// Coded predicates carried in 4913 / 4914 terms fields. Rendered locally in
// each user's language; free-text terms are prohibited so two parties in
// different languages consent to the *same* predicate set.
// New predicates are added by the DD §26.1 process; unknown predicates are
// rejected at parse time, never guessed.
// ---------------------------------------------------------------------------

export const TERMS_PREDICATES = Object.freeze([
  'reveal.name',
  'reveal.vouches',
  'reveal.city',
  'reveal.after=1msg',
  'stay.pseudonymous.until=sponsor',
] as const);

export type TermsPredicate = (typeof TERMS_PREDICATES)[number];

/** True iff `s` is a known terms predicate. Used by 4913/4914 parsers. */
export function isKnownPredicate(s: string): s is TermsPredicate {
  return (TERMS_PREDICATES as readonly string[]).includes(s);
}
