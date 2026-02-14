/**
 * Core types for the AlgoChat client
 */

export interface AgentConnection {
  address: string;
  psk: Uint8Array;
  label: string;
  network: 'mainnet' | 'testnet';
  publicKey?: Uint8Array;
  addedAt: number;
}

export interface StoredWallet {
  encryptedMnemonic: string; // AES-GCM encrypted
  address: string;
  iv: string; // Base64-encoded IV
  salt: string; // Base64-encoded salt for PBKDF2
}

export interface ChatMessage {
  id: string;
  content: string;
  direction: 'sent' | 'received';
  timestamp: Date;
  status: 'sending' | 'sent' | 'confirmed' | 'failed';
  txid?: string;
  deviceName?: string;
}

export interface AppState {
  view: 'setup' | 'scan' | 'chat' | 'settings';
  wallet: WalletState;
  agent: AgentState;
  chat: ChatState;
}

export interface WalletState {
  address: string | null;
  unlocked: boolean;
  balance: number; // microAlgos
}

export interface AgentState {
  connection: AgentConnection | null;
  online: boolean;
  lastSeen: number | null;
}

export interface ChatState {
  messages: ChatMessage[];
  polling: boolean;
  sending: boolean;
}

export type AppView = AppState['view'];
