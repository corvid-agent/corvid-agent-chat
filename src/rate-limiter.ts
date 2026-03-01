/**
 * Client-side message rate limiter
 * Prevents rapid-fire sends to conserve Algorand transaction fees
 */

const RATE_LIMIT_KEY = 'corvid-rate-limit-ms';
const DEFAULT_COOLDOWN_MS = 1_000;
const MIN_COOLDOWN_MS = 0;
const MAX_COOLDOWN_MS = 10_000;

let lastSendTime = 0;

/**
 * Check whether a message can be sent right now.
 * Returns the remaining cooldown in ms (0 = ready to send).
 */
export function getRemainingCooldown(): number {
  const cooldown = getCooldownMs();
  if (cooldown === 0) return 0;
  const elapsed = Date.now() - lastSendTime;
  return Math.max(0, cooldown - elapsed);
}

/**
 * Returns true if the rate limiter allows sending right now.
 */
export function canSend(): boolean {
  return getRemainingCooldown() === 0;
}

/**
 * Record that a message was just sent.
 * Call this after the user initiates a send.
 */
export function recordSend(): void {
  lastSendTime = Date.now();
}

/**
 * Get the configured cooldown in milliseconds.
 */
export function getCooldownMs(): number {
  const raw = localStorage.getItem(RATE_LIMIT_KEY);
  if (raw === null) return DEFAULT_COOLDOWN_MS;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) return DEFAULT_COOLDOWN_MS;
  return Math.max(MIN_COOLDOWN_MS, Math.min(MAX_COOLDOWN_MS, parsed));
}

/**
 * Set the cooldown in milliseconds. Clamped to [0, 10000].
 */
export function setCooldownMs(ms: number): void {
  const clamped = Math.max(MIN_COOLDOWN_MS, Math.min(MAX_COOLDOWN_MS, ms));
  localStorage.setItem(RATE_LIMIT_KEY, String(clamped));
}

/**
 * Reset the rate limiter state (for testing or re-initialization).
 */
export function resetRateLimiter(): void {
  lastSendTime = 0;
}
