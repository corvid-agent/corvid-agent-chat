/**
 * Device name persistence and message envelope handling.
 * Allows multi-device identification in PSK chat.
 */

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

/** Wrap message content with device envelope if a name is set. */
export function wrapWithDeviceName(content: string): string {
  const name = getDeviceName();
  if (!name) return content;
  return JSON.stringify({ d: name, m: content });
}

/** Parse a device envelope, falling back to plain text. */
export function parseDeviceEnvelope(raw: string): { deviceName?: string; content: string } {
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.m === 'string') {
        return {
          deviceName: typeof parsed.d === 'string' ? parsed.d : undefined,
          content: parsed.m,
        };
      }
    } catch { /* plain text */ }
  }
  return { content: raw };
}
