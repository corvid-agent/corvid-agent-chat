/**
 * Chat view - Main messaging interface
 */
import { store } from '../store.ts';
import { messaging } from '../messaging.ts';
import { getAccount } from '../wallet.ts';
import { renderMarkdown } from '../markdown.ts';
import { showToast } from '../toast.ts';
import type { Attachment, ChatMessage } from '../types.ts';
import { escapeHtml, shortenAddress, formatTime, formatDateLabel } from '../utils.ts';
import { saveMessage, updateMessageStatus as dbUpdateStatus, loadMessages } from '../db.ts';
import { getDeviceName } from '../device-name.ts';
import { processFile, createImagePreview, createFileDownload, formatFileSize, isAcceptedType } from '../file-handler.ts';
import { canSend, recordSend, getRemainingCooldown } from '../rate-limiter.ts';

/** Detect macOS for shortcut labels */
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
/** How often to check agent online status and wallet balance (ms) */
const STATUS_CHECK_INTERVAL_MS = 30_000;
/** Max height for auto-resizing textarea (px) */
const INPUT_MAX_HEIGHT_PX = 200;
/** Duration to show copy confirmation before reverting (ms) */
const COPY_FEEDBACK_MS = 1_500;
/** Debounce delay for search input (ms) */
const SEARCH_DEBOUNCE_MS = 150;

let outputEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let unsubMessages: (() => void) | null = null;
let unsubPollErrors: (() => void) | null = null;
let chatCleanupFn: (() => void) | null = null;

/* ── Search state ── */
let searchOpen = false;
let searchQuery = '';
let searchMatches: HTMLElement[] = [];
let searchCurrentIdx = -1;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/* ── Date separator tracking ── */
let lastMessageDate: string | null = null;

/* ── Pending attachment state ── */
let pendingAttachment: Attachment | null = null;
let pendingCaption: string | null = null;

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
  const btnAttach = document.getElementById('btn-attach');
  const fileInput = document.getElementById('file-input') as HTMLInputElement | null;
  const attachmentPreview = document.getElementById('attachment-preview');
  const attachmentPreviewInfo = document.getElementById('attachment-preview-info');
  const attachmentPreviewCancel = document.getElementById('attachment-preview-cancel');
  const connectionStatus = document.getElementById('connection-status');
  const connectionText = document.getElementById('connection-text');
  const pollDot = document.getElementById('poll-dot');

  // Reset pending attachment state
  pendingAttachment = null;
  pendingCaption = null;

  // Initialize messaging service
  const account = getAccount();
  const connection = store.getState().agent.connection;

  if (!account || !connection) {
    showToast('Wallet or agent not configured', 'error');
    store.setView('setup');
    return;
  }

  messaging.initialize(account, connection);

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
      // Show error state in connection bar
      if (pollDot) {
        pollDot.className = 'status-dot status-dot--red';
      }
      if (connectionText) {
        const retries = messaging.consecutiveErrors;
        connectionText.textContent = `Connection lost (retry ${retries}...)`;
      }
    } else {
      // Recovered
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

      // Update balance
      const balance = await messaging.getBalance();
      store.setBalance(balance);
    } catch {
      // Ignore
    }
  };

  updateStatus();
  const statusTimer = setInterval(updateStatus, STATUS_CHECK_INTERVAL_MS);

  // ── Attachment handling ──

  function showAttachmentPreview(caption: string) {
    if (attachmentPreview) attachmentPreview.style.display = '';
    if (attachmentPreviewInfo) attachmentPreviewInfo.textContent = caption;
    updateSendButton();
  }

  function clearPendingAttachment() {
    pendingAttachment = null;
    pendingCaption = null;
    if (attachmentPreview) attachmentPreview.style.display = 'none';
    if (attachmentPreviewInfo) attachmentPreviewInfo.textContent = '';
    if (fileInput) fileInput.value = '';
    updateSendButton();
  }

  async function handleFileSelection(file: File) {
    try {
      const processed = await processFile(file);
      pendingAttachment = processed.attachment;
      pendingCaption = processed.caption;
      showAttachmentPreview(
        `${pendingAttachment.type === 'image' ? 'Image' : 'File'}: ${file.name} (${formatFileSize(file.size)})`
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to process file',
        'error'
      );
      clearPendingAttachment();
    }
  }

  // Attach button click
  btnAttach?.addEventListener('click', () => {
    fileInput?.click();
  });

  // File input change
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFileSelection(file);
  });

  // Cancel attachment
  attachmentPreviewCancel?.addEventListener('click', () => {
    clearPendingAttachment();
  });

  // Drag and drop on the chat output area
  const terminalEl = outputEl?.parentElement;
  if (terminalEl) {
    terminalEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      terminalEl.classList.add('terminal--dragover');
    });

    terminalEl.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      terminalEl.classList.remove('terminal--dragover');
    });

    terminalEl.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      terminalEl.classList.remove('terminal--dragover');

      const file = e.dataTransfer?.files[0];
      if (file) {
        if (isAcceptedType(file.type)) {
          handleFileSelection(file);
        } else {
          showToast(`File type "${file.type || 'unknown'}" is not supported`, 'error');
        }
      }
    });
  }

  // Rate limit cooldown timer — re-enables the send button after cooldown
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

  // Send message
  const sendMessage = async () => {
    if (!inputEl) return;
    const content = inputEl.value.trim();
    const attachment = pendingAttachment;
    const caption = pendingCaption;

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
    // Persist optimistic message
    saveMessage(outMsg, connection.address);

    // Record send for rate limiting and apply cooldown
    recordSend();

    inputEl.value = '';
    inputEl.style.height = 'auto';
    clearPendingAttachment();
    updateSendButton();
    applySendCooldown();

    store.setSending(true);
    if (btnSend) btnSend.setAttribute('disabled', 'true');

    try {
      const txid = await messaging.sendMessage(messageContent, attachment ?? undefined);
      store.updateMessageStatus(tempId, 'confirmed', txid);
      updateMessageEl(tempId, 'confirmed');
      // Update persisted status
      dbUpdateStatus(tempId, 'confirmed', txid);

      // Show waiting indicator
      showThinking();
    } catch (err) {
      store.updateMessageStatus(tempId, 'failed');
      updateMessageEl(tempId, 'failed');
      dbUpdateStatus(tempId, 'failed');
      showToast(
        `Send failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        'error'
      );
    } finally {
      store.setSending(false);
      if (btnSend) btnSend.removeAttribute('disabled');
    }
  };

  // Input handling
  inputEl?.addEventListener('input', () => {
    if (!inputEl) return;
    // Auto-resize
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

  // Update send button state
  function updateSendButton() {
    if (!inputEl || !btnSend) return;
    const hasContent = inputEl.value.trim().length > 0 || pendingAttachment !== null;
    if (hasContent) {
      btnSend.removeAttribute('disabled');
      btnSend.setAttribute('aria-disabled', 'false');
    } else {
      btnSend.setAttribute('disabled', 'true');
      btnSend.setAttribute('aria-disabled', 'true');
    }
  }

  // ── Search feature ──
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
  const searchCount = document.getElementById('search-count');
  const searchPrev = document.getElementById('search-prev') as HTMLButtonElement | null;
  const searchNext = document.getElementById('search-next') as HTMLButtonElement | null;
  const searchClose = document.getElementById('search-close');
  const btnSearch = document.getElementById('btn-search');

  function openSearch() {
    if (!searchBar || !searchInput) return;
    searchOpen = true;
    searchBar.style.display = '';
    btnSearch?.setAttribute('aria-expanded', 'true');
    searchInput.value = searchQuery;
    searchInput.focus();
    if (searchQuery) {
      executeSearch(searchQuery);
    }
  }

  function closeSearch() {
    if (!searchBar) return;
    searchOpen = false;
    searchBar.style.display = 'none';
    btnSearch?.setAttribute('aria-expanded', 'false');
    clearSearchHighlights();
    searchQuery = '';
    searchMatches = [];
    searchCurrentIdx = -1;
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    if (searchCount) searchCount.textContent = '';
    btnSearch?.focus();
  }

  function clearSearchHighlights() {
    // Remove all search highlights from messages
    if (!outputEl) return;
    const highlighted = outputEl.querySelectorAll('.msg--search-match');
    highlighted.forEach((el) => el.classList.remove('msg--search-match'));
    const active = outputEl.querySelectorAll('.msg--search-active');
    active.forEach((el) => el.classList.remove('msg--search-active'));
    // Remove inline highlight spans
    const marks = outputEl.querySelectorAll('mark.search-highlight');
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
        parent.normalize();
      }
    });
  }

  function highlightTextInNode(node: Node, regex: RegExp): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      const match = regex.exec(text);
      if (!match) return false;

      const span = document.createElement('span');
      const before = text.substring(0, match.index);
      const matched = text.substring(match.index, match.index + match[0].length);
      const after = text.substring(match.index + match[0].length);

      if (before) span.appendChild(document.createTextNode(before));
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = matched;
      span.appendChild(mark);
      if (after) span.appendChild(document.createTextNode(after));

      node.parentNode?.replaceChild(span, node);

      // Recursively highlight the rest (the after text node)
      if (after) {
        const lastChild = span.lastChild;
        if (lastChild) highlightTextInNode(lastChild, regex);
      }
      return true;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      // Skip buttons, time stamps, prompts, and already-highlighted marks
      if (
        el.tagName === 'BUTTON' ||
        el.tagName === 'MARK' ||
        el.classList.contains('msg__time') ||
        el.classList.contains('msg__prompt') ||
        el.classList.contains('msg__copy') ||
        el.classList.contains('msg__status') ||
        el.classList.contains('msg__retry')
      ) {
        return false;
      }
      let found = false;
      // Iterate over a snapshot of child nodes (highlighting mutates the DOM)
      const children = Array.from(node.childNodes);
      for (const child of children) {
        if (highlightTextInNode(child, regex)) found = true;
      }
      return found;
    }

    return false;
  }

  function executeSearch(query: string) {
    clearSearchHighlights();
    searchMatches = [];
    searchCurrentIdx = -1;

    if (!query || !outputEl) {
      updateSearchNav();
      return;
    }

    // Escape regex special chars and compile once
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matchRegex = new RegExp(escaped, 'i');

    // Search through the message store for matching content
    const messages = store.getState().chat.messages;
    const matchingIds = new Set<string>();
    for (const msg of messages) {
      if (matchRegex.test(msg.content)) {
        matchingIds.add(msg.id);
      }
    }

    // Highlight matching message elements
    const msgEls = outputEl.querySelectorAll('.msg');
    msgEls.forEach((el) => {
      const htmlEl = el as HTMLElement;
      const msgId = htmlEl.id.replace(/^msg-/, '');
      if (matchingIds.has(msgId)) {
        htmlEl.classList.add('msg--search-match');
        searchMatches.push(htmlEl);
        // Highlight matching text within the .msg__text span
        const textSpan = htmlEl.querySelector('.msg__text');
        if (textSpan) {
          highlightTextInNode(textSpan, new RegExp(escaped, 'gi'));
        }
      }
    });

    if (searchMatches.length > 0) {
      searchCurrentIdx = 0;
      searchMatches[0]!.classList.add('msg--search-active');
      searchMatches[0]!.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    updateSearchNav();
  }

  function updateSearchNav() {
    const total = searchMatches.length;
    if (searchCount) {
      if (!searchQuery) {
        searchCount.textContent = '';
      } else if (total === 0) {
        searchCount.textContent = 'No matches';
      } else {
        searchCount.textContent = `${searchCurrentIdx + 1} of ${total} match${total !== 1 ? 'es' : ''}`;
      }
    }
    if (searchPrev) searchPrev.disabled = total < 2;
    if (searchNext) searchNext.disabled = total < 2;
  }

  function navigateSearch(direction: 'prev' | 'next') {
    if (searchMatches.length === 0) return;
    // Remove active class from current
    searchMatches[searchCurrentIdx]?.classList.remove('msg--search-active');

    if (direction === 'next') {
      searchCurrentIdx = (searchCurrentIdx + 1) % searchMatches.length;
    } else {
      searchCurrentIdx = (searchCurrentIdx - 1 + searchMatches.length) % searchMatches.length;
    }

    searchMatches[searchCurrentIdx]!.classList.add('msg--search-active');
    searchMatches[searchCurrentIdx]!.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateSearchNav();
  }

  btnSearch?.addEventListener('click', () => {
    if (searchOpen) {
      closeSearch();
    } else {
      openSearch();
    }
  });

  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      executeSearch(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSearch();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        navigateSearch('prev');
      } else {
        navigateSearch('next');
      }
    }
  });

  searchPrev?.addEventListener('click', () => navigateSearch('prev'));
  searchNext?.addEventListener('click', () => navigateSearch('next'));
  searchClose?.addEventListener('click', () => closeSearch());

  // ── Shortcuts help overlay ──
  const shortcutsOverlay = document.getElementById('shortcuts-overlay');
  const btnShortcuts = document.getElementById('btn-shortcuts');
  const shortcutsClose = document.getElementById('shortcuts-close');

  let shortcutsTrapHandler: ((e: KeyboardEvent) => void) | null = null;

  function openShortcuts() {
    if (!shortcutsOverlay) return;
    shortcutsOverlay.style.display = '';
    btnShortcuts?.setAttribute('aria-expanded', 'true');
    shortcutsClose?.focus();

    // Focus trap within the modal
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

  // Close on click outside the modal
  shortcutsOverlay?.addEventListener('click', (e) => {
    if (e.target === shortcutsOverlay) closeShortcuts();
  });

  // Global keyboard shortcut: Ctrl/Cmd+F opens search
  const handleGlobalKeydown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape' && searchOpen) {
      closeSearch();
    }
    // "?" key opens shortcuts help (when not typing in input/search)
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
    // Escape closes shortcuts overlay
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
    closeSearch();
    closeShortcuts();
    clearPendingAttachment();
  };
}

function appendMessage(msg: ChatMessage): void {
  if (!outputEl) return;

  // Remove thinking indicator if we got a response
  if (msg.direction === 'received') {
    hideThinking();
  }

  // Insert date separator if the day changed
  const msgDate = msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp);
  const dayKey = `${msgDate.getFullYear()}-${msgDate.getMonth()}-${msgDate.getDate()}`;
  if (dayKey !== lastMessageDate) {
    lastMessageDate = dayKey;
    const sep = document.createElement('div');
    sep.className = 'divider date-separator';
    sep.textContent = formatDateLabel(msgDate);
    outputEl.appendChild(sep);
  }

  const div = document.createElement('div');
  div.className = `msg msg--${msg.direction === 'sent' ? 'outbound' : 'inbound'}`;
  div.id = `msg-${msg.id}`;

  let prompt: string;
  if (msg.direction === 'received') {
    prompt = '[agent] ';
  } else if (msg.deviceName) {
    prompt = `[you@${escapeHtml(msg.deviceName)}] `;
  } else if (getDeviceName()) {
    prompt = `[you@${escapeHtml(getDeviceName()!)}] `;
  } else {
    prompt = '[you] ';
  }
  const statusBadge = msg.status === 'sending'
    ? ' <span class="msg__status" data-status="sending">(sending...)</span>'
    : msg.status === 'failed'
      ? ' <span class="msg__status" data-status="failed">(failed) </span><button class="msg__retry" title="Retry">retry</button>'
      : '';

  const timeStr = formatTime(msg.timestamp);
  const txLink = msg.txid
    ? ` <a class="msg__txlink" href="https://allo.info/tx/${msg.txid}" target="_blank" rel="noopener" title="View on explorer">&#x26d3;</a>`
    : '';

  div.innerHTML = `
    <span class="msg__time">${timeStr}</span>
    <span class="msg__prompt">${prompt}</span>
    <span class="msg__text">${renderMarkdown(msg.content)}${statusBadge}${txLink}</span>
    <button class="msg__copy" title="Copy to clipboard">&#x2398;</button>
  `;

  // Append attachment display if present
  if (msg.attachment) {
    const textSpan = div.querySelector('.msg__text');
    if (textSpan) {
      const attachEl = msg.attachment.type === 'image'
        ? createImagePreview(msg.attachment)
        : createFileDownload(msg.attachment);
      textSpan.appendChild(attachEl);
    }
  }

  // Copy button
  const copyBtn = div.querySelector('.msg__copy');
  copyBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(msg.content).then(() => {
      if (copyBtn) copyBtn.textContent = '\u2713';
      setTimeout(() => {
        if (copyBtn) copyBtn.textContent = '\u2398';
      }, COPY_FEEDBACK_MS);
    });
  });

  // Retry button (for failed messages)
  const retryBtn = div.querySelector('.msg__retry');
  retryBtn?.addEventListener('click', async () => {
    if (!msg.content) return;
    try {
      const txid = await messaging.sendMessage(msg.content, msg.attachment);
      store.updateMessageStatus(msg.id, 'confirmed', txid);
      updateMessageEl(msg.id, 'confirmed');
      dbUpdateStatus(msg.id, 'confirmed', txid);
      showToast('Message resent', 'success');
    } catch (err) {
      showToast(
        `Retry failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        'error'
      );
    }
  });

  outputEl.appendChild(div);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function updateMessageEl(id: string, status: ChatMessage['status']): void {
  const el = document.getElementById(`msg-${id}`);
  if (!el) return;

  const statusSpan = el.querySelector('.msg__status');
  if (statusSpan) {
    if (status === 'confirmed') {
      statusSpan.remove();
    } else if (status === 'failed') {
      statusSpan.setAttribute('data-status', 'failed');
      statusSpan.textContent = '(failed)';
    }
  }
}

function showThinking(): void {
  if (!outputEl) return;
  // Remove existing thinking indicator
  hideThinking();

  const div = document.createElement('div');
  div.className = 'thinking';
  div.id = 'thinking-indicator';
  div.setAttribute('role', 'status');
  div.setAttribute('aria-live', 'polite');
  div.innerHTML = `
    <span class="thinking__dot" aria-hidden="true"></span>
    <span>Agent is thinking...</span>
  `;
  outputEl.appendChild(div);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function hideThinking(): void {
  document.getElementById('thinking-indicator')?.remove();
}

export function cleanupChat(): void {
  unsubMessages?.();
  unsubMessages = null;
  unsubPollErrors?.();
  unsubPollErrors = null;
  messaging.stopPolling();

  chatCleanupFn?.();
  chatCleanupFn = null;

  pendingAttachment = null;
  pendingCaption = null;
  lastMessageDate = null;
  outputEl = null;
  inputEl = null;
}
