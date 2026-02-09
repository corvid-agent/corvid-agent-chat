/**
 * Shared utility functions
 */

/**
 * Escape HTML entities to prevent XSS
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert a Uint8Array to a base64 string
 */
export function bufferToBase64(buf: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]!);
  }
  return btoa(binary);
}

/**
 * Convert a base64 string to a Uint8Array
 */
export function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
}

/**
 * Shorten an Algorand address for display
 */
export function shortenAddress(
  address: string,
  prefixLen = 6,
  suffixLen = 4
): string {
  if (address.length <= prefixLen + suffixLen + 3) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}
