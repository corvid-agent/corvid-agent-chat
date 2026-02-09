/**
 * Chat view - Main messaging interface
 */
import { store } from '../store.ts';
import { messaging } from '../messaging.ts';
import { getAccount } from '../wallet.ts';
import { renderMarkdown } from '../markdown.ts';
import { showToast } from '../toast.ts';
import type { ChatMessage } from '../types.ts';
import { escapeHtml, shortenAddress } from '../utils.ts';
import { saveMessage, updateMessageStatus as dbUpdateStatus, loadMessages } from '../db.ts';

let outputEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let unsubMessages: (() => void) | null = null;

export function renderChat(): string {
  const state = store.getState();
  const agent = state.agent.connection;
  const wallet = state.wallet;

  const agentLabel = agent?.label ?? 'Unknown Agent';
  const agentAddr = agent?.address ? shortenAddress(agent.address) : '';
  const walletAddr = wallet.address ? shortenAddress(wallet.address, 4, 4) : '';
  const network = agent?.network ?? 'mainnet';

  return `
    <div class="header">
      <div class="header__brand">
        <div id="connection-status" class="header__status"></div>
        <div class="header__title">${escapeHtml(agentLabel)}</div>
        <span class="network-badge network-badge--${network}">${network}</span>
      </div>
      <div class="header__controls">
        <div class="wallet-badge" id="wallet-badge" title="${wallet.address ?? ''}">
          <span class="wallet-badge__dot"></span>
          <span class="wallet-badge__addr">${walletAddr}</span>
        </div>
        <button id="btn-settings" class="icon-btn" title="Settings">&#x2699;</button>
      </div>
    </div>

    <div class="connection-bar" id="connection-bar">
      <span class="status-dot status-dot--grey" id="poll-dot"></span>
      <span class="connection-bar__text" id="connection-text">Connecting...</span>
      <span class="agent-info__addr">${agentAddr}</span>
    </div>

    <div class="terminal">
      <div class="terminal__output" id="chat-output">
        <div class="msg msg--status">
          <span class="msg__prompt">[sys] </span>
          <span class="msg__text">Connected to <strong>${escapeHtml(agentLabel)}</strong> via AlgoChat on ${network}</span>
        </div>
      </div>
    </div>

    <div class="input-bar">
      <textarea id="chat-input" class="input-bar__field" rows="1"
        placeholder="Type a message..." autocomplete="off"></textarea>
      <button id="btn-send" class="input-bar__send" disabled>Send</button>
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

  // Load persisted message history from IndexedDB
  loadMessages(connection.address).then((history) => {
    for (const msg of history) {
      store.addMessage(msg);
      appendMessage(msg);
    }
  });

  // Subscribe to incoming messages
  unsubMessages = messaging.onMessage((msg: ChatMessage) => {
    store.addMessage(msg);
    appendMessage(msg);
    // Persist to IndexedDB
    saveMessage(msg, connection.address);
  });

  // Start polling
  messaging.startPolling();
  store.setPolling(true);

  // Update connection status
  const updateStatus = async () => {
    try {
      const online = await messaging.checkAgentOnline();
      store.setAgentOnline(online);
      if (connectionStatus) {
        connectionStatus.className = `header__status ${online ? 'connected' : ''}`;
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
  const statusTimer = setInterval(updateStatus, 30_000);

  // Send message
  const sendMessage = async () => {
    if (!inputEl) return;
    const content = inputEl.value.trim();
    if (!content) return;

    // Create optimistic message
    const tempId = `temp-${Date.now()}`;
    const outMsg: ChatMessage = {
      id: tempId,
      content,
      direction: 'sent',
      timestamp: new Date(),
      status: 'sending',
    };

    store.addMessage(outMsg);
    appendMessage(outMsg);
    // Persist optimistic message
    saveMessage(outMsg, connection.address);

    inputEl.value = '';
    inputEl.style.height = 'auto';
    updateSendButton();

    store.setSending(true);
    if (btnSend) btnSend.setAttribute('disabled', 'true');

    try {
      const txid = await messaging.sendMessage(content);
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
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 200)}px`;
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
    const hasContent = inputEl.value.trim().length > 0;
    if (hasContent) {
      btnSend.removeAttribute('disabled');
    } else {
      btnSend.setAttribute('disabled', 'true');
    }
  }

  // Store cleanup function for when view changes
  (window as unknown as Record<string, unknown>).__chatCleanup = () => {
    clearInterval(statusTimer);
  };
}

function appendMessage(msg: ChatMessage): void {
  if (!outputEl) return;

  // Remove thinking indicator if we got a response
  if (msg.direction === 'received') {
    hideThinking();
  }

  const div = document.createElement('div');
  div.className = `msg msg--${msg.direction === 'sent' ? 'outbound' : 'inbound'}`;
  div.id = `msg-${msg.id}`;

  const prompt =
    msg.direction === 'sent' ? '[you] ' : '[agent] ';
  const statusBadge = msg.status === 'sending'
    ? ' <span style="opacity:0.5">(sending...)</span>'
    : msg.status === 'failed'
      ? ' <span style="color:var(--accent-red)">(failed)</span>'
      : '';

  div.innerHTML = `
    <span class="msg__prompt">${prompt}</span>
    <span class="msg__text">${renderMarkdown(msg.content)}${statusBadge}</span>
    <button class="msg__copy" title="Copy">CP</button>
  `;

  // Copy button
  const copyBtn = div.querySelector('.msg__copy');
  copyBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(msg.content).then(() => {
      if (copyBtn) copyBtn.textContent = '✓';
      setTimeout(() => {
        if (copyBtn) copyBtn.textContent = 'CP';
      }, 1500);
    });
  });

  outputEl.appendChild(div);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function updateMessageEl(id: string, status: ChatMessage['status']): void {
  const el = document.getElementById(`msg-${id}`);
  if (!el) return;

  const statusSpan = el.querySelector('.msg__text span[style]');
  if (statusSpan) {
    if (status === 'confirmed') {
      statusSpan.remove();
    } else if (status === 'failed') {
      statusSpan.outerHTML =
        ' <span style="color:var(--accent-red)">(failed)</span>';
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
  div.innerHTML = `
    <span class="thinking__dot"></span>
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
  messaging.stopPolling();

  const cleanup = (window as unknown as Record<string, unknown>).__chatCleanup;
  if (typeof cleanup === 'function') cleanup();

  outputEl = null;
  inputEl = null;
}
