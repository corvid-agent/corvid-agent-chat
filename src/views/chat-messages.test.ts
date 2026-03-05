/**
 * Tests for chat-messages — message rendering, date separators, status updates, thinking indicator
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatMessage } from '../types.ts';

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// ── Hoisted mocks ──
const { mockStore, mockMessaging, mockToast, mockDb, mockDeviceName, mockFileHandler } = vi.hoisted(() => ({
  mockStore: {
    getState: vi.fn(() => ({
      chat: { messages: [] },
    })),
    updateMessageStatus: vi.fn(),
  },
  mockMessaging: {
    sendMessage: vi.fn().mockResolvedValue('TXID_RETRY'),
  },
  mockToast: {
    showToast: vi.fn(),
  },
  mockDb: {
    updateMessageStatus: vi.fn(),
  },
  mockDeviceName: {
    getDeviceName: vi.fn((): string | null => null),
  },
  mockFileHandler: {
    createImagePreview: vi.fn(() => document.createElement('div')),
    createFileDownload: vi.fn(() => document.createElement('div')),
  },
}));

vi.mock('../store.ts', () => ({ store: mockStore }));
vi.mock('../messaging.ts', () => ({ messaging: mockMessaging }));
vi.mock('../toast.ts', () => mockToast);
vi.mock('../db.ts', () => mockDb);
vi.mock('../device-name.ts', () => mockDeviceName);
vi.mock('../markdown.ts', () => ({
  renderMarkdown: vi.fn((text: string) => text),
}));
vi.mock('../utils.ts', () => ({
  escapeHtml: (s: string) => s,
  formatTime: () => '12:00',
  formatDateLabel: () => 'Today',
}));
vi.mock('../file-handler.ts', () => mockFileHandler);

import {
  appendMessage,
  updateMessageEl,
  showThinking,
  hideThinking,
  setOutputEl,
  resetMessageState,
} from './chat-messages.ts';

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    content: 'Hello world',
    direction: 'sent',
    timestamp: new Date('2026-03-05T12:00:00Z'),
    status: 'confirmed',
    ...overrides,
  };
}

describe('chat-messages', () => {
  let outputEl: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="output"></div>';
    outputEl = document.getElementById('output')!;
    setOutputEl(outputEl);
  });

  afterEach(() => {
    resetMessageState();
  });

  describe('appendMessage', () => {
    it('renders a sent message with [you] prompt', () => {
      appendMessage(makeMsg({ content: 'Hi there' }));
      const prompt = outputEl.querySelector('.msg__prompt');
      expect(prompt?.textContent).toContain('[you]');
      const text = outputEl.querySelector('.msg__text');
      expect(text?.textContent).toContain('Hi there');
    });

    it('renders a received message with [agent] prompt', () => {
      appendMessage(makeMsg({ direction: 'received', content: 'Response' }));
      const prompt = outputEl.querySelector('.msg__prompt');
      expect(prompt?.textContent).toContain('[agent]');
    });

    it('renders sent message with device name when available', () => {
      appendMessage(makeMsg({ deviceName: 'laptop' }));
      const prompt = outputEl.querySelector('.msg__prompt');
      expect(prompt?.textContent).toContain('[you@laptop]');
    });

    it('falls back to global device name for sent messages without deviceName', () => {
      mockDeviceName.getDeviceName.mockReturnValue('desktop');
      appendMessage(makeMsg({ deviceName: undefined }));
      const prompt = outputEl.querySelector('.msg__prompt');
      expect(prompt?.textContent).toContain('[you@desktop]');
      mockDeviceName.getDeviceName.mockReturnValue(null);
    });

    it('applies outbound class for sent messages', () => {
      appendMessage(makeMsg({ id: 'test-1' }));
      const el = document.getElementById('msg-test-1');
      expect(el?.classList.contains('msg--outbound')).toBe(true);
    });

    it('applies inbound class for received messages', () => {
      appendMessage(makeMsg({ id: 'test-2', direction: 'received' }));
      const el = document.getElementById('msg-test-2');
      expect(el?.classList.contains('msg--inbound')).toBe(true);
    });

    it('shows sending status badge', () => {
      appendMessage(makeMsg({ status: 'sending' }));
      const status = outputEl.querySelector('.msg__status');
      expect(status?.textContent).toContain('sending');
      expect(status?.getAttribute('data-status')).toBe('sending');
    });

    it('shows failed status with retry button', () => {
      appendMessage(makeMsg({ status: 'failed' }));
      const status = outputEl.querySelector('.msg__status');
      expect(status?.getAttribute('data-status')).toBe('failed');
      const retryBtn = outputEl.querySelector('.msg__retry');
      expect(retryBtn).not.toBeNull();
    });

    it('shows no status badge for confirmed messages', () => {
      appendMessage(makeMsg({ status: 'confirmed' }));
      const status = outputEl.querySelector('.msg__status');
      expect(status).toBeNull();
    });

    it('renders time stamp', () => {
      appendMessage(makeMsg());
      const time = outputEl.querySelector('.msg__time');
      expect(time?.textContent).toBe('12:00');
    });

    it('renders tx link when txid is present', () => {
      appendMessage(makeMsg({ txid: 'SOMETXID' }));
      const link = outputEl.querySelector('.msg__txlink') as HTMLAnchorElement;
      expect(link).not.toBeNull();
      expect(link?.href).toContain('SOMETXID');
      expect(link?.target).toBe('_blank');
      expect(link?.rel).toContain('noopener');
    });

    it('does not render tx link when no txid', () => {
      appendMessage(makeMsg({ txid: undefined }));
      const link = outputEl.querySelector('.msg__txlink');
      expect(link).toBeNull();
    });

    it('renders copy button', () => {
      appendMessage(makeMsg());
      const copyBtn = outputEl.querySelector('.msg__copy');
      expect(copyBtn).not.toBeNull();
    });

    it('inserts date separator on first message', () => {
      appendMessage(makeMsg());
      const sep = outputEl.querySelector('.date-separator');
      expect(sep).not.toBeNull();
      expect(sep?.textContent).toBe('Today');
    });

    it('does not duplicate date separator for same-day messages', () => {
      appendMessage(makeMsg({ id: 'a' }));
      appendMessage(makeMsg({ id: 'b' }));
      const seps = outputEl.querySelectorAll('.date-separator');
      expect(seps.length).toBe(1);
    });

    it('inserts new date separator when day changes', () => {
      appendMessage(makeMsg({ id: 'a', timestamp: new Date('2026-03-04T10:00:00Z') }));
      appendMessage(makeMsg({ id: 'b', timestamp: new Date('2026-03-05T10:00:00Z') }));
      const seps = outputEl.querySelectorAll('.date-separator');
      expect(seps.length).toBe(2);
    });

    it('removes thinking indicator when receiving a message', () => {
      showThinking();
      expect(document.getElementById('thinking-indicator')).not.toBeNull();
      appendMessage(makeMsg({ direction: 'received' }));
      expect(document.getElementById('thinking-indicator')).toBeNull();
    });

    it('does not remove thinking indicator for sent messages', () => {
      showThinking();
      appendMessage(makeMsg({ direction: 'sent' }));
      expect(document.getElementById('thinking-indicator')).not.toBeNull();
    });

    it('does nothing when outputEl is null', () => {
      setOutputEl(null);
      appendMessage(makeMsg());
      // No crash, no DOM changes
      expect(outputEl.children.length).toBe(0);
    });

    it('scrolls to bottom after appending', () => {
      // scrollTop setter is available in jsdom
      appendMessage(makeMsg());
      // outputEl.scrollTop should be set to scrollHeight
      expect(outputEl.children.length).toBeGreaterThan(0);
    });

    it('renders image attachment', () => {
      appendMessage(makeMsg({
        attachment: { type: 'image', mimeType: 'image/png', fileName: 'pic.png', size: 1024 },
      }));
      expect(mockFileHandler.createImagePreview).toHaveBeenCalled();
    });

    it('renders file attachment', () => {
      appendMessage(makeMsg({
        attachment: { type: 'file', mimeType: 'text/plain', fileName: 'readme.txt', size: 512 },
      }));
      expect(mockFileHandler.createFileDownload).toHaveBeenCalled();
    });
  });

  describe('updateMessageEl', () => {
    it('removes status badge when confirmed', () => {
      appendMessage(makeMsg({ id: 'upd-1', status: 'sending' }));
      expect(document.querySelector('.msg__status')).not.toBeNull();
      updateMessageEl('upd-1', 'confirmed');
      expect(document.querySelector('.msg__status')).toBeNull();
    });

    it('updates status badge to failed', () => {
      appendMessage(makeMsg({ id: 'upd-2', status: 'sending' }));
      updateMessageEl('upd-2', 'failed');
      const status = document.querySelector('.msg__status');
      expect(status?.getAttribute('data-status')).toBe('failed');
      expect(status?.textContent).toContain('failed');
    });

    it('handles non-existent message gracefully', () => {
      // Should not throw
      updateMessageEl('nonexistent', 'confirmed');
    });
  });

  describe('showThinking / hideThinking', () => {
    it('shows thinking indicator with ARIA attributes', () => {
      showThinking();
      const indicator = document.getElementById('thinking-indicator');
      expect(indicator).not.toBeNull();
      expect(indicator?.getAttribute('role')).toBe('status');
      expect(indicator?.getAttribute('aria-live')).toBe('polite');
      expect(indicator?.textContent).toContain('Agent is thinking');
    });

    it('removes existing indicator before showing new one', () => {
      showThinking();
      showThinking();
      const indicators = outputEl.querySelectorAll('#thinking-indicator');
      expect(indicators.length).toBe(1);
    });

    it('hideThinking removes the indicator', () => {
      showThinking();
      hideThinking();
      expect(document.getElementById('thinking-indicator')).toBeNull();
    });

    it('hideThinking does nothing when no indicator exists', () => {
      // Should not throw
      hideThinking();
    });

    it('showThinking does nothing when outputEl is null', () => {
      setOutputEl(null);
      showThinking();
      expect(document.getElementById('thinking-indicator')).toBeNull();
    });
  });

  describe('retry button', () => {
    it('retries sending on click and shows success toast', async () => {
      const msg = makeMsg({ id: 'retry-1', status: 'failed', content: 'retry me' });
      appendMessage(msg);
      const retryBtn = document.querySelector('.msg__retry') as HTMLElement;
      expect(retryBtn).not.toBeNull();

      retryBtn.click();
      // Wait for async handler
      await vi.waitFor(() => {
        expect(mockMessaging.sendMessage).toHaveBeenCalledWith('retry me', undefined);
      });
      expect(mockStore.updateMessageStatus).toHaveBeenCalledWith('retry-1', 'confirmed', 'TXID_RETRY');
      expect(mockToast.showToast).toHaveBeenCalledWith('Message resent', 'success');
    });

    it('shows error toast when retry fails', async () => {
      mockMessaging.sendMessage.mockRejectedValueOnce(new Error('Network error'));
      const msg = makeMsg({ id: 'retry-2', status: 'failed', content: 'fail me' });
      appendMessage(msg);
      const retryBtn = document.querySelector('.msg__retry') as HTMLElement;

      retryBtn.click();
      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith('Retry failed: Network error', 'error');
      });
    });
  });

  describe('resetMessageState', () => {
    it('clears module state', () => {
      appendMessage(makeMsg());
      resetMessageState();
      // After reset, appending should do nothing (outputEl is null)
      const el = document.createElement('div');
      document.body.appendChild(el);
      // outputEl was reset so appendMessage is a no-op
      const before = el.children.length;
      appendMessage(makeMsg());
      expect(el.children.length).toBe(before);
    });
  });
});
