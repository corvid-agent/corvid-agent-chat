import { describe, it, expect, beforeEach } from 'vitest';

// We need to test the Store class, but it's exported as a singleton.
// We'll import and test the singleton, resetting between tests.
// Since we can't easily create new instances, we'll test the exported store.

// Store is a singleton, so we need to work around that.
// Let's import it and use lockWallet to reset between tests.
import { store } from './store.ts';
import type { ChatMessage, AgentConnection } from './types.ts';

describe('Store', () => {
  beforeEach(() => {
    // Reset to initial state
    store.lockWallet();
    store.clearAgent();
  });

  describe('view management', () => {
    it('starts at setup view after reset', () => {
      expect(store.getState().view).toBe('setup');
    });

    it('changes view', () => {
      store.setView('chat');
      expect(store.getState().view).toBe('chat');
    });

    it('notifies subscribers on view change', () => {
      let called = false;
      const unsub = store.subscribe(() => {
        called = true;
      });
      store.setView('scan');
      expect(called).toBe(true);
      unsub();
    });
  });

  describe('wallet management', () => {
    it('sets wallet address and unlocked state', () => {
      store.setWallet('TESTADDR123');
      const state = store.getState();
      expect(state.wallet.address).toBe('TESTADDR123');
      expect(state.wallet.unlocked).toBe(true);
    });

    it('sets balance', () => {
      store.setBalance(5_000_000);
      expect(store.getState().wallet.balance).toBe(5_000_000);
    });

    it('locks wallet and resets state', () => {
      store.setWallet('ADDR');
      store.setBalance(1000);
      store.lockWallet();

      const state = store.getState();
      expect(state.wallet.address).toBeNull();
      expect(state.wallet.unlocked).toBe(false);
      expect(state.wallet.balance).toBe(0);
      expect(state.view).toBe('setup');
    });
  });

  describe('agent management', () => {
    const mockConnection: AgentConnection = {
      address: 'AGENTADDR',
      psk: new Uint8Array([1, 2, 3]),
      label: 'Test Agent',
      network: 'testnet',
      addedAt: Date.now(),
    };

    it('sets agent connection', () => {
      store.setAgentConnection(mockConnection);
      const state = store.getState();
      expect(state.agent.connection).toEqual(mockConnection);
      expect(state.agent.online).toBe(false);
    });

    it('sets agent online status', () => {
      store.setAgentOnline(true);
      expect(store.getState().agent.online).toBe(true);
    });

    it('updates lastSeen when going online', () => {
      store.setAgentOnline(true);
      expect(store.getState().agent.lastSeen).not.toBeNull();
    });

    it('clears agent and messages', () => {
      store.setAgentConnection(mockConnection);
      store.addMessage({
        id: 'msg1',
        content: 'test',
        direction: 'sent',
        timestamp: new Date(),
        status: 'confirmed',
      });

      store.clearAgent();
      const state = store.getState();
      expect(state.agent.connection).toBeNull();
      expect(state.chat.messages).toHaveLength(0);
    });
  });

  describe('message management', () => {
    const createMsg = (id: string, ts: number): ChatMessage => ({
      id,
      content: `Message ${id}`,
      direction: 'sent',
      timestamp: new Date(ts),
      status: 'confirmed',
    });

    it('adds messages', () => {
      store.addMessage(createMsg('1', 1000));
      expect(store.getState().chat.messages).toHaveLength(1);
    });

    it('deduplicates by id', () => {
      const msg = createMsg('1', 1000);
      store.addMessage(msg);
      store.addMessage(msg);
      expect(store.getState().chat.messages).toHaveLength(1);
    });

    it('sorts messages by timestamp', () => {
      store.addMessage(createMsg('b', 2000));
      store.addMessage(createMsg('a', 1000));
      store.addMessage(createMsg('c', 3000));

      const messages = store.getState().chat.messages;
      expect(messages[0]!.id).toBe('a');
      expect(messages[1]!.id).toBe('b');
      expect(messages[2]!.id).toBe('c');
    });

    it('updates message status', () => {
      store.addMessage(createMsg('1', 1000));
      store.updateMessageStatus('1', 'failed');
      expect(store.getState().chat.messages[0]!.status).toBe('failed');
    });

    it('updates message txid', () => {
      store.addMessage(createMsg('1', 1000));
      store.updateMessageStatus('1', 'confirmed', 'TX123');
      expect(store.getState().chat.messages[0]!.txid).toBe('TX123');
    });

    it('clears messages', () => {
      store.addMessage(createMsg('1', 1000));
      store.addMessage(createMsg('2', 2000));
      store.clearMessages();
      expect(store.getState().chat.messages).toHaveLength(0);
    });
  });

  describe('chat flags', () => {
    it('sets polling flag', () => {
      store.setPolling(true);
      expect(store.getState().chat.polling).toBe(true);
      store.setPolling(false);
      expect(store.getState().chat.polling).toBe(false);
    });

    it('sets sending flag', () => {
      store.setSending(true);
      expect(store.getState().chat.sending).toBe(true);
      store.setSending(false);
      expect(store.getState().chat.sending).toBe(false);
    });
  });

  describe('subscriptions', () => {
    it('can unsubscribe', () => {
      let count = 0;
      const unsub = store.subscribe(() => count++);
      store.setView('chat');
      expect(count).toBe(1);

      unsub();
      store.setView('settings');
      expect(count).toBe(1);
    });

    it('supports multiple subscribers', () => {
      let count1 = 0;
      let count2 = 0;
      const unsub1 = store.subscribe(() => count1++);
      const unsub2 = store.subscribe(() => count2++);

      store.setView('chat');
      expect(count1).toBe(1);
      expect(count2).toBe(1);

      unsub1();
      unsub2();
    });
  });
});
