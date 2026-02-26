/**
 * Tests for IndexedDB message persistence layer
 * Uses fake-indexeddb to provide an in-memory IndexedDB implementation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  saveMessage,
  loadMessages,
  updateMessageStatus,
  clearMessages,
  deleteDatabase,
} from './db.ts';
import type { ChatMessage } from './types.ts';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    content: 'Hello test',
    direction: 'sent',
    timestamp: new Date(),
    status: 'confirmed',
    ...overrides,
  };
}

// Reset IndexedDB between tests to avoid cross-contamination
afterEach(async () => {
  await deleteDatabase();
});

describe('saveMessage + loadMessages', () => {
  const AGENT_ADDR = 'AGENTADDRESS1';

  it('saves and loads a single message', async () => {
    const msg = makeMessage({ id: 'test-1', content: 'Hi there' });
    await saveMessage(msg, AGENT_ADDR);

    const loaded = await loadMessages(AGENT_ADDR);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe('test-1');
    expect(loaded[0]!.content).toBe('Hi there');
    expect(loaded[0]!.direction).toBe('sent');
    expect(loaded[0]!.status).toBe('confirmed');
  });

  it('preserves timestamp through Date→number→Date conversion', async () => {
    const timestamp = new Date(2026, 0, 15, 14, 30, 45);
    const msg = makeMessage({ id: 'ts-test', timestamp });
    await saveMessage(msg, AGENT_ADDR);

    const loaded = await loadMessages(AGENT_ADDR);
    expect(loaded[0]!.timestamp).toBeInstanceOf(Date);
    expect(loaded[0]!.timestamp.getTime()).toBe(timestamp.getTime());
  });

  it('saves and loads multiple messages in timestamp order', async () => {
    const msg1 = makeMessage({
      id: 'first',
      content: 'First',
      timestamp: new Date(2026, 0, 1, 10, 0),
    });
    const msg3 = makeMessage({
      id: 'third',
      content: 'Third',
      timestamp: new Date(2026, 0, 1, 12, 0),
    });
    const msg2 = makeMessage({
      id: 'second',
      content: 'Second',
      timestamp: new Date(2026, 0, 1, 11, 0),
    });

    // Insert out of order
    await saveMessage(msg3, AGENT_ADDR);
    await saveMessage(msg1, AGENT_ADDR);
    await saveMessage(msg2, AGENT_ADDR);

    const loaded = await loadMessages(AGENT_ADDR);
    expect(loaded).toHaveLength(3);
    expect(loaded[0]!.id).toBe('first');
    expect(loaded[1]!.id).toBe('second');
    expect(loaded[2]!.id).toBe('third');
  });

  it('isolates messages by agent address', async () => {
    const AGENT_A = 'AGENT_A_ADDR';
    const AGENT_B = 'AGENT_B_ADDR';

    await saveMessage(makeMessage({ id: 'a1', content: 'For A' }), AGENT_A);
    await saveMessage(makeMessage({ id: 'b1', content: 'For B' }), AGENT_B);
    await saveMessage(makeMessage({ id: 'a2', content: 'Also for A' }), AGENT_A);

    const msgsA = await loadMessages(AGENT_A);
    const msgsB = await loadMessages(AGENT_B);

    expect(msgsA).toHaveLength(2);
    expect(msgsB).toHaveLength(1);
    expect(msgsA.map((m) => m.id)).toContain('a1');
    expect(msgsA.map((m) => m.id)).toContain('a2');
    expect(msgsB[0]!.id).toBe('b1');
  });

  it('returns empty array for unknown agent address', async () => {
    const loaded = await loadMessages('NONEXISTENT');
    expect(loaded).toEqual([]);
  });

  it('preserves optional fields (txid, deviceName)', async () => {
    const msg = makeMessage({
      id: 'opt-fields',
      txid: 'TXID123',
      deviceName: 'iPhone',
    });
    await saveMessage(msg, AGENT_ADDR);

    const loaded = await loadMessages(AGENT_ADDR);
    expect(loaded[0]!.txid).toBe('TXID123');
    expect(loaded[0]!.deviceName).toBe('iPhone');
  });

  it('preserves attachment data', async () => {
    const msg = makeMessage({
      id: 'attach-test',
      attachment: {
        type: 'image',
        mimeType: 'image/png',
        fileName: 'screenshot.png',
        size: 1024,
        base64: 'iVBORw0KGgo=',
      },
    });
    await saveMessage(msg, AGENT_ADDR);

    const loaded = await loadMessages(AGENT_ADDR);
    expect(loaded[0]!.attachment).toBeDefined();
    expect(loaded[0]!.attachment!.type).toBe('image');
    expect(loaded[0]!.attachment!.fileName).toBe('screenshot.png');
    expect(loaded[0]!.attachment!.base64).toBe('iVBORw0KGgo=');
  });

  it('handles put (upsert) for duplicate message id', async () => {
    const msg = makeMessage({ id: 'dup-1', content: 'Original' });
    await saveMessage(msg, AGENT_ADDR);

    // Save again with updated content (put = upsert)
    const updated = { ...msg, content: 'Updated' };
    await saveMessage(updated, AGENT_ADDR);

    const loaded = await loadMessages(AGENT_ADDR);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.content).toBe('Updated');
  });
});

describe('updateMessageStatus', () => {
  const AGENT_ADDR = 'AGENTADDRESS2';

  it('updates status from sending to confirmed', async () => {
    const msg = makeMessage({ id: 'status-1', status: 'sending' });
    await saveMessage(msg, AGENT_ADDR);

    await updateMessageStatus('status-1', 'confirmed', 'TX_HASH_123');

    const loaded = await loadMessages(AGENT_ADDR);
    expect(loaded[0]!.status).toBe('confirmed');
    expect(loaded[0]!.txid).toBe('TX_HASH_123');
  });

  it('updates status from sending to failed', async () => {
    const msg = makeMessage({ id: 'status-2', status: 'sending' });
    await saveMessage(msg, AGENT_ADDR);

    await updateMessageStatus('status-2', 'failed');

    const loaded = await loadMessages(AGENT_ADDR);
    expect(loaded[0]!.status).toBe('failed');
  });

  it('does not crash for nonexistent message id', async () => {
    // Should silently succeed (no-op)
    await expect(
      updateMessageStatus('nonexistent', 'confirmed')
    ).resolves.toBeUndefined();
  });

  it('preserves existing txid when new txid is not provided', async () => {
    const msg = makeMessage({
      id: 'keep-txid',
      status: 'sending',
      txid: 'ORIGINAL_TX',
    });
    await saveMessage(msg, AGENT_ADDR);

    await updateMessageStatus('keep-txid', 'confirmed');

    const loaded = await loadMessages(AGENT_ADDR);
    expect(loaded[0]!.txid).toBe('ORIGINAL_TX');
  });
});

describe('clearMessages', () => {
  it('clears all messages for a specific agent', async () => {
    const AGENT = 'CLEAR_AGENT';
    await saveMessage(makeMessage({ id: 'c1' }), AGENT);
    await saveMessage(makeMessage({ id: 'c2' }), AGENT);
    await saveMessage(makeMessage({ id: 'c3' }), AGENT);

    let loaded = await loadMessages(AGENT);
    expect(loaded).toHaveLength(3);

    await clearMessages(AGENT);

    loaded = await loadMessages(AGENT);
    expect(loaded).toEqual([]);
  });

  it('does not affect messages for other agents', async () => {
    const AGENT_A = 'CLEAR_A';
    const AGENT_B = 'CLEAR_B';

    await saveMessage(makeMessage({ id: 'a1' }), AGENT_A);
    await saveMessage(makeMessage({ id: 'b1' }), AGENT_B);

    await clearMessages(AGENT_A);

    const msgsA = await loadMessages(AGENT_A);
    const msgsB = await loadMessages(AGENT_B);
    expect(msgsA).toEqual([]);
    expect(msgsB).toHaveLength(1);
  });

  it('handles clearing an already empty agent', async () => {
    await expect(clearMessages('EMPTY_AGENT')).resolves.toBeUndefined();
  });
});

describe('deleteDatabase', () => {
  it('removes all data across all agents', async () => {
    await saveMessage(makeMessage({ id: 'd1' }), 'AGENT_X');
    await saveMessage(makeMessage({ id: 'd2' }), 'AGENT_Y');

    await deleteDatabase();

    // After deletion, loadMessages should work (re-creates the DB)
    const msgsX = await loadMessages('AGENT_X');
    const msgsY = await loadMessages('AGENT_Y');
    expect(msgsX).toEqual([]);
    expect(msgsY).toEqual([]);
  });
});

describe('message direction handling', () => {
  const AGENT_ADDR = 'DIR_AGENT';

  it('preserves sent direction', async () => {
    await saveMessage(makeMessage({ id: 'dir-sent', direction: 'sent' }), AGENT_ADDR);
    const loaded = await loadMessages(AGENT_ADDR);
    expect(loaded[0]!.direction).toBe('sent');
  });

  it('preserves received direction', async () => {
    await saveMessage(makeMessage({ id: 'dir-recv', direction: 'received' }), AGENT_ADDR);
    const loaded = await loadMessages(AGENT_ADDR);
    expect(loaded[0]!.direction).toBe('received');
  });
});
