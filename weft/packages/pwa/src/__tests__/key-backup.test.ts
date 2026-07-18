import { describe, it, expect } from 'vitest';
import { generateKeypair, bytesToHex } from '@weft/core';
import { decryptSecret, encryptSecret } from '../key-backup';

describe('key-backup — encrypt/decrypt roundtrip', () => {
  it('roundtrips a keypair through passphrase encryption', () => {
    const kp = generateKeypair();
    const backup = encryptSecret(kp.secret, 'correct horse battery staple');
    const recovered = decryptSecret(backup, 'correct horse battery staple');
    expect(bytesToHex(recovered)).toBe(bytesToHex(kp.secret));
  });

  it('wrong passphrase fails to decrypt', () => {
    const kp = generateKeypair();
    const backup = encryptSecret(kp.secret, 'right');
    expect(() => decryptSecret(backup, 'wrong')).toThrow();
  });

  it('tampered ciphertext fails to decrypt (AES-GCM AEAD)', () => {
    const kp = generateKeypair();
    const backup = encryptSecret(kp.secret, 'p');
    const tampered = { ...backup, ct: backup.ct.slice(0, -4) + '0000' };
    expect(() => decryptSecret(tampered, 'p')).toThrow();
  });
});
