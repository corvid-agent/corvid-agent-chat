/**
 * File handling for on-chain message attachments.
 *
 * Algorand note field is 1024 bytes. After PSK encryption overhead (~100 bytes)
 * and the device envelope JSON wrapper, roughly 600 bytes of base64 data can
 * fit. For images, we compress to tiny JPEG thumbnails using canvas. For other
 * files, only very small files can be sent inline.
 */
import type { Attachment } from './types.ts';

/** Maximum base64 characters that fit in the Algorand note after overhead. */
export const MAX_INLINE_BASE64 = 600;

/** Maximum raw bytes for inline files (~450 bytes = ~600 base64 chars). */
export const MAX_INLINE_BYTES = 450;

/** Accepted MIME type prefixes for images. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Accepted file types for non-image files. */
const ALLOWED_FILE_TYPES = [
  'text/plain',
  'text/csv',
  'application/json',
  'text/markdown',
  'text/html',
];

/** Maximum file size we will attempt to process (5 MB). */
const MAX_INPUT_FILE_SIZE = 5 * 1024 * 1024;

export interface ProcessedFile {
  attachment: Attachment;
  /** Caption text to include in the message content field. */
  caption: string;
}

/**
 * Determine whether a MIME type is an image we can thumbnail.
 */
export function isImageType(mimeType: string): boolean {
  return IMAGE_TYPES.some((t) => mimeType.startsWith(t.split('/')[0]!));
}

/**
 * Determine whether a file type is accepted for sharing.
 */
export function isAcceptedType(mimeType: string): boolean {
  if (mimeType.startsWith('image/')) return true;
  return ALLOWED_FILE_TYPES.includes(mimeType);
}

/**
 * Get a human-readable file size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Convert a Uint8Array to a base64 string.
 */
function arrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Convert a base64 string to a Uint8Array.
 */
export function base64ToArray(b64: string): Uint8Array {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
}

/**
 * Create a compressed JPEG thumbnail from an image file using canvas.
 * Progressively reduces size and quality to fit within the byte limit.
 */
async function createThumbnail(
  file: File,
  maxDim: number,
  quality: number,
): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Calculate dimensions preserving aspect ratio
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h / w) * maxDim);
          w = maxDim;
        } else {
          w = Math.round((w / h) * maxDim);
          h = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          blob.arrayBuffer().then((buf) => {
            resolve(new Uint8Array(buf));
          });
        },
        'image/jpeg',
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * Process a file for sending as an on-chain attachment.
 *
 * For images: generates a JPEG thumbnail small enough to fit inline.
 * For other files: includes raw bytes if small enough.
 * Throws if the file cannot fit within the on-chain size limit.
 */
export async function processFile(file: File): Promise<ProcessedFile> {
  if (file.size > MAX_INPUT_FILE_SIZE) {
    throw new Error(`File too large (${formatFileSize(file.size)}). Maximum input size is ${formatFileSize(MAX_INPUT_FILE_SIZE)}.`);
  }

  if (!isAcceptedType(file.type)) {
    throw new Error(`File type "${file.type || 'unknown'}" is not supported. Accepted: images, text, CSV, JSON, markdown.`);
  }

  // ── Image files: create compressed thumbnail ──
  if (file.type.startsWith('image/')) {
    // Try progressively smaller thumbnails until one fits
    const attempts: Array<{ maxDim: number; quality: number }> = [
      { maxDim: 64, quality: 0.3 },
      { maxDim: 48, quality: 0.25 },
      { maxDim: 32, quality: 0.2 },
      { maxDim: 24, quality: 0.15 },
      { maxDim: 16, quality: 0.1 },
    ];

    for (const { maxDim, quality } of attempts) {
      const thumbnail = await createThumbnail(file, maxDim, quality);
      if (!thumbnail) continue;

      const b64 = arrayToBase64(thumbnail);
      if (b64.length <= MAX_INLINE_BASE64) {
        return {
          attachment: {
            type: 'image',
            mimeType: 'image/jpeg',
            fileName: file.name,
            size: file.size,
            base64: b64,
          },
          caption: `[image: ${file.name} (${formatFileSize(file.size)})]`,
        };
      }
    }

    throw new Error(
      `Image "${file.name}" could not be compressed small enough for on-chain storage. ` +
      `Try a smaller image or lower resolution.`
    );
  }

  // ── Non-image files: include raw bytes if small enough ──
  const bytes = new Uint8Array(await file.arrayBuffer());
  const b64 = arrayToBase64(bytes);

  if (b64.length <= MAX_INLINE_BASE64) {
    return {
      attachment: {
        type: 'file',
        mimeType: file.type || 'application/octet-stream',
        fileName: file.name,
        size: file.size,
        base64: b64,
      },
      caption: `[file: ${file.name} (${formatFileSize(file.size)})]`,
    };
  }

  throw new Error(
    `File "${file.name}" (${formatFileSize(file.size)}) is too large for on-chain storage. ` +
    `Maximum inline size is ~${MAX_INLINE_BYTES} bytes. IPFS support coming soon.`
  );
}

/**
 * Create an <img> element displaying an inline base64 image attachment.
 */
export function createImagePreview(attachment: Attachment): HTMLElement {
  const container = document.createElement('div');
  container.className = 'attachment attachment--image';

  if (attachment.base64) {
    const img = document.createElement('img');
    img.src = `data:${attachment.mimeType};base64,${attachment.base64}`;
    img.alt = attachment.fileName;
    img.className = 'attachment__img';
    img.title = `${attachment.fileName} (${formatFileSize(attachment.size)})`;
    container.appendChild(img);
  }

  const info = document.createElement('span');
  info.className = 'attachment__info';
  info.textContent = `${attachment.fileName} (${formatFileSize(attachment.size)})`;
  container.appendChild(info);

  return container;
}

/**
 * Create a download link or info display for a file attachment.
 */
export function createFileDownload(attachment: Attachment): HTMLElement {
  const container = document.createElement('div');
  container.className = 'attachment attachment--file';

  const icon = document.createElement('span');
  icon.className = 'attachment__icon';
  icon.textContent = '\u{1F4CE}'; // paperclip emoji
  container.appendChild(icon);

  if (attachment.base64) {
    const link = document.createElement('a');
    const bytes = base64ToArray(attachment.base64);
    const blob = new Blob([bytes], { type: attachment.mimeType });
    link.href = URL.createObjectURL(blob);
    link.download = attachment.fileName;
    link.className = 'attachment__link';
    link.textContent = attachment.fileName;
    link.title = `Download ${attachment.fileName} (${formatFileSize(attachment.size)})`;
    container.appendChild(link);
  } else {
    const name = document.createElement('span');
    name.className = 'attachment__name';
    name.textContent = attachment.fileName;
    container.appendChild(name);
  }

  const size = document.createElement('span');
  size.className = 'attachment__size';
  size.textContent = formatFileSize(attachment.size);
  container.appendChild(size);

  return container;
}
