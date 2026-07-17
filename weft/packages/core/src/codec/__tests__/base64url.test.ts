import { describe, it, expect } from 'vitest';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { base64UrlDecode, base64UrlEncode } from '../base64url';

describe('base64url', () => {
  it('encodes empty input to empty string', () => {
    expect(base64UrlEncode(new Uint8Array(0))).toBe('');
    expect(base64UrlDecode('')).toEqual(new Uint8Array(0));
  });

  it('roundtrips random-looking bytes', () => {
    const cases = [
      new Uint8Array([0x66]),
      new Uint8Array([0x66, 0x6f]),
      new Uint8Array([0x66, 0x6f, 0x6f]),
      new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]),
      hexToBytes('deadbeef'),
      hexToBytes('00112233445566778899aabbccddeeff'),
    ];
    for (const c of cases) {
      const s = base64UrlEncode(c);
      expect(s).not.toContain('+');
      expect(s).not.toContain('/');
      expect(s).not.toContain('=');
      const decoded = base64UrlDecode(s);
      expect(bytesToHex(decoded)).toBe(bytesToHex(c));
    }
  });

  it('matches known RFC 4648 §10 vectors', () => {
    // "f" → "Zg", "fo" → "Zm8", "foo" → "Zm9v", "foob" → "Zm9vYg",
    // "fooba" → "Zm9vYmE", "foobar" → "Zm9vYmFy"
    const enc = new TextEncoder();
    expect(base64UrlEncode(enc.encode(''))).toBe('');
    expect(base64UrlEncode(enc.encode('f'))).toBe('Zg');
    expect(base64UrlEncode(enc.encode('fo'))).toBe('Zm8');
    expect(base64UrlEncode(enc.encode('foo'))).toBe('Zm9v');
    expect(base64UrlEncode(enc.encode('foob'))).toBe('Zm9vYg');
    expect(base64UrlEncode(enc.encode('fooba'))).toBe('Zm9vYmE');
    expect(base64UrlEncode(enc.encode('foobar'))).toBe('Zm9vYmFy');
  });

  it('uses URL-safe alphabet (- and _, not + and /)', () => {
    // 0xfb 0xff = binary 1111_1011 1111_1111 → base64 "+/"; base64url "-_"
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });

  it('tolerates optional padding on decode', () => {
    expect(bytesToHex(base64UrlDecode('Zg=='))).toBe('66');
    expect(bytesToHex(base64UrlDecode('Zg'))).toBe('66');
    expect(bytesToHex(base64UrlDecode('Zm8='))).toBe('666f');
  });

  it('rejects invalid characters', () => {
    expect(() => base64UrlDecode('A B C D')).toThrow();
    expect(() => base64UrlDecode('AAAA!')).toThrow();
  });

  it('rejects length ≡ 1 (mod 4)', () => {
    expect(() => base64UrlDecode('A')).toThrow(/mod 4/);
    expect(() => base64UrlDecode('AAAAA')).toThrow(/mod 4/);
  });
});
