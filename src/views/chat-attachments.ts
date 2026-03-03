/**
 * Chat attachments — file selection, drag-and-drop, and preview management
 */
import type { Attachment } from '../types.ts';
import { showToast } from '../toast.ts';
import { processFile, formatFileSize, isAcceptedType } from '../file-handler.ts';

/* ── Module state ── */
let pendingAttachment: Attachment | null = null;
let pendingCaption: string | null = null;

/* ── Captured DOM refs ── */
let attachmentPreview: HTMLElement | null = null;
let attachmentPreviewInfo: HTMLElement | null = null;
let fileInput: HTMLInputElement | null = null;

export function getPendingAttachment(): Attachment | null {
  return pendingAttachment;
}

export function getPendingCaption(): string | null {
  return pendingCaption;
}

function showAttachmentPreview(caption: string, updateSendButton: () => void): void {
  if (attachmentPreview) attachmentPreview.style.display = '';
  if (attachmentPreviewInfo) attachmentPreviewInfo.textContent = caption;
  updateSendButton();
}

export function clearPendingAttachment(updateSendButton: () => void): void {
  pendingAttachment = null;
  pendingCaption = null;
  if (attachmentPreview) attachmentPreview.style.display = 'none';
  if (attachmentPreviewInfo) attachmentPreviewInfo.textContent = '';
  if (fileInput) fileInput.value = '';
  updateSendButton();
}

async function handleFileSelection(file: File, updateSendButton: () => void): Promise<void> {
  try {
    const processed = await processFile(file);
    pendingAttachment = processed.attachment;
    pendingCaption = processed.caption;
    showAttachmentPreview(
      `${pendingAttachment.type === 'image' ? 'Image' : 'File'}: ${file.name} (${formatFileSize(file.size)})`,
      updateSendButton,
    );
  } catch (err) {
    showToast(
      err instanceof Error ? err.message : 'Failed to process file',
      'error',
    );
    clearPendingAttachment(updateSendButton);
  }
}

/**
 * Bind all attachment-related event listeners.
 * Returns a cleanup function to clear pending state.
 */
export function bindAttachmentEvents(
  outputEl: HTMLElement | null,
  updateSendButton: () => void,
): () => void {
  const btnAttach = document.getElementById('btn-attach');
  fileInput = document.getElementById('file-input') as HTMLInputElement | null;
  attachmentPreview = document.getElementById('attachment-preview');
  attachmentPreviewInfo = document.getElementById('attachment-preview-info');
  const attachmentPreviewCancel = document.getElementById('attachment-preview-cancel');

  // Reset pending attachment state
  pendingAttachment = null;
  pendingCaption = null;

  // Attach button click
  btnAttach?.addEventListener('click', () => {
    fileInput?.click();
  });

  // File input change
  fileInput?.addEventListener('change', () => {
    const file = fileInput!.files?.[0];
    if (file) handleFileSelection(file, updateSendButton);
  });

  // Cancel attachment
  attachmentPreviewCancel?.addEventListener('click', () => {
    clearPendingAttachment(updateSendButton);
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
          handleFileSelection(file, updateSendButton);
        } else {
          showToast(`File type "${file.type || 'unknown'}" is not supported`, 'error');
        }
      }
    });
  }

  return () => {
    pendingAttachment = null;
    pendingCaption = null;
  };
}

/** Reset attachment module state (for cleanup) */
export function resetAttachmentState(): void {
  pendingAttachment = null;
  pendingCaption = null;
  attachmentPreview = null;
  attachmentPreviewInfo = null;
  fileInput = null;
}
