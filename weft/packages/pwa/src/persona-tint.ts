// Persona shell-tint — DD §36.3 "visually distinct shell (accent from
// persona key)". Deterministic hue derived from the persona's pubkey so
// the same persona always looks the same to its owner, and different
// personas look different.
//
// Root persona (index 0) is deliberately UNTINTED — it keeps the design
// system's canonical pine accent so the main-identity experience matches
// the mockup and the weft-ux-spec §5 tokens exactly.

import { tokens } from './styles';

/** A palette derived from a persona pubkey. */
export interface PersonaPalette {
  accent: string;
  accentSoft: string;
  /** Short label showing which persona is active, e.g. "AliceQuiet · Persona". */
  eyebrow: string;
}

/** Deterministic hash of the pubkey hex into an HSL hue [0, 360). */
function hueFromPubkey(pubkeyHex: string): number {
  // A tiny mixing hash — nothing security-sensitive, just for visual variety.
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < pubkeyHex.length; i++) {
    h ^= pubkeyHex.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

/**
 * Palette for the given persona.
 *   - index 0 (root)     → canonical pine, unlabeled
 *   - other indexes      → hue derived from pubkey, tinted background
 *
 * The saturation and lightness are pinned so tints stay in the same
 * visual register as the base design tokens.
 */
export function personaPalette(personaIndex: number, pubkeyHex: string, label: string): PersonaPalette {
  if (personaIndex === 0) {
    return {
      accent: tokens.accent,
      accentSoft: tokens.accentSoft,
      eyebrow: '',
    };
  }
  const hue = hueFromPubkey(pubkeyHex);
  return {
    accent: `hsl(${hue}deg 40% 30%)`,
    accentSoft: `hsl(${hue}deg 30% 90%)`,
    eyebrow: `${label} · Persona ${personaIndex}`,
  };
}
