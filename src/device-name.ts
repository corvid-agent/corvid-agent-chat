/**
 * Device name persistence and message envelope handling.
 * Allows multi-device identification in PSK chat.
 */
import type { Attachment } from './types.ts';

const STORAGE_KEY = 'corvid-device-name';
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,16}$/;

/** Read the device name from localStorage, or null if not set. */
export function getDeviceName(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Validate and persist a device name. Returns true on success. */
export function setDeviceName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === '') {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  }
  if (!NAME_PATTERN.test(trimmed)) return false;
  localStorage.setItem(STORAGE_KEY, trimmed);
  return true;
}

/** Compact attachment representation for the on-chain envelope. */
interface EnvelopeAttachment {
  /** 'i' = image, 'f' = file */
  t: string;
  /** MIME type */
  mt: string;
  /** File name */
  fn: string;
  /** Original file size in bytes */
  sz: number;
  /** Base64-encoded data (inline) */
  b?: string;
  /** IPFS CID (future) */
  h?: string;
}

function attachmentToEnvelope(a: Attachment): EnvelopeAttachment {
  return {
    t: a.type === 'image' ? 'i' : 'f',
    mt: a.mimeType,
    fn: a.fileName,
    sz: a.size,
    ...(a.base64 ? { b: a.base64 } : {}),
    ...(a.ipfsHash ? { h: a.ipfsHash } : {}),
  };
}

function envelopeToAttachment(e: EnvelopeAttachment): Attachment {
  return {
    type: e.t === 'i' ? 'image' : 'file',
    mimeType: e.mt,
    fileName: e.fn,
    size: e.sz,
    ...(e.b ? { base64: e.b } : {}),
    ...(e.h ? { ipfsHash: e.h } : {}),
  };
}

/** Wrap message content with device envelope. Optionally includes an attachment. */
export function wrapWithDeviceName(content: string, attachment?: Attachment): string {
  const name = getDeviceName();
  if (!name && !attachment) return content;

  const envelope: Record<string, unknown> = { m: content };
  if (name) envelope.d = name;
  if (attachment) envelope.a = attachmentToEnvelope(attachment);

  return JSON.stringify(envelope);
}

/** Parse a device envelope, falling back to plain text. */
export function parseDeviceEnvelope(raw: string): {
  deviceName?: string;
  content: string;
  attachment?: Attachment;
} {
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.m === 'string') {
        const result: { deviceName?: string; content: string; attachment?: Attachment } = {
          deviceName: typeof parsed.d === 'string' ? parsed.d : undefined,
          content: parsed.m,
        };
        if (parsed.a && typeof parsed.a === 'object' && parsed.a.t && parsed.a.mt && parsed.a.fn) {
          result.attachment = envelopeToAttachment(parsed.a as EnvelopeAttachment);
        }
        return result;
      }
    } catch { /* plain text */ }
  }
  return { content: raw };
}
