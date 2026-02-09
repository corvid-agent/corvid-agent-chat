/**
 * IndexedDB message persistence
 * Stores chat messages per agent connection, survives page refresh
 */
import type { ChatMessage } from './types.ts';

const DB_NAME = 'corvid-chat';
const DB_VERSION = 1;
const MESSAGES_STORE = 'messages';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open (or create) the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        const store = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
        // Index by agent address for per-contact queries
        store.createIndex('agentAddress', 'agentAddress', { unique: false });
        // Index by timestamp for sorted retrieval
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

/** Stored message with agent address key */
interface StoredMessage {
  id: string;
  agentAddress: string;
  content: string;
  direction: 'sent' | 'received';
  timestamp: number; // epoch ms (IndexedDB can't sort Date objects reliably)
  status: ChatMessage['status'];
  txid?: string;
}

function toStored(msg: ChatMessage, agentAddress: string): StoredMessage {
  return {
    id: msg.id,
    agentAddress,
    content: msg.content,
    direction: msg.direction,
    timestamp: msg.timestamp.getTime(),
    status: msg.status,
    txid: msg.txid,
  };
}

function fromStored(stored: StoredMessage): ChatMessage {
  return {
    id: stored.id,
    content: stored.content,
    direction: stored.direction,
    timestamp: new Date(stored.timestamp),
    status: stored.status,
    txid: stored.txid,
  };
}

/**
 * Save a message to IndexedDB
 */
export async function saveMessage(
  msg: ChatMessage,
  agentAddress: string
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(MESSAGES_STORE, 'readwrite');
    const store = tx.objectStore(MESSAGES_STORE);
    store.put(toStored(msg, agentAddress));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to save message to IndexedDB:', err);
  }
}

/**
 * Update a message's status (and optionally txid)
 */
export async function updateMessageStatus(
  id: string,
  status: ChatMessage['status'],
  txid?: string
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(MESSAGES_STORE, 'readwrite');
    const store = tx.objectStore(MESSAGES_STORE);

    const existing = await new Promise<StoredMessage | undefined>(
      (resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result as StoredMessage | undefined);
        req.onerror = () => reject(req.error);
      }
    );

    if (existing) {
      existing.status = status;
      if (txid) existing.txid = txid;
      store.put(existing);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to update message status in IndexedDB:', err);
  }
}

/**
 * Load all messages for an agent, sorted by timestamp
 */
export async function loadMessages(
  agentAddress: string
): Promise<ChatMessage[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(MESSAGES_STORE, 'readonly');
    const store = tx.objectStore(MESSAGES_STORE);
    const index = store.index('agentAddress');

    const stored = await new Promise<StoredMessage[]>((resolve, reject) => {
      const req = index.getAll(agentAddress);
      req.onsuccess = () => resolve(req.result as StoredMessage[]);
      req.onerror = () => reject(req.error);
    });

    return stored
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(fromStored);
  } catch (err) {
    console.error('Failed to load messages from IndexedDB:', err);
    return [];
  }
}

/**
 * Delete all messages for an agent
 */
export async function clearMessages(agentAddress: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(MESSAGES_STORE, 'readwrite');
    const store = tx.objectStore(MESSAGES_STORE);
    const index = store.index('agentAddress');

    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const req = index.getAllKeys(agentAddress);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    for (const key of keys) {
      store.delete(key);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to clear messages in IndexedDB:', err);
  }
}

/**
 * Delete the entire database (used in "delete all data")
 */
export async function deleteDatabase(): Promise<void> {
  try {
    // Close existing connection
    if (dbPromise) {
      const db = await dbPromise;
      db.close();
      dbPromise = null;
    }
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to delete IndexedDB:', err);
  }
}
