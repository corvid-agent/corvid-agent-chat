/**
 * Unit tests for the chat view — rendering, send message, search, and interactions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentConnection, ChatMessage } from '../types.ts';

// jsdom does not implement scrollIntoView — stub it globally
Element.prototype.scrollIntoView = vi.fn();

// ── Hoisted mocks ──

const {
  fakeConnection,
  defaultStoreState,
  mockStore,
  mockMessaging,
  mockWallet,
  mockToast,
  mockDb,
  mockDeviceName,
} = vi.hoisted(() => {
  const fakeConnection: AgentConnection = {
    address: 'AGENTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEF',
    psk: new Uint8Array(32),
    label: 'TestAgent',
    network: 'testnet',
    addedAt: Date.now(),
  };

  const defaultStoreState = (): {
    view: string;
    wallet: { address: string | null; unlocked: boolean; balance: number };
    agent: { connection: AgentConnection | null; online: boolean; lastSeen: number | null };
    chat: { messages: ChatMessage[]; polling: boolean; sending: boolean };
  } => ({
    view: 'chat',
    wallet: { address: 'WALLETADDR1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ2345678ABCDEF', unlocked: true, balance: 5_000_000 },
    agent: { connection: fakeConnection, online: true, lastSeen: Date.now() },
    chat: { messages: [], polling: false, sending: false },
  });

  return {
    fakeConnection,
    defaultStoreState,
    mockStore: {
      getState: vi.fn(defaultStoreState),
      setView: vi.fn(),
      setWallet: vi.fn(),
      setAgentConnection: vi.fn(),
      setAgentOnline: vi.fn(),
      setBalance: vi.fn(),
      addMessage: vi.fn(),
      updateMessageStatus: vi.fn(),
      setPolling: vi.fn(),
      setSending: vi.fn(),
    },
    mockMessaging: {
      initialize: vi.fn(),
      onMessage: vi.fn((_cb?: unknown) => vi.fn()),
      onPollError: vi.fn((_cb?: unknown) => vi.fn()),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      checkAgentOnline: vi.fn().mockResolvedValue(true),
      getBalance: vi.fn().mockResolvedValue(5_000_000),
      sendMessage: vi.fn().mockResolvedValue('TXID123'),
      destroy: vi.fn(),
      consecutiveErrors: 0,
    },
    mockWallet: {
      getAccount: vi.fn((): unknown => ({
        address: 'WALLETADDR',
        account: { sk: new Uint8Array(64) },
        encryptionKeys: { publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) },
      })),
    },
    mockToast: { showToast: vi.fn() },
    mockDb: {
      saveMessage: vi.fn(),
      updateMessageStatus: vi.fn(),
      loadMessages: vi.fn().mockResolvedValue([]),
    },
    mockDeviceName: {
      getDeviceName: vi.fn((): string | null => null),
    },
  };
});

vi.mock('../store.ts', () => ({ store: mockStore }));
vi.mock('../messaging.ts', () => ({ messaging: mockMessaging }));
vi.mock('../wallet.ts', () => mockWallet);
vi.mock('../toast.ts', () => mockToast);
vi.mock('../db.ts', () => mockDb);
vi.mock('../device-name.ts', () => mockDeviceName);
vi.mock('../markdown.ts', () => ({
  renderMarkdown: vi.fn((text: string) => text),
}));
vi.mock('../utils.ts', () => ({
  escapeHtml: (s: string) => s,
  shortenAddress: (s: string, a = 6, b = 4) => `${s.slice(0, a)}...${s.slice(-b)}`,
  formatTime: () => '12:00',
  formatDateLabel: () => 'Today',
}));
vi.mock('../file-handler.ts', () => ({
  processFile: vi.fn(),
  createImagePreview: vi.fn(() => document.createElement('div')),
  createFileDownload: vi.fn(() => document.createElement('div')),
  formatFileSize: vi.fn((n: number) => `${n} B`),
  isAcceptedType: vi.fn(() => true),
}));

import { renderChat, bindChatEvents, cleanupChat } from './chat.ts';

// ── Helpers ──

function renderIntoDOM(html: string): void {
  document.body.innerHTML = `<div id="app">${html}</div>`;
}

let messageCallback: ((msg: ChatMessage) => void) | null = null;

function setupChat(): void {
  mockMessaging.onMessage.mockImplementation((cb?: unknown) => {
    messageCallback = cb as (msg: ChatMessage) => void;
    return vi.fn();
  });
  renderIntoDOM(renderChat());
  bindChatEvents();
}

// ── Tests ──

describe('chat view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    document.body.innerHTML = '';
    messageCallback = null;
    mockStore.getState.mockImplementation(defaultStoreState);
  });

  afterEach(() => {
    cleanupChat();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  // ── renderChat ──

  describe('renderChat', () => {
    it('renders the header with agent label and network badge', () => {
      const html = renderChat();
      expect(html).toContain('TestAgent');
      expect(html).toContain('network-badge--testnet');
      expect(html).toContain('testnet');
    });

    it('renders chat input and send button', () => {
      const html = renderChat();
      expect(html).toContain('id="chat-input"');
      expect(html).toContain('id="btn-send"');
    });

    it('renders search bar hidden by default', () => {
      renderIntoDOM(renderChat());
      const searchBar = document.getElementById('search-bar');
      expect(searchBar).toBeTruthy();
      expect(searchBar!.style.display).toBe('none');
    });

    it('renders connection bar', () => {
      const html = renderChat();
      expect(html).toContain('id="connection-bar"');
      expect(html).toContain('Connecting...');
    });

    it('renders wallet badge with shortened address', () => {
      const html = renderChat();
      expect(html).toContain('id="wallet-badge"');
      // shortenAddress called with (addr, 4, 4) — mock uses provided args
      expect(html).toContain('WALL...CDEF');
    });

    it('renders settings and search buttons', () => {
      const html = renderChat();
      expect(html).toContain('id="btn-settings"');
      expect(html).toContain('id="btn-search"');
    });

    it('renders attachment UI elements', () => {
      const html = renderChat();
      expect(html).toContain('id="btn-attach"');
      expect(html).toContain('id="file-input"');
      expect(html).toContain('id="attachment-preview"');
    });
  });

  // ── initialization ──

  describe('initialization', () => {
    it('redirects to setup when account is missing', () => {
      mockWallet.getAccount.mockReturnValueOnce(null);
      renderIntoDOM(renderChat());
      bindChatEvents();

      expect(mockToast.showToast).toHaveBeenCalledWith(
        'Wallet or agent not configured',
        'error'
      );
      expect(mockStore.setView).toHaveBeenCalledWith('setup');
    });

    it('redirects to setup when agent connection is missing', () => {
      mockStore.getState.mockReturnValue({
        ...defaultStoreState(),
        agent: { connection: null, online: false, lastSeen: null },
      });
      renderIntoDOM(renderChat());
      bindChatEvents();

      expect(mockToast.showToast).toHaveBeenCalledWith(
        'Wallet or agent not configured',
        'error'
      );
      expect(mockStore.setView).toHaveBeenCalledWith('setup');
    });

    it('initializes messaging service with account and connection', () => {
      setupChat();

      expect(mockMessaging.initialize).toHaveBeenCalledWith(
        expect.any(Object),
        fakeConnection
      );
    });

    it('starts polling and subscribes to messages', () => {
      setupChat();

      expect(mockMessaging.startPolling).toHaveBeenCalled();
      expect(mockStore.setPolling).toHaveBeenCalledWith(true);
      expect(mockMessaging.onMessage).toHaveBeenCalled();
    });
  });

  // ── send message ──

  describe('send message flow', () => {
    it('send button is disabled by default', () => {
      setupChat();
      const btn = document.getElementById('btn-send')!;
      expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('enables send button when text is entered', () => {
      setupChat();
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;
      const btn = document.getElementById('btn-send')!;

      input.value = 'Hello';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(btn.hasAttribute('disabled')).toBe(false);
    });

    it('disables send button when text is cleared', () => {
      setupChat();
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;
      const btn = document.getElementById('btn-send')!;

      input.value = 'Hello';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(btn.hasAttribute('disabled')).toBe(false);

      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('sends message on button click', async () => {
      setupChat();
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;
      const btn = document.getElementById('btn-send')!;

      input.value = 'Hello agent';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      btn.click();

      await vi.waitFor(() => {
        expect(mockMessaging.sendMessage).toHaveBeenCalledWith('Hello agent', undefined);
        expect(mockStore.addMessage).toHaveBeenCalled();
        expect(mockStore.setSending).toHaveBeenCalledWith(true);
      });
    });

    it('sends message on Enter key', async () => {
      setupChat();
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;

      input.value = 'Enter message';
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );

      await vi.waitFor(() => {
        expect(mockMessaging.sendMessage).toHaveBeenCalledWith('Enter message', undefined);
      });
    });

    it('does not send on Shift+Enter (allows newline)', () => {
      setupChat();
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;

      input.value = 'Multi-line';
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          shiftKey: true,
          bubbles: true,
        })
      );

      expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
    });

    it('does not send when input is empty', () => {
      setupChat();
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;
      const btn = document.getElementById('btn-send')!;

      input.value = '';
      btn.click();

      expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
    });

    it('clears input after sending', async () => {
      setupChat();
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;

      input.value = 'Will be cleared';
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );

      await vi.waitFor(() => {
        expect(input.value).toBe('');
      });
    });

    it('shows error toast on send failure', async () => {
      mockMessaging.sendMessage.mockRejectedValueOnce(
        new Error('Insufficient funds')
      );

      setupChat();
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;

      input.value = 'Will fail';
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );

      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith(
          'Send failed: Insufficient funds',
          'error'
        );
      });
    });

    it('adds optimistic message to the DOM on send', async () => {
      setupChat();
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;

      input.value = 'Optimistic message';
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );

      await vi.waitFor(() => {
        const output = document.getElementById('chat-output')!;
        expect(output.querySelectorAll('.msg--outbound').length).toBe(1);
      });
    });
  });

  // ── search feature ──

  describe('search feature', () => {
    it('opens search bar on search button click', () => {
      setupChat();
      const btn = document.getElementById('btn-search')!;
      const searchBar = document.getElementById('search-bar')!;

      btn.click();

      expect(searchBar.style.display).toBe('');
    });

    it('closes search bar on second click (toggle)', () => {
      setupChat();
      const btn = document.getElementById('btn-search')!;
      const searchBar = document.getElementById('search-bar')!;

      btn.click(); // open
      btn.click(); // close

      expect(searchBar.style.display).toBe('none');
    });

    it('closes search bar via close button', () => {
      setupChat();
      document.getElementById('btn-search')!.click();

      document.getElementById('search-close')!.click();

      expect(document.getElementById('search-bar')!.style.display).toBe('none');
    });

    it('closes search on Escape key in search input', () => {
      setupChat();
      document.getElementById('btn-search')!.click();

      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      searchInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );

      expect(document.getElementById('search-bar')!.style.display).toBe('none');
    });

    it('opens search on Ctrl+F', () => {
      setupChat();
      const searchBar = document.getElementById('search-bar')!;

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })
      );

      expect(searchBar.style.display).toBe('');
    });

    it('shows "No matches" when search has no results', () => {
      setupChat();

      document.getElementById('btn-search')!.click();
      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      searchInput.value = 'nonexistent';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      vi.advanceTimersByTime(200);

      const searchCount = document.getElementById('search-count')!;
      expect(searchCount.textContent).toBe('No matches');
    });

    it('highlights matching messages in search results', () => {
      const msg: ChatMessage = {
        id: 'msg-1',
        content: 'Hello from agent',
        direction: 'received',
        timestamp: new Date(),
        status: 'confirmed',
      };
      mockStore.getState.mockReturnValue({
        ...defaultStoreState(),
        chat: { messages: [msg], polling: false, sending: false },
      });
      setupChat();

      // Add a message element that matches the store's message
      const output = document.getElementById('chat-output')!;
      const msgEl = document.createElement('div');
      msgEl.className = 'msg msg--inbound';
      msgEl.id = 'msg-msg-1';
      msgEl.innerHTML = '<span class="msg__text">Hello from agent</span>';
      output.appendChild(msgEl);

      document.getElementById('btn-search')!.click();
      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      searchInput.value = 'Hello';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      vi.advanceTimersByTime(200);

      const searchCount = document.getElementById('search-count')!;
      expect(searchCount.textContent).toBe('1 of 1 match');
      expect(msgEl.classList.contains('msg--search-match')).toBe(true);
      expect(msgEl.classList.contains('msg--search-active')).toBe(true);
    });

    it('shows correct count with multiple matches', () => {
      const msgs: ChatMessage[] = [
        { id: 'msg-1', content: 'Hello world', direction: 'received', timestamp: new Date(), status: 'confirmed' },
        { id: 'msg-2', content: 'Hello again', direction: 'sent', timestamp: new Date(), status: 'confirmed' },
        { id: 'msg-3', content: 'Goodbye', direction: 'received', timestamp: new Date(), status: 'confirmed' },
      ];
      mockStore.getState.mockReturnValue({
        ...defaultStoreState(),
        chat: { messages: msgs, polling: false, sending: false },
      });
      setupChat();

      const output = document.getElementById('chat-output')!;
      for (const msg of msgs) {
        const el = document.createElement('div');
        el.className = 'msg';
        el.id = `msg-${msg.id}`;
        el.innerHTML = `<span class="msg__text">${msg.content}</span>`;
        output.appendChild(el);
      }

      document.getElementById('btn-search')!.click();
      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      searchInput.value = 'Hello';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      vi.advanceTimersByTime(200);

      const searchCount = document.getElementById('search-count')!;
      expect(searchCount.textContent).toBe('1 of 2 matches');
    });

    it('navigates between matches with Enter key', () => {
      const msgs: ChatMessage[] = [
        { id: 'msg-1', content: 'Hello world', direction: 'received', timestamp: new Date(), status: 'confirmed' },
        { id: 'msg-2', content: 'Hello again', direction: 'sent', timestamp: new Date(), status: 'confirmed' },
      ];
      mockStore.getState.mockReturnValue({
        ...defaultStoreState(),
        chat: { messages: msgs, polling: false, sending: false },
      });
      setupChat();

      const output = document.getElementById('chat-output')!;
      for (const msg of msgs) {
        const el = document.createElement('div');
        el.className = 'msg';
        el.id = `msg-${msg.id}`;
        el.innerHTML = `<span class="msg__text">${msg.content}</span>`;
        output.appendChild(el);
      }

      document.getElementById('btn-search')!.click();
      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      searchInput.value = 'Hello';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(200);

      expect(document.getElementById('search-count')!.textContent).toBe('1 of 2 matches');

      // Enter goes to next match
      searchInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
      expect(document.getElementById('search-count')!.textContent).toBe('2 of 2 matches');

      // Shift+Enter goes to previous
      searchInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
      );
      expect(document.getElementById('search-count')!.textContent).toBe('1 of 2 matches');
    });

    it('clears highlights when search is closed', () => {
      const msg: ChatMessage = {
        id: 'msg-1',
        content: 'Hello from agent',
        direction: 'received',
        timestamp: new Date(),
        status: 'confirmed',
      };
      mockStore.getState.mockReturnValue({
        ...defaultStoreState(),
        chat: { messages: [msg], polling: false, sending: false },
      });
      setupChat();

      const output = document.getElementById('chat-output')!;
      const msgEl = document.createElement('div');
      msgEl.className = 'msg';
      msgEl.id = 'msg-msg-1';
      msgEl.innerHTML = '<span class="msg__text">Hello from agent</span>';
      output.appendChild(msgEl);

      document.getElementById('btn-search')!.click();
      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      searchInput.value = 'Hello';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(200);

      expect(msgEl.classList.contains('msg--search-match')).toBe(true);

      document.getElementById('search-close')!.click();

      expect(msgEl.classList.contains('msg--search-match')).toBe(false);
    });
  });

  // ── navigation ──

  describe('navigation', () => {
    it('navigates to settings on settings button click', () => {
      setupChat();
      document.getElementById('btn-settings')!.click();
      expect(mockStore.setView).toHaveBeenCalledWith('settings');
    });
  });

  // ── incoming messages ──

  describe('incoming messages', () => {
    it('appends received messages to the DOM', () => {
      setupChat();

      expect(messageCallback).not.toBeNull();

      const msg: ChatMessage = {
        id: 'incoming-1',
        content: 'Agent response',
        direction: 'received',
        timestamp: new Date(),
        status: 'confirmed',
      };

      messageCallback!(msg);

      const output = document.getElementById('chat-output')!;
      const inbound = output.querySelectorAll('.msg--inbound');
      expect(inbound.length).toBe(1);
      expect(inbound[0]!.textContent).toContain('Agent response');
    });
  });

  // ── keyboard shortcuts help ──

  describe('keyboard shortcuts help overlay', () => {
    it('renders shortcuts button in the header', () => {
      const html = renderChat();
      expect(html).toContain('id="btn-shortcuts"');
    });

    it('renders shortcuts overlay hidden by default', () => {
      renderIntoDOM(renderChat());
      const overlay = document.getElementById('shortcuts-overlay');
      expect(overlay).toBeTruthy();
      expect(overlay!.style.display).toBe('none');
    });

    it('opens shortcuts overlay on button click', () => {
      setupChat();
      const overlay = document.getElementById('shortcuts-overlay')!;

      document.getElementById('btn-shortcuts')!.click();

      expect(overlay.style.display).toBe('');
    });

    it('closes shortcuts overlay on second button click (toggle)', () => {
      setupChat();
      const overlay = document.getElementById('shortcuts-overlay')!;

      document.getElementById('btn-shortcuts')!.click();
      document.getElementById('btn-shortcuts')!.click();

      expect(overlay.style.display).toBe('none');
    });

    it('closes shortcuts overlay via close button', () => {
      setupChat();

      document.getElementById('btn-shortcuts')!.click();
      document.getElementById('shortcuts-close')!.click();

      expect(document.getElementById('shortcuts-overlay')!.style.display).toBe('none');
    });

    it('closes shortcuts overlay on Escape key', () => {
      setupChat();
      const overlay = document.getElementById('shortcuts-overlay')!;

      document.getElementById('btn-shortcuts')!.click();
      expect(overlay.style.display).toBe('');

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );

      expect(overlay.style.display).toBe('none');
    });

    it('toggles shortcuts overlay on "?" key press', () => {
      setupChat();
      const overlay = document.getElementById('shortcuts-overlay')!;

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '?', bubbles: true })
      );
      expect(overlay.style.display).toBe('');

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '?', bubbles: true })
      );
      expect(overlay.style.display).toBe('none');
    });

    it('closes shortcuts overlay on click outside modal', () => {
      setupChat();
      const overlay = document.getElementById('shortcuts-overlay')!;

      document.getElementById('btn-shortcuts')!.click();
      expect(overlay.style.display).toBe('');

      // Click on the overlay background (not the modal inside)
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(overlay.style.display).toBe('none');
    });

    it('lists all shortcut groups', () => {
      renderIntoDOM(renderChat());
      const overlay = document.getElementById('shortcuts-overlay')!;

      expect(overlay.textContent).toContain('Messages');
      expect(overlay.textContent).toContain('Search');
      expect(overlay.textContent).toContain('Navigation');
      expect(overlay.textContent).toContain('Send message');
      expect(overlay.textContent).toContain('New line');
      expect(overlay.textContent).toContain('Open search');
      expect(overlay.textContent).toContain('Close search');
    });
  });

  // ── cleanupChat ──

  describe('cleanupChat', () => {
    it('stops polling and cleans up', () => {
      setupChat();
      cleanupChat();

      expect(mockMessaging.stopPolling).toHaveBeenCalled();
    });
  });
});
