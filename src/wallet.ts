/**
 * Wallet management with encrypted storage
 * Uses Web Crypto API: AES-GCM + PBKDF2
 */
import algosdk from 'algosdk';
import {
  createChatAccountFromMnemonic,
  createRandomChatAccount,
  type ChatAccount,
} from '@corvidlabs/ts-algochat';
import type { StoredWallet } from './types.ts';
import { bufferToBase64, base64ToBuffer } from './utils.ts';

const STORAGE_KEY = 'corvid-wallet';
const PBKDF2_ITERATIONS = 600_000;

let currentAccount: ChatAccount | null = null;

/**
 * Get the current unlocked ChatAccount
 */
export function getAccount(): ChatAccount | null {
  return currentAccount;
}

/**
 * Create a new random wallet
 */
export async function createWallet(password: string): Promise<ChatAccount> {
  const { account, mnemonic } = createRandomChatAccount();
  await storeEncrypted(mnemonic, account.address, password);
  currentAccount = account;
  return account;
}

/**
 * Import wallet from mnemonic
 */
export async function importWallet(
  mnemonic: string,
  password: string
): Promise<ChatAccount> {
  // Validate mnemonic by creating account
  const account = createChatAccountFromMnemonic(mnemonic.trim());
  await storeEncrypted(mnemonic.trim(), account.address, password);
  currentAccount = account;
  return account;
}

/**
 * Unlock stored wallet with password
 */
export async function unlockWallet(password: string): Promise<ChatAccount> {
  const stored = getStoredWallet();
  if (!stored) {
    throw new Error('No wallet stored');
  }

  const mnemonic = await decryptMnemonic(stored, password);
  const account = createChatAccountFromMnemonic(mnemonic);
  currentAccount = account;
  return account;
}

/**
 * Lock wallet (clear from memory)
 */
export function lockWallet(): void {
  currentAccount = null;
}

/**
 * Check if a wallet is stored
 */
export function hasStoredWallet(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/**
 * Get stored wallet metadata (without decrypting)
 */
export function getStoredWallet(): StoredWallet | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredWallet;
  } catch {
    return null;
  }
}

/**
 * Delete stored wallet
 */
export function deleteWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
  currentAccount = null;
}

/**
 * Export mnemonic (requires password)
 */
export async function exportMnemonic(password: string): Promise<string> {
  const stored = getStoredWallet();
  if (!stored) throw new Error('No wallet stored');
  return decryptMnemonic(stored, password);
}

// ── Crypto helpers ──

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

async function storeEncrypted(
  mnemonic: string,
  address: string,
  password: string
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    enc.encode(mnemonic)
  );

  const stored: StoredWallet = {
    encryptedMnemonic: bufferToBase64(new Uint8Array(encrypted)),
    address,
    iv: bufferToBase64(iv),
    salt: bufferToBase64(salt),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
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
