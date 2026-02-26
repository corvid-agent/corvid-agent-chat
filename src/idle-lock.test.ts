/**
 * Tests for inactivity auto-lock feature
 * Verifies timer management, event listener setup/teardown, and timeout config
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const STORAGE_KEY = 'corvid-idle-timeout';

// Provide a localStorage mock before module imports use it
const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storageMap.set(key, value)),
  removeItem: vi.fn((key: string) => storageMap.delete(key)),
  clear: vi.fn(() => storageMap.clear()),
  get length() { return storageMap.size; },
  key: vi.fn((_index: number) => null),
};
vi.stubGlobal('localStorage', localStorageMock);

// Mock the imported modules that idle-lock depends on
vi.mock('./store.ts', () => ({
  store: {
    getState: vi.fn(() => ({ wallet: { unlocked: true } })),
    lockWallet: vi.fn(),
  },
}));

vi.mock('./wallet.ts', () => ({
  lockWallet: vi.fn(),
}));

vi.mock('./messaging.ts', () => ({
  messaging: {
    destroy: vi.fn(),
  },
}));

vi.mock('./toast.ts', () => ({
  showToast: vi.fn(),
}));

// Import after mocks are set up
import { getIdleTimeout, setIdleTimeout, startIdleLock, stopIdleLock } from './idle-lock.ts';

beforeEach(async () => {
  storageMap.clear();
  vi.useFakeTimers();
  stopIdleLock();
  // Clear mock call counts for the module mocks, but NOT localStorage
  // since vi.clearAllMocks() would wipe the localStorage mock implementations
  const { store } = await import('./store.ts');
  const { lockWallet } = await import('./wallet.ts');
  const { messaging } = await import('./messaging.ts');
  const { showToast } = await import('./toast.ts');
  vi.mocked(store.getState).mockReturnValue({ wallet: { unlocked: true } } as ReturnType<typeof store.getState>);
  vi.mocked(store.lockWallet).mockClear();
  vi.mocked(lockWallet).mockClear();
  vi.mocked(messaging.destroy).mockClear();
  vi.mocked(showToast).mockClear();
});

afterEach(() => {
  stopIdleLock();
  vi.useRealTimers();
});

describe('getIdleTimeout', () => {
  it('returns default 15 minutes when no custom value stored', () => {
    expect(getIdleTimeout()).toBe(15 * 60 * 1000);
  });

  it('returns stored value when set', () => {
    storageMap.set(STORAGE_KEY, String(5 * 60 * 1000));
    expect(getIdleTimeout()).toBe(5 * 60 * 1000);
  });

  it('returns default for invalid stored value', () => {
    storageMap.set(STORAGE_KEY, 'not-a-number');
    expect(getIdleTimeout()).toBe(15 * 60 * 1000);
  });

  it('returns default for zero stored value', () => {
    storageMap.set(STORAGE_KEY, '0');
    expect(getIdleTimeout()).toBe(15 * 60 * 1000);
  });

  it('returns default for negative stored value', () => {
    storageMap.set(STORAGE_KEY, '-1000');
    expect(getIdleTimeout()).toBe(15 * 60 * 1000);
  });
});

describe('setIdleTimeout', () => {
  it('stores timeout in ms based on minutes input', () => {
    setIdleTimeout(10);
    expect(storageMap.get(STORAGE_KEY)).toBe(String(10 * 60 * 1000));
  });

  it('removes stored value and stops lock when minutes <= 0', () => {
    setIdleTimeout(10);
    expect(storageMap.has(STORAGE_KEY)).toBe(true);

    setIdleTimeout(0);
    expect(storageMap.has(STORAGE_KEY)).toBe(false);
  });

  it('removes stored value for negative minutes', () => {
    setIdleTimeout(10);
    setIdleTimeout(-5);
    expect(storageMap.has(STORAGE_KEY)).toBe(false);
  });
});

describe('startIdleLock / stopIdleLock', () => {
  it('starts without error', () => {
    expect(() => startIdleLock()).not.toThrow();
  });

  it('stops without error even if never started', () => {
    expect(() => stopIdleLock()).not.toThrow();
  });

  it('fires lock callback after timeout elapses', async () => {
    const { store } = await import('./store.ts');
    const { lockWallet } = await import('./wallet.ts');
    const { messaging } = await import('./messaging.ts');
    const { showToast } = await import('./toast.ts');

    startIdleLock();

    // Advance past default 15-minute timeout
    vi.advanceTimersByTime(15 * 60 * 1000 + 100);

    expect(messaging.destroy).toHaveBeenCalled();
    expect(lockWallet).toHaveBeenCalled();
    expect(store.lockWallet).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'Wallet locked due to inactivity',
      'info'
    );
  });

  it('does not fire lock before timeout', async () => {
    const { lockWallet } = await import('./wallet.ts');

    startIdleLock();

    // Advance to just before the timeout
    vi.advanceTimersByTime(15 * 60 * 1000 - 1000);

    expect(lockWallet).not.toHaveBeenCalled();
  });

  it('resets timer on user activity events', async () => {
    const { lockWallet } = await import('./wallet.ts');

    startIdleLock();

    // Advance to 14 minutes (close to timeout)
    vi.advanceTimersByTime(14 * 60 * 1000);

    // Simulate user activity (keydown event resets the timer)
    document.dispatchEvent(new Event('keydown'));

    // Advance another 14 minutes (would have fired if timer wasn't reset)
    vi.advanceTimersByTime(14 * 60 * 1000);

    expect(lockWallet).not.toHaveBeenCalled();

    // Now advance past the full timeout from the reset point
    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(lockWallet).toHaveBeenCalled();
  });

  it('does not lock when wallet is not unlocked', async () => {
    const { store } = await import('./store.ts');
    const { lockWallet } = await import('./wallet.ts');

    // Override to return unlocked: false
    vi.mocked(store.getState).mockReturnValue({
      wallet: { unlocked: false, address: null, balance: 0 },
      view: 'setup',
      agent: { connection: null, online: false, lastSeen: null },
      chat: { messages: [], polling: false, sending: false },
    });

    startIdleLock();
    vi.advanceTimersByTime(15 * 60 * 1000 + 100);

    expect(lockWallet).not.toHaveBeenCalled();
  });

  it('stops timer on stopIdleLock', async () => {
    const { lockWallet } = await import('./wallet.ts');

    startIdleLock();
    vi.advanceTimersByTime(10 * 60 * 1000);

    stopIdleLock();

    // Advance well past the original timeout
    vi.advanceTimersByTime(20 * 60 * 1000);

    expect(lockWallet).not.toHaveBeenCalled();
  });

  it('uses custom timeout from localStorage', async () => {
    const { lockWallet } = await import('./wallet.ts');

    // Set a 5-minute timeout
    setIdleTimeout(5);
    startIdleLock();

    // 4 minutes: should not fire
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(lockWallet).not.toHaveBeenCalled();

    // 5 minutes + buffer: should fire
    vi.advanceTimersByTime(1 * 60 * 1000 + 100);
    expect(lockWallet).toHaveBeenCalled();
  });

  it('cleans up event listeners on stop', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    startIdleLock();
    stopIdleLock();

    // Should remove listeners for mousedown, keydown, touchstart, scroll
    const removedEvents = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedEvents).toContain('mousedown');
    expect(removedEvents).toContain('keydown');
    expect(removedEvents).toContain('touchstart');
    expect(removedEvents).toContain('scroll');

    removeSpy.mockRestore();
  });
});
