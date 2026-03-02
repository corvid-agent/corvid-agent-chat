/**
 * Inactivity auto-lock for wallet security
 * Locks the wallet after a period of user inactivity.
 */
import { store } from './store.ts';
import { lockWallet } from './wallet.ts';
import { messaging } from './messaging.ts';
import { showToast } from './toast.ts';

/** Default inactivity timeout: 15 minutes */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const STORAGE_KEY = 'corvid-idle-timeout';

/** User interaction events that reset the inactivity timer */
const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
];

let timer: ReturnType<typeof setTimeout> | null = null;
let boundReset: (() => void) | null = null;
let lastActivity: number = Date.now();
let boundVisibility: (() => void) | null = null;

/**
 * Get the configured timeout in ms (default 15 min)
 */
export function getIdleTimeout(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const val = parseInt(raw, 10);
    if (val > 0) return val;
  }
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Set the idle timeout in minutes. Pass 0 to disable.
 */
export function setIdleTimeout(minutes: number): void {
  if (minutes <= 0) {
    localStorage.removeItem(STORAGE_KEY);
    stopIdleLock();
    return;
  }
  localStorage.setItem(STORAGE_KEY, String(minutes * 60 * 1_000));
}

/**
 * Start monitoring for inactivity
 */
export function startIdleLock(): void {
  stopIdleLock(); // clean up any existing

  const timeout = getIdleTimeout();
  if (timeout <= 0) return;

  boundReset = () => {
    lastActivity = Date.now();
    resetTimer(timeout);
  };

  boundVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    const elapsed = Date.now() - lastActivity;
    if (elapsed >= timeout) {
      triggerLock();
    }
  };

  for (const event of ACTIVITY_EVENTS) {
    document.addEventListener(event, boundReset, { passive: true });
  }
  document.addEventListener('visibilitychange', boundVisibility);

  lastActivity = Date.now();
  resetTimer(timeout);
}

/**
 * Stop monitoring for inactivity
 */
export function stopIdleLock(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (boundReset) {
    for (const event of ACTIVITY_EVENTS) {
      document.removeEventListener(event, boundReset);
    }
    boundReset = null;
  }
  if (boundVisibility) {
    document.removeEventListener('visibilitychange', boundVisibility);
    boundVisibility = null;
  }
}

function triggerLock(): void {
  const state = store.getState();
  if (!state.wallet.unlocked) return;

  stopIdleLock();
  messaging.destroy();
  lockWallet();
  store.lockWallet();
  showToast('Wallet locked due to inactivity', 'info');
}

function resetTimer(timeout: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => triggerLock(), timeout);
}
