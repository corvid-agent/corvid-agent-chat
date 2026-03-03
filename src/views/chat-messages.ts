/**
 * Chat messages — message rendering, date separators, status updates, and thinking indicator
 */
import { renderMarkdown } from '../markdown.ts';
import { showToast } from '../toast.ts';
import type { ChatMessage } from '../types.ts';
import { escapeHtml, formatTime, formatDateLabel } from '../utils.ts';
import { getDeviceName } from '../device-name.ts';
import { createImagePreview, createFileDownload } from '../file-handler.ts';
import { messaging } from '../messaging.ts';
import { store } from '../store.ts';
import { updateMessageStatus as dbUpdateStatus } from '../db.ts';

/** Duration to show copy confirmation before reverting (ms) */
const COPY_FEEDBACK_MS = 1_500;

/* ── Module state ── */
let lastMessageDate: string | null = null;
let outputEl: HTMLElement | null = null;

/** Set the output element reference for message rendering */
export function setOutputEl(el: HTMLElement | null): void {
  outputEl = el;
}

export function appendMessage(msg: ChatMessage): void {
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
        'error',
      );
    }
  });

  outputEl.appendChild(div);
  outputEl.scrollTop = outputEl.scrollHeight;
}

export function updateMessageEl(id: string, status: ChatMessage['status']): void {
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

export function showThinking(): void {
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

export function hideThinking(): void {
  document.getElementById('thinking-indicator')?.remove();
}

/** Reset message module state (for cleanup) */
export function resetMessageState(): void {
  lastMessageDate = null;
  outputEl = null;
}
