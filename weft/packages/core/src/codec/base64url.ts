// Base64url encode / decode (RFC 4648 §5) — URL-safe base64, no padding.
//
// Written from scratch (no `atob`/`btoa`) so `core/` stays free of platform
// globals per DD §32.4 / STRUCTURE.md's package-boundary rule.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const DECODE_TABLE: Int8Array = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    t[ALPHABET.charCodeAt(i)] = i;
  }
  return t;
})();

/** Encode bytes as base64url (no padding). */
export function base64UrlEncode(bytes: Uint8Array): string {
  const len = bytes.length;
  let out = '';
  let i = 0;
  for (; i + 3 <= len; i += 3) {
    const t = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(t >> 18) & 0x3f];
    out += ALPHABET[(t >> 12) & 0x3f];
    out += ALPHABET[(t >> 6) & 0x3f];
    out += ALPHABET[t & 0x3f];
  }
  const rem = len - i;
  if (rem === 1) {
    const t = bytes[i] << 16;
    out += ALPHABET[(t >> 18) & 0x3f];
    out += ALPHABET[(t >> 12) & 0x3f];
  } else if (rem === 2) {
    const t = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(t >> 18) & 0x3f];
    out += ALPHABET[(t >> 12) & 0x3f];
    out += ALPHABET[(t >> 6) & 0x3f];
  }
  return out;
}

/** Decode a base64url string (padding tolerated but not required). Throws on invalid chars. */
export function base64UrlDecode(str: string): Uint8Array {
  // Strip any padding the caller included.
  let s = str;
  while (s.length > 0 && s[s.length - 1] === '=') s = s.slice(0, -1);

  const len = s.length;
  if (len === 0) return new Uint8Array(0);
  if (len % 4 === 1) {
    throw new Error('invalid base64url: length ≡ 1 (mod 4)');
  }

  const fullQuads = Math.floor(len / 4);
  const rem = len - fullQuads * 4;
  const outLen = fullQuads * 3 + (rem === 0 ? 0 : rem - 1);
  const out = new Uint8Array(outLen);

  let outIdx = 0;
  for (let i = 0; i < fullQuads * 4; i += 4) {
    const c0 = decodeChar(s.charCodeAt(i));
    const c1 = decodeChar(s.charCodeAt(i + 1));
    const c2 = decodeChar(s.charCodeAt(i + 2));
    const c3 = decodeChar(s.charCodeAt(i + 3));
    const t = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[outIdx++] = (t >> 16) & 0xff;
    out[outIdx++] = (t >> 8) & 0xff;
    out[outIdx++] = t & 0xff;
  }
  if (rem >= 2) {
    const base = fullQuads * 4;
    const c0 = decodeChar(s.charCodeAt(base));
    const c1 = decodeChar(s.charCodeAt(base + 1));
    const t2 = (c0 << 18) | (c1 << 12);
    out[outIdx++] = (t2 >> 16) & 0xff;
    if (rem === 3) {
      const c2 = decodeChar(s.charCodeAt(base + 2));
      const t3 = (c0 << 18) | (c1 << 12) | (c2 << 6);
      out[outIdx++] = (t3 >> 8) & 0xff;
    }
  }
  return out;
}

function decodeChar(code: number): number {
  const v = code < 128 ? DECODE_TABLE[code] : -1;
  if (v < 0) {
    throw new Error(`invalid base64url character: 0x${code.toString(16)}`);
  }
  return v;
}
