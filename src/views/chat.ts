/**
 * Chat view - Main messaging interface orchestrator
 *
 * Delegates to extracted modules:
 * - chat-search.ts — search bar UI, highlighting, navigation
 * - chat-attachments.ts — file handling, drag-and-drop, preview
 * - chat-messages.ts — message rendering, date separators, status updates
 */
import { store } from '../store.ts';
import { messaging } from '../messaging.ts';
import { getAccount } from '../wallet.ts';
import { showToast } from '../toast.ts';
import type { ChatMessage } from '../types.ts';
import { escapeHtml, shortenAddress } from '../utils.ts';
import { saveMessage, updateMessageStatus as dbUpdateStatus, loadMessages } from '../db.ts';
import { getDeviceName } from '../device-name.ts';
import { canSend, recordSend, getRemainingCooldown } from '../rate-limiter.ts';
import { bindSearchEvents, openSearch, closeSearch, isSearchOpen, resetSearchState } from './chat-search.ts';
import { bindAttachmentEvents, getPendingAttachment, getPendingCaption, clearPendingAttachment, resetAttachmentState } from './chat-attachments.ts';
import { appendMessage, updateMessageEl, showThinking, setOutputEl, resetMessageState } from './chat-messages.ts';

/** Detect macOS for shortcut labels */
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
/** How often to check agent online status and wallet balance (ms) */
const STATUS_CHECK_INTERVAL_MS = 30_000;
/** Max height for auto-resizing textarea (px) */
const INPUT_MAX_HEIGHT_PX = 200;

let outputEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let unsubMessages: (() => void) | null = null;
let unsubPollErrors: (() => void) | null = null;
let chatCleanupFn: (() => void) | null = null;

export function renderChat(): string {
  const state = store.getState();
  const agent = state.agent.connection;
  const wallet = state.wallet;

  const agentLabel = agent?.label ?? 'Unknown Agent';
  const agentAddr = agent?.address ? shortenAddress(agent.address) : '';
  const walletAddr = wallet.address ? shortenAddress(wallet.address, 4, 4) : '';
  const network = agent?.network ?? 'mainnet';

  return `
    <header class="header" role="banner">
      <div class="header__brand">
        <div id="connection-status" class="header__status" role="status" aria-label="Agent ${escapeHtml(agentLabel)} disconnected"></div>
        <h1 class="header__title">${escapeHtml(agentLabel)}</h1>
        <span class="network-badge network-badge--${network}" aria-label="Network: ${network}">${network}</span>
      </div>
      <nav class="header__controls" aria-label="Chat controls">
        <button class="wallet-badge" id="wallet-badge" title="${wallet.address ?? ''}" aria-label="Copy wallet address ${walletAddr}">
          <span class="wallet-badge__dot" aria-hidden="true"></span>
          <span class="wallet-badge__addr">${walletAddr}</span>
        </button>
        <button id="btn-search" class="icon-btn" aria-label="Search messages" aria-expanded="false" aria-controls="search-bar">&#x1F50D;</button>
        <button id="btn-shortcuts" class="icon-btn" aria-label="Keyboard shortcuts" aria-expanded="false" aria-controls="shortcuts-overlay">?</button>
        <button id="btn-settings" class="icon-btn" aria-label="Settings">&#x2699;</button>
      </nav>
    </header>

    <div class="search-bar" id="search-bar" role="search" aria-label="Search messages" style="display:none">
      <div class="search-bar__inner">
        <label for="search-input" class="sr-only">Search messages</label>
        <input id="search-input" class="search-bar__field" type="search"
          placeholder="Search messages..." autocomplete="off" />
        <span id="search-count" class="search-bar__count" aria-live="polite" role="status"></span>
        <button id="search-prev" class="search-bar__nav" aria-label="Previous match" disabled>&#x25B2;</button>
        <button id="search-next" class="search-bar__nav" aria-label="Next match" disabled>&#x25BC;</button>
        <button id="search-close" class="search-bar__close" aria-label="Close search">&#x2715;</button>
      </div>
    </div>

    <div class="connection-bar" id="connection-bar" role="status" aria-live="polite">
      <span class="status-dot status-dot--grey" id="poll-dot" aria-hidden="true"></span>
      <span class="connection-bar__text" id="connection-text">Connecting...</span>
      <span class="agent-info__addr">${agentAddr}</span>
    </div>

    <main id="main-content" class="terminal" tabindex="-1">
      <div class="terminal__output" id="chat-output" role="log" aria-live="polite" aria-label="Message history">
        <div class="msg msg--status" role="status">
          <span class="msg__prompt" aria-hidden="true">[sys] </span>
          <span class="msg__text">Connected to <strong>${escapeHtml(agentLabel)}</strong> via AlgoChat on ${network}</span>
        </div>
      </div>
    </main>

    <button id="scroll-to-bottom" class="scroll-bottom-btn" aria-label="Scroll to latest messages" style="display:none">&#x2193;</button>

    <div id="attachment-preview" class="attachment-preview" role="status" aria-live="polite" style="display:none">
      <div class="attachment-preview__inner">
        <span id="attachment-preview-info" class="attachment-preview__info"></span>
        <button id="attachment-preview-cancel" class="attachment-preview__cancel" aria-label="Remove attachment">&#x2715;</button>
      </div>
    </div>

    <footer class="input-bar" role="contentinfo">
      <input id="file-input" type="file" accept="image/*,.txt,.csv,.json,.md,.html" style="display:none" aria-hidden="true" tabindex="-1" />
      <button id="btn-attach" class="input-bar__attach" aria-label="Attach file">&#x1F4CE;</button>
      <label for="chat-input" class="sr-only">Message</label>
      <textarea id="chat-input" class="input-bar__field" rows="1"
        placeholder="Type a message..." autocomplete="off" aria-label="Type a message"></textarea>
      <button id="btn-send" class="input-bar__send" disabled aria-disabled="true">Send</button>
    </footer>

    <div id="shortcuts-overlay" class="modal-overlay" style="display:none" role="presentation">
      <div class="modal shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-modal-title">
        <h2 id="shortcuts-modal-title" class="modal__title">Keyboard Shortcuts</h2>
        <div class="shortcuts-list">
          <div class="shortcuts-group">
            <h3 class="shortcuts-group__title">Messages</h3>
            <div class="shortcut-row"><kbd>Enter</kbd><span>Send message</span></div>
            <div class="shortcut-row"><kbd>Shift</kbd> + <kbd>Enter</kbd><span>New line</span></div>
          </div>
          <div class="shortcuts-group">
            <h3 class="shortcuts-group__title">Search</h3>
            <div class="shortcut-row"><kbd>${isMac ? 'Cmd' : 'Ctrl'}</kbd> + <kbd>F</kbd><span>Open search</span></div>
            <div class="shortcut-row"><kbd>Escape</kbd><span>Close search</span></div>
            <div class="shortcut-row"><kbd>Enter</kbd><span>Next match</span></div>
            <div class="shortcut-row"><kbd>Shift</kbd> + <kbd>Enter</kbd><span>Previous match</span></div>
          </div>
          <div class="shortcuts-group">
            <h3 class="shortcuts-group__title">Navigation</h3>
            <div class="shortcut-row"><kbd>?</kbd><span>Toggle this help</span></div>
          </div>
        </div>
        <div class="modal__actions">
          <button id="shortcuts-close" class="btn btn--secondary">Close</button>
        </div>
      </div>
    </div>
  `;
}

export function bindChatEvents(): void {
  outputEl = document.getElementById('chat-output');
  inputEl = document.getElementById('chat-input') as HTMLTextAreaElement;
  const btnSend = document.getElementById('btn-send');
  const connectionStatus = document.getElementById('connection-status');
  const connectionText = document.getElementById('connection-text');
  const pollDot = document.getElementById('poll-dot');

  // Initialize messaging service
  const account = getAccount();
  const connection = store.getState().agent.connection;

  if (!account || !connection) {
    showToast('Wallet or agent not configured', 'error');
    store.setView('setup');
    return;
  }

  messaging.initialize(account, connection);

  // Set output element for message rendering module
  setOutputEl(outputEl);

  // Update send button state
  function updateSendButton() {
    if (!inputEl || !btnSend) return;
    const hasContent = inputEl.value.trim().length > 0 || getPendingAttachment() !== null;
    if (hasContent) {
      btnSend.removeAttribute('disabled');
      btnSend.setAttribute('aria-disabled', 'false');
    } else {
      btnSend.setAttribute('disabled', 'true');
      btnSend.setAttribute('aria-disabled', 'true');
    }
  }

  // Load persisted message history from IndexedDB
  loadMessages(connection.address).then((history) => {
    for (const msg of history) {
      store.addMessage(msg);
      appendMessage(msg);
    }
  });

  // Subscribe to incoming messages
  unsubMessages = messaging.onMessage((msg: ChatMessage) => {
    // addMessage returns false if deduplicated (e.g. optimistic send already exists)
    if (!store.addMessage(msg)) return;
    appendMessage(msg);
    // Persist to IndexedDB
    saveMessage(msg, connection.address);
  });

  // Start polling
  messaging.startPolling();
  store.setPolling(true);

  // Subscribe to poll errors for connection status indicator
  unsubPollErrors = messaging.onPollError((error) => {
    if (error) {
      if (pollDot) {
        pollDot.className = 'status-dot status-dot--red';
      }
      if (connectionText) {
        const retries = messaging.consecutiveErrors;
        connectionText.textContent = `Connection lost (retry ${retries}...)`;
      }
    } else {
      if (pollDot) {
        pollDot.className = 'status-dot status-dot--green';
      }
      if (connectionText) {
        connectionText.textContent = 'Connected';
      }
      showToast('Connection recovered', 'success');
    }
  });

  // Update connection status
  const updateStatus = async () => {
    try {
      const online = await messaging.checkAgentOnline();
      store.setAgentOnline(online);
      if (connectionStatus) {
        connectionStatus.className = `header__status ${online ? 'connected' : ''}`;
        connectionStatus.setAttribute('aria-label', `Agent ${online ? 'connected' : 'disconnected'}`);
      }
      if (connectionText) {
        connectionText.textContent = online ? 'Connected' : 'Searching...';
      }
      if (pollDot) {
        pollDot.className = `status-dot ${online ? 'status-dot--green' : 'status-dot--amber'}`;
      }

      const balance = await messaging.getBalance();
      store.setBalance(balance);
    } catch {
      // Ignore
    }
  };

  updateStatus();
  const statusTimer = setInterval(updateStatus, STATUS_CHECK_INTERVAL_MS);

  // ── Bind extracted modules ──

  const cleanupAttachments = bindAttachmentEvents(outputEl, updateSendButton);
  const cleanupSearch = bindSearchEvents(outputEl);

  // ── Rate limit cooldown ──

  let rateLimitTimer: ReturnType<typeof setTimeout> | null = null;

  function applySendCooldown() {
    const remaining = getRemainingCooldown();
    if (remaining > 0 && btnSend) {
      btnSend.setAttribute('disabled', 'true');
      btnSend.classList.add('input-bar__send--cooldown');
      if (rateLimitTimer) clearTimeout(rateLimitTimer);
      rateLimitTimer = setTimeout(() => {
        btnSend.classList.remove('input-bar__send--cooldown');
        updateSendButton();
        rateLimitTimer = null;
      }, remaining);
    }
  }

  // ── Send message ──

  const sendMessage = async () => {
    if (!inputEl) return;
    const content = inputEl.value.trim();
    const attachment = getPendingAttachment();
    const caption = getPendingCaption();

    // Need either text content or an attachment
    if (!content && !attachment) return;

    // Rate limit check
    if (!canSend()) {
      const remaining = getRemainingCooldown();
      showToast(`Slow down — wait ${(remaining / 1000).toFixed(1)}s`, 'info');
      applySendCooldown();
      return;
    }

    // Determine the message content: use typed text, or attachment caption as fallback
    const messageContent = content || caption || '';

    // Create optimistic message
    const tempId = `temp-${Date.now()}`;
    const outMsg: ChatMessage = {
      id: tempId,
      content: messageContent,
      direction: 'sent',
      timestamp: new Date(),
      status: 'sending',
      deviceName: getDeviceName() ?? undefined,
      attachment: attachment ?? undefined,
    };

    store.addMessage(outMsg);
    appendMessage(outMsg);
    saveMessage(outMsg, connection.address);

    // Record send for rate limiting and apply cooldown
    recordSend();

    inputEl.value = '';
    inputEl.style.height = 'auto';
    clearPendingAttachment(updateSendButton);
    updateSendButton();
    applySendCooldown();

    store.setSending(true);
    if (btnSend) btnSend.setAttribute('disabled', 'true');

    try {
      const txid = await messaging.sendMessage(messageContent, attachment ?? undefined);
      store.updateMessageStatus(tempId, 'confirmed', txid);
      updateMessageEl(tempId, 'confirmed');
      dbUpdateStatus(tempId, 'confirmed', txid);

      showThinking();
    } catch (err) {
      store.updateMessageStatus(tempId, 'failed');
      updateMessageEl(tempId, 'failed');
      dbUpdateStatus(tempId, 'failed');
      showToast(
        `Send failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        'error',
      );
    } finally {
      store.setSending(false);
      if (btnSend) btnSend.removeAttribute('disabled');
    }
  };

  // ── Input handling ──

  inputEl?.addEventListener('input', () => {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, INPUT_MAX_HEIGHT_PX)}px`;
    updateSendButton();
  });

  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  btnSend?.addEventListener('click', sendMessage);

  // Settings button
  document
    .getElementById('btn-settings')
    ?.addEventListener('click', () => {
      store.setView('settings');
    });

  // Scroll-to-bottom button
  const scrollBtn = document.getElementById('scroll-to-bottom');
  if (outputEl && scrollBtn) {
    outputEl.addEventListener('scroll', () => {
      if (!outputEl) return;
      const distFromBottom = outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight;
      scrollBtn.style.display = distFromBottom > 120 ? '' : 'none';
    });
    scrollBtn.addEventListener('click', () => {
      if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
    });
  }

  // Wallet badge click - copy address
  document
    .getElementById('wallet-badge')
    ?.addEventListener('click', () => {
      const addr = store.getState().wallet.address;
      if (addr) {
        navigator.clipboard.writeText(addr).then(() => {
          showToast('Address copied', 'info');
        });
      }
    });

  // ── Shortcuts help overlay ──
  const shortcutsOverlay = document.getElementById('shortcuts-overlay');
  const btnShortcuts = document.getElementById('btn-shortcuts');
  const shortcutsClose = document.getElementById('shortcuts-close');
  const searchInput = document.getElementById('search-input') as HTMLInputElement | null;

  let shortcutsTrapHandler: ((e: KeyboardEvent) => void) | null = null;

  function openShortcuts() {
    if (!shortcutsOverlay) return;
    shortcutsOverlay.style.display = '';
    btnShortcuts?.setAttribute('aria-expanded', 'true');
    shortcutsClose?.focus();

    shortcutsTrapHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const modal = shortcutsOverlay.querySelector('.modal') as HTMLElement;
      if (!modal) return;
      const focusable = modal.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', shortcutsTrapHandler);
  }

  function closeShortcuts() {
    if (!shortcutsOverlay) return;
    shortcutsOverlay.style.display = 'none';
    btnShortcuts?.setAttribute('aria-expanded', 'false');
    if (shortcutsTrapHandler) {
      document.removeEventListener('keydown', shortcutsTrapHandler);
      shortcutsTrapHandler = null;
    }
    btnShortcuts?.focus();
  }

  btnShortcuts?.addEventListener('click', () => {
    if (shortcutsOverlay?.style.display === 'none') {
      openShortcuts();
    } else {
      closeShortcuts();
    }
  });

  shortcutsClose?.addEventListener('click', closeShortcuts);

  shortcutsOverlay?.addEventListener('click', (e) => {
    if (e.target === shortcutsOverlay) closeShortcuts();
  });

  // Global keyboard shortcuts
  const handleGlobalKeydown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape' && isSearchOpen()) {
      closeSearch();
    }
    if (
      e.key === '?' &&
      !e.ctrlKey && !e.metaKey && !e.altKey &&
      document.activeElement !== inputEl &&
      document.activeElement !== searchInput
    ) {
      e.preventDefault();
      if (shortcutsOverlay?.style.display === 'none') {
        openShortcuts();
      } else {
        closeShortcuts();
      }
    }
    if (e.key === 'Escape' && shortcutsOverlay?.style.display !== 'none') {
      closeShortcuts();
    }
  };
  document.addEventListener('keydown', handleGlobalKeydown);

  // Store cleanup function for when view changes
  chatCleanupFn = () => {
    clearInterval(statusTimer);
    if (rateLimitTimer) clearTimeout(rateLimitTimer);
    document.removeEventListener('keydown', handleGlobalKeydown);
    if (shortcutsTrapHandler) {
      document.removeEventListener('keydown', shortcutsTrapHandler);
      shortcutsTrapHandler = null;
    }
    cleanupSearch();
    closeShortcuts();
    cleanupAttachments();
  };
}

export function cleanupChat(): void {
  unsubMessages?.();
  unsubMessages = null;
  unsubPollErrors?.();
  unsubPollErrors = null;
  messaging.stopPolling();

  chatCleanupFn?.();
  chatCleanupFn = null;

  resetAttachmentState();
  resetSearchState();
  resetMessageState();
  outputEl = null;
  inputEl = null;
}
