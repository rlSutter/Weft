// Normative tag vocabulary — DD §33.4.
//
// "Nothing else may carry routing-relevant meaning." Adding a tag here is a
// wire-format change (CHANGELOG "Wire" section, phase bump). Do not extend
// this file without the DD §26.1 process.

export const Tags = Object.freeze({
  /** Recipient / subject pubkey. */
  P: 'p',
  /** Referenced event id. */
  E: 'e',
  /** Charter-lineage pointer (previous charter in the amendment chain). */
  PREV: 'prev',
  /** NIP-40 expiration timestamp — retention class enforcement. */
  EXPIRATION: 'expiration',
  /** Vouch tier (1 = provisional, 2 = contextual, 3 = relationship). */
  TIER: 'tier',
  /** Vouch context code. */
  CTX: 'ctx',
  /** Hashed group channel id (group messaging). */
  H: 'h',
  /** Group / cell charter id when a reply or declaration speaks for a group. DD §35 F9. */
  GRP: 'grp',
  /** Protocol version. */
  VER: 'ver',
  /** Embedding-model content hash. */
  MDL: 'mdl',
  /** Per-edge blinded route token (16 B random). DD §35 F2. Meaningful only
   *  between adjacent hops; swapped at each. */
  RT: 'rt',
} as const);

export type TagName = (typeof Tags)[keyof typeof Tags];

/** Set of all normative tag names — for quick membership tests in parsers. */
export const KNOWN_TAGS: ReadonlySet<TagName> = new Set<TagName>(
  Object.values(Tags) as TagName[],
);

/** True iff `s` is a normative tag name per DD §33.4. Unknown tags are ignored
 *  (forward compat, DD §33.4), never routing-load-bearing. */
export function isKnownTag(s: string): s is TagName {
  return KNOWN_TAGS.has(s as TagName);
}
