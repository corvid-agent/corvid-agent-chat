/**
 * Simple reactive state store
 */
import type { AppState, AppView, ChatMessage, AgentConnection } from './types.ts';

type Listener = () => void;

const initialState: AppState = {
  view: 'setup',
  wallet: {
    address: null,
    unlocked: false,
    balance: 0,
  },
  agent: {
    connection: null,
    online: false,
    lastSeen: null,
  },
  chat: {
    messages: [],
    polling: false,
    sending: false,
  },
};

class Store {
  private state: AppState = { ...initialState };
  private listeners: Set<Listener> = new Set();

  getState(): Readonly<AppState> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  setView(view: AppView) {
    this.state = { ...this.state, view };
    this.notify();
  }

  setWallet(address: string) {
    this.state = {
      ...this.state,
      wallet: { ...this.state.wallet, address, unlocked: true },
    };
    this.notify();
  }

  setBalance(balance: number) {
    this.state = {
      ...this.state,
      wallet: { ...this.state.wallet, balance },
    };
    this.notify();
  }

  lockWallet() {
    this.state = {
      ...this.state,
      wallet: { address: null, unlocked: false, balance: 0 },
      view: 'setup',
    };
    this.notify();
  }

  setAgentConnection(connection: AgentConnection) {
    this.state = {
      ...this.state,
      agent: { ...this.state.agent, connection, online: false },
    };
    this.notify();
  }

  setAgentOnline(online: boolean) {
    this.state = {
      ...this.state,
      agent: {
        ...this.state.agent,
        online,
        lastSeen: online ? Date.now() : this.state.agent.lastSeen,
      },
    };
    this.notify();
  }

  clearAgent() {
    this.state = {
      ...this.state,
      agent: { connection: null, online: false, lastSeen: null },
      chat: { messages: [], polling: false, sending: false },
    };
    this.notify();
  }

  addMessage(message: ChatMessage): boolean {
    // Deduplicate by id or by txid (prevents optimistic + polled duplicates)
    const existing = this.state.chat.messages.find(
      (m) => m.id === message.id || (message.txid && m.txid === message.txid)
    );
    if (existing) return false;

    this.state = {
      ...this.state,
      chat: {
        ...this.state.chat,
        messages: [...this.state.chat.messages, message].sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        ),
      },
    };
    this.notify();
    return true;
  }

  updateMessageStatus(id: string, status: ChatMessage['status'], txid?: string) {
    this.state = {
      ...this.state,
      chat: {
        ...this.state.chat,
        messages: this.state.chat.messages.map((m) =>
          m.id === id ? { ...m, status, txid: txid ?? m.txid } : m
        ),
      },
    };
    this.notify();
  }

  setPolling(polling: boolean) {
    this.state = {
      ...this.state,
      chat: { ...this.state.chat, polling },
    };
    this.notify();
  }

  setSending(sending: boolean) {
    this.state = {
      ...this.state,
      chat: { ...this.state.chat, sending },
    };
    this.notify();
  }

  clearMessages() {
    this.state = {
      ...this.state,
      chat: { ...this.state.chat, messages: [] },
    };
    this.notify();
  }
}

export const store = new Store();
