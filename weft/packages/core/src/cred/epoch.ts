// Epoch clock — global, coarse, wall-clock-derived (DD §36.1).
//
// Every credential carries `issued_epoch` and `expiry_epoch` (uint32).
// Presentations are rejected past `expiry_epoch`; renewal re-issues against
// the still-valid underlying vouch (DD §18.2's revocation-by-non-renewal).
//
// The derivation from wall-clock is:
//
//     epoch(t) = floor((t - EPOCH_ZERO) / QUARTER_SECONDS)
//
// where `EPOCH_ZERO` is the Weft epoch origin (2020-01-01 UTC) and
// `QUARTER_SECONDS` is a fixed 91-day window. This isn't a calendar
// quarter — it's a globally-deterministic constant everyone agrees on
// without coordination, which is what the design needs.

/** Weft epoch origin: 2020-01-01T00:00:00Z, as Unix seconds. */
export const EPOCH_ZERO = 1577836800;

/** Length of one epoch in seconds (91 days ≈ one quarter). */
export const QUARTER_SECONDS = 91 * 24 * 60 * 60;

/**
 * Derive the current epoch (uint32) from wall-clock Unix seconds.
 *
 * `now` is injectable for tests; defaults to real wall-clock.
 * Values before `EPOCH_ZERO` return 0 (this shouldn't happen in practice —
 * 2020 is long past — but is a defensive choice over throwing).
 */
export function currentEpoch(now: number = Math.floor(Date.now() / 1000)): number {
  const delta = now - EPOCH_ZERO;
  if (delta < 0) return 0;
  return Math.floor(delta / QUARTER_SECONDS);
}

/**
 * True iff `epoch` is a valid uint32 credential epoch value.
 * Used at parse time; caller decides what to do on false (usually reject).
 */
export function isValidEpoch(epoch: number): boolean {
  return Number.isInteger(epoch) && epoch >= 0 && epoch <= 0xffff_ffff;
}
