import { vi } from 'vitest';

/**
 * Stub `globalThis.localStorage` with a Map-backed implementation.
 * Node.js's built-in localStorage lacks `.clear()` and `.removeItem()`,
 * so tests that touch localStorage need this full mock.
 *
 * Returns the backing store and individual method spies for assertions.
 */
export function stubLocalStorage() {
  const store = new Map<string, string>();
  const getItem = vi.fn((key: string) => store.get(key) ?? null);
  const setItem = vi.fn((key: string, val: string) => { store.set(key, String(val)); });
  const removeItem = vi.fn((key: string) => { store.delete(key); });
  const clear = vi.fn(() => { store.clear(); });
  const key = vi.fn((i: number) => [...store.keys()][i] ?? null);

  vi.stubGlobal('localStorage', {
    getItem,
    setItem,
    removeItem,
    clear,
    get length() { return store.size; },
    key,
  });

  return { store, getItem, setItem, removeItem, clear, key };
}
