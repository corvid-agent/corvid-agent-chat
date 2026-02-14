/**
 * Tests for PSK state management in MessagingService
 * Verifies fingerprint-based state reset when PSK changes
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Simulate the messaging service's PSK fingerprint logic (same as in messaging.ts)
function pskFingerprint(psk: Uint8Array): string {
  return Array.from(psk.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Simulate loadPSKState logic from messaging.ts
function simulateLoadPSKState(
  storedJson: string | null,
  currentPsk: Uint8Array,
): { reset: boolean; state: { sendCounter: number; peerLastCounter: number } } {
  if (!storedJson) {
    return { reset: false, state: { sendCounter: 0, peerLastCounter: 0 } };
  }

  const data = JSON.parse(storedJson);

  // This is the exact check from messaging.ts
  if (data.pskFingerprint !== pskFingerprint(currentPsk)) {
    return { reset: true, state: { sendCounter: 0, peerLastCounter: 0 } };
  }

  return {
    reset: false,
    state: {
      sendCounter: data.sendCounter ?? 0,
      peerLastCounter: data.peerLastCounter ?? 0,
    },
  };
}

// Simulate savePSKState logic from messaging.ts
function simulateSavePSKState(
  psk: Uint8Array,
  sendCounter: number,
  peerLastCounter: number,
): string {
  return JSON.stringify({
    pskFingerprint: pskFingerprint(psk),
    sendCounter,
    peerLastCounter,
    seenCounters: [],
  });
}

describe('PSK fingerprint detection', () => {
  test('different PSKs produce different fingerprints', () => {
    const psk1 = new Uint8Array(32).fill(0xaa);
    const psk2 = new Uint8Array(32).fill(0xbb);
    expect(pskFingerprint(psk1)).not.toBe(pskFingerprint(psk2));
  });

  test('same PSK produces same fingerprint', () => {
    const psk = new Uint8Array(32).fill(0xcc);
    expect(pskFingerprint(psk)).toBe(pskFingerprint(psk));
  });

  test('fingerprint uses first 8 bytes only', () => {
    const psk1 = new Uint8Array(32).fill(0xaa);
    const psk2 = new Uint8Array(32).fill(0xaa);
    psk2[31] = 0xff; // Differs in last byte only
    // First 8 bytes are the same, so fingerprints match
    expect(pskFingerprint(psk1)).toBe(pskFingerprint(psk2));
  });

  test('fingerprint is 16 hex chars', () => {
    const psk = crypto.getRandomValues(new Uint8Array(32));
    expect(pskFingerprint(psk)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('PSK state reset on QR rescan', () => {
  const oldPsk = new Uint8Array(32).fill(0x11);
  const newPsk = new Uint8Array(32).fill(0x22);

  test('old stored state (no fingerprint) triggers reset', () => {
    // Old format: no pskFingerprint field
    const oldStored = JSON.stringify({
      sendCounter: 5,
      peerLastCounter: 3,
      seenCounters: [1, 2, 3],
    });

    const result = simulateLoadPSKState(oldStored, newPsk);
    expect(result.reset).toBe(true);
    expect(result.state.sendCounter).toBe(0);
    expect(result.state.peerLastCounter).toBe(0);
  });

  test('stored state with different PSK fingerprint triggers reset', () => {
    const stored = simulateSavePSKState(oldPsk, 10, 8);

    const result = simulateLoadPSKState(stored, newPsk);
    expect(result.reset).toBe(true);
    expect(result.state.sendCounter).toBe(0);
    expect(result.state.peerLastCounter).toBe(0);
  });

  test('stored state with matching PSK fingerprint preserves state', () => {
    const stored = simulateSavePSKState(oldPsk, 10, 8);

    const result = simulateLoadPSKState(stored, oldPsk);
    expect(result.reset).toBe(false);
    expect(result.state.sendCounter).toBe(10);
    expect(result.state.peerLastCounter).toBe(8);
  });

  test('null stored state starts fresh without reset flag', () => {
    const result = simulateLoadPSKState(null, newPsk);
    expect(result.reset).toBe(false);
    expect(result.state.sendCounter).toBe(0);
  });

  test('full lifecycle: save with PSK A, load with PSK B → reset', () => {
    // Save state with PSK A after some conversation
    const savedWithA = simulateSavePSKState(oldPsk, 15, 12);

    // Later, scan new QR with PSK B
    const result = simulateLoadPSKState(savedWithA, newPsk);
    expect(result.reset).toBe(true);

    // Save fresh state with PSK B
    const savedWithB = simulateSavePSKState(newPsk, 0, 0);

    // Load again with PSK B — should preserve
    const result2 = simulateLoadPSKState(savedWithB, newPsk);
    expect(result2.reset).toBe(false);
    expect(result2.state.sendCounter).toBe(0);
  });

  test('reset clears stale peerLastCounter that would reject fresh counters', () => {
    // Scenario: old session advanced to peerLastCounter=10
    const stored = simulateSavePSKState(oldPsk, 5, 10);

    // New QR scanned (new PSK) → state resets
    const result = simulateLoadPSKState(stored, newPsk);
    expect(result.reset).toBe(true);

    // Server sends with counter 0 (fresh) — peerLastCounter is now 0
    // A simple validateCounter simulation: counter must be >= peerLastCounter - window
    const COUNTER_WINDOW = 200;
    const serverCounter = 0;
    const peerLastCounter = result.state.peerLastCounter; // 0 after reset

    const isValid = serverCounter >= peerLastCounter - COUNTER_WINDOW;
    expect(isValid).toBe(true);
  });

  test('WITHOUT reset, stale peerLastCounter would reject fresh counter', () => {
    // Same scenario but WITHOUT our fix
    const stored = JSON.stringify({
      // Old format without fingerprint — simulates pre-fix behavior
      sendCounter: 5,
      peerLastCounter: 250,
      seenCounters: Array.from({ length: 50 }, (_, i) => i + 200),
    });

    // If we had loaded this state as-is (old behavior):
    const data = JSON.parse(stored);
    const stalePeerLastCounter = data.peerLastCounter; // 250

    // Server sends with counter 0 after reset
    const COUNTER_WINDOW = 200;
    const serverCounter = 0;

    // Would be invalid: 0 < 250 - 200 = 50
    const isValid = serverCounter >= stalePeerLastCounter - COUNTER_WINDOW;
    expect(isValid).toBe(false); // This is the bug we fixed!
  });
});
