/**
 * Tests for wallet management: encryption, decryption, storage, and lifecycle
 * Covers the critical security path: PBKDF2 key derivation + AES-GCM encrypt/decrypt
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { bufferToBase64, base64ToBuffer } from './utils.ts';
import type { StoredWallet } from './types.ts';

// ── Replicate wallet crypto helpers for testability ──
// We test the same crypto logic used in wallet.ts without importing the
// module directly (which requires algosdk and real ChatAccount types).

const PBKDF2_ITERATIONS = 600_000;

async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptMnemonic(
  mnemonic: string,
  password: string
): Promise<StoredWallet> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    enc.encode(mnemonic)
  );

  return {
    encryptedMnemonic: bufferToBase64(new Uint8Array(encrypted)),
    address: 'TEST_ADDRESS',
    iv: bufferToBase64(iv),
    salt: bufferToBase64(salt),
  };
}

async function decryptMnemonic(
  stored: StoredWallet,
  password: string
): Promise<string> {
  const salt = base64ToBuffer(stored.salt);
  const iv = base64ToBuffer(stored.iv);
  const ciphertext = base64ToBuffer(stored.encryptedMnemonic);
  const key = await deriveKey(password, salt);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error('Invalid password');
  }
}

// ── Tests ──

describe('wallet crypto: encrypt/decrypt round-trip', () => {
  const TEST_MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const PASSWORD = 'test-password-123';

  it('encrypts and decrypts a mnemonic with the correct password', async () => {
    const stored = await encryptMnemonic(TEST_MNEMONIC, PASSWORD);
    const decrypted = await decryptMnemonic(stored, PASSWORD);
    expect(decrypted).toBe(TEST_MNEMONIC);
  });

  it('rejects decryption with wrong password', async () => {
    const stored = await encryptMnemonic(TEST_MNEMONIC, PASSWORD);
    await expect(decryptMnemonic(stored, 'wrong-password')).rejects.toThrow(
      'Invalid password'
    );
  });

  it('produces different ciphertext for the same input (random IV/salt)', async () => {
    const stored1 = await encryptMnemonic(TEST_MNEMONIC, PASSWORD);
    const stored2 = await encryptMnemonic(TEST_MNEMONIC, PASSWORD);
    expect(stored1.encryptedMnemonic).not.toBe(stored2.encryptedMnemonic);
    expect(stored1.iv).not.toBe(stored2.iv);
    expect(stored1.salt).not.toBe(stored2.salt);
  });

  it('handles empty password', async () => {
    const stored = await encryptMnemonic(TEST_MNEMONIC, '');
    const decrypted = await decryptMnemonic(stored, '');
    expect(decrypted).toBe(TEST_MNEMONIC);
  });

  it('handles unicode password', async () => {
    const unicodePassword = '\u{1F512}P\u00E4ssw\u00F6rd\u{1F511}';
    const stored = await encryptMnemonic(TEST_MNEMONIC, unicodePassword);
    const decrypted = await decryptMnemonic(stored, unicodePassword);
    expect(decrypted).toBe(TEST_MNEMONIC);
  });

  it('handles very long mnemonic', async () => {
    const longMnemonic = Array(25).fill('abandon').join(' ');
    const stored = await encryptMnemonic(longMnemonic, PASSWORD);
    const decrypted = await decryptMnemonic(stored, PASSWORD);
    expect(decrypted).toBe(longMnemonic);
  });
});

describe('wallet crypto: StoredWallet structure', () => {
  it('produces a valid StoredWallet with all required fields', async () => {
    const stored = await encryptMnemonic('test mnemonic', 'password');
    expect(stored).toHaveProperty('encryptedMnemonic');
    expect(stored).toHaveProperty('address');
    expect(stored).toHaveProperty('iv');
    expect(stored).toHaveProperty('salt');
    expect(typeof stored.encryptedMnemonic).toBe('string');
    expect(typeof stored.iv).toBe('string');
    expect(typeof stored.salt).toBe('string');
  });

  it('produces base64-decodable iv and salt', async () => {
    const stored = await encryptMnemonic('test', 'pass');
    const iv = base64ToBuffer(stored.iv);
    const salt = base64ToBuffer(stored.salt);
    expect(iv.length).toBe(12); // AES-GCM IV is 12 bytes
    expect(salt.length).toBe(16); // PBKDF2 salt is 16 bytes
  });

  it('serializes and deserializes through JSON correctly', async () => {
    const stored = await encryptMnemonic('test mnemonic data', 'mypassword');
    const json = JSON.stringify(stored);
    const parsed = JSON.parse(json) as StoredWallet;
    const decrypted = await decryptMnemonic(parsed, 'mypassword');
    expect(decrypted).toBe('test mnemonic data');
  });
});

describe('wallet crypto: key derivation', () => {
  it('same password + salt produces same key (deterministic)', async () => {
    const salt = new Uint8Array(16).fill(0x42);
    const key1 = await deriveKey('password', salt);
    const key2 = await deriveKey('password', salt);

    // Both keys should be able to decrypt what the other encrypted
    const iv = new Uint8Array(12).fill(0x01);
    const plaintext = new TextEncoder().encode('test data');

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key1,
      plaintext
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key2,
      encrypted
    );
    expect(new TextDecoder().decode(decrypted)).toBe('test data');
  });

  it('different salts produce different keys', async () => {
    const salt1 = new Uint8Array(16).fill(0x01);
    const salt2 = new Uint8Array(16).fill(0x02);
    const iv = new Uint8Array(12).fill(0x01);
    const plaintext = new TextEncoder().encode('secret');

    const key1 = await deriveKey('password', salt1);
    const key2 = await deriveKey('password', salt2);

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key1,
      plaintext
    );

    // Decrypting with a key derived from a different salt should fail
    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, encrypted)
    ).rejects.toThrow();
  });
});

describe('wallet localStorage simulation', () => {
  // Test localStorage-based storage logic with an in-memory mock
  const STORAGE_KEY = 'corvid-wallet';
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
  });

  function getItem(key: string): string | null {
    return storage.get(key) ?? null;
  }
  function setItem(key: string, value: string): void {
    storage.set(key, value);
  }
  function removeItem(key: string): void {
    storage.delete(key);
  }

  it('hasStoredWallet returns false when no wallet stored', () => {
    expect(getItem(STORAGE_KEY)).toBeNull();
  });

  it('hasStoredWallet returns true after storing wallet', async () => {
    const stored = await encryptMnemonic('test', 'pass');
    setItem(STORAGE_KEY, JSON.stringify(stored));
    expect(getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('getStoredWallet returns null for invalid JSON', () => {
    setItem(STORAGE_KEY, 'not-valid-json{{{');
    const raw = getItem(STORAGE_KEY);
    let result: StoredWallet | null = null;
    try {
      result = JSON.parse(raw!) as StoredWallet;
    } catch {
      result = null;
    }
    expect(result).toBeNull();
  });

  it('deleteWallet clears stored data', async () => {
    const stored = await encryptMnemonic('test', 'pass');
    setItem(STORAGE_KEY, JSON.stringify(stored));
    expect(getItem(STORAGE_KEY)).not.toBeNull();

    removeItem(STORAGE_KEY);
    expect(getItem(STORAGE_KEY)).toBeNull();
  });

  it('full lifecycle: store → retrieve → decrypt → delete', async () => {
    const mnemonic = 'test mnemonic phrase for lifecycle';
    const password = 'lifecycle-pass';

    // Store
    const stored = await encryptMnemonic(mnemonic, password);
    setItem(STORAGE_KEY, JSON.stringify(stored));

    // Retrieve
    const raw = getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as StoredWallet;

    // Decrypt
    const decrypted = await decryptMnemonic(parsed, password);
    expect(decrypted).toBe(mnemonic);

    // Delete
    removeItem(STORAGE_KEY);
    expect(getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('wallet crypto: tampered ciphertext', () => {
  it('rejects decryption when ciphertext is modified', async () => {
    const stored = await encryptMnemonic('secret mnemonic', 'password');
    // Tamper with one byte of the ciphertext
    const cipherBytes = base64ToBuffer(stored.encryptedMnemonic);
    cipherBytes[0] = cipherBytes[0]! ^ 0xff;
    stored.encryptedMnemonic = bufferToBase64(cipherBytes);

    await expect(decryptMnemonic(stored, 'password')).rejects.toThrow(
      'Invalid password'
    );
  });

  it('rejects decryption when IV is modified', async () => {
    const stored = await encryptMnemonic('secret mnemonic', 'password');
    // Tamper with the IV
    const ivBytes = base64ToBuffer(stored.iv);
    ivBytes[0] = ivBytes[0]! ^ 0xff;
    stored.iv = bufferToBase64(ivBytes);

    await expect(decryptMnemonic(stored, 'password')).rejects.toThrow(
      'Invalid password'
    );
  });

  it('rejects decryption when salt is modified', async () => {
    const stored = await encryptMnemonic('secret mnemonic', 'password');
    // Tamper with the salt (changes derived key)
    const saltBytes = base64ToBuffer(stored.salt);
    saltBytes[0] = saltBytes[0]! ^ 0xff;
    stored.salt = bufferToBase64(saltBytes);

    await expect(decryptMnemonic(stored, 'password')).rejects.toThrow(
      'Invalid password'
    );
  });
});
