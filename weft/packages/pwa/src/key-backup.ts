// Encrypted key export/import — DD §9.2 minimum ("passphrase → scrypt via
// noble → AES-GCM").

import { scrypt } from '@noble/hashes/scrypt';
import { gcm } from '@noble/ciphers/aes';
import { randomBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils';

const SCRYPT_N = 1 << 15; // 32k iterations — fast enough on modest phones, painful for offline brute force
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export interface EncryptedBackup {
  readonly v: 1;
  readonly salt: string; // hex, 16 bytes
  readonly nonce: string; // hex, 12 bytes
  readonly ct: string; // hex, ciphertext + AEAD tag
}

/** Wrap a 32-byte secret under a passphrase. */
export function encryptSecret(secret: Uint8Array, passphrase: string): EncryptedBackup {
  if (secret.length !== 32) throw new Error('secret must be 32 bytes');
  const salt = randomBytes(16);
  const key = scrypt(passphrase, salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, dkLen: 32 });
  const nonce = randomBytes(12);
  const ct = gcm(key, nonce).encrypt(secret);
  return { v: 1, salt: bytesToHex(salt), nonce: bytesToHex(nonce), ct: bytesToHex(ct) };
}

/** Recover a 32-byte secret from an encrypted backup. Throws on bad passphrase or tampered blob. */
export function decryptSecret(backup: EncryptedBackup, passphrase: string): Uint8Array {
  if (backup.v !== 1) throw new Error(`unsupported backup version ${backup.v}`);
  const salt = hexToBytes(backup.salt);
  const nonce = hexToBytes(backup.nonce);
  const ct = hexToBytes(backup.ct);
  const key = scrypt(passphrase, salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, dkLen: 32 });
  return gcm(key, nonce).decrypt(ct);
}
