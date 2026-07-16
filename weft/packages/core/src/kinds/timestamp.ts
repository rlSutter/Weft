// Randomized wrapper `created_at` — DD §35 F3.
//
// Every 1059 gift wrap (M2-T2) carries a `created_at` drawn uniformly from
// the past 48 hours rather than the true send time. This does two things:
//   (1) blunts traffic correlation across relays and wrappers;
//   (2) makes vouch-timestamp-style relationship inference impossible for
//       any wrapped payload.
//
// Retention (`expiration` tag) is separately computed from true wall-clock
// time and the inner kind's retention class — the two clocks are decoupled
// on purpose. The wrapper carries only what a relay sees.

const WINDOW_SECONDS = 48 * 60 * 60;

/**
 * Return a Unix-seconds timestamp uniformly in `[now - 48h, now - 1]`.
 *
 * The lower bound is `now - 48h` (inclusive); the upper bound is `now - 1`
 * (inclusive) — the offset is strictly ≥ 1 so the returned time NEVER
 * equals the true send second. This is what M0-T2's acceptance test
 * ("never equals the true send time's second") checks.
 *
 * @param now Wall-clock Unix seconds. Defaults to `Math.floor(Date.now()/1000)`.
 * @param rng Uniform [0, 1) generator. Defaults to `Math.random`. Tests inject
 *            a seeded PRNG or a fixed constant to make behavior deterministic.
 */
export function randomizedCreatedAt(
  now: number = Math.floor(Date.now() / 1000),
  rng: () => number = Math.random,
): number {
  // Offset in [1, WINDOW_SECONDS] — strictly positive, so t < now always.
  const offset = 1 + Math.floor(rng() * WINDOW_SECONDS);
  return now - offset;
}

/** Exposed for tests and for use as a range check by relay-side sanity code. */
export const RANDOMIZED_CREATED_AT_WINDOW_SECONDS = WINDOW_SECONDS;
