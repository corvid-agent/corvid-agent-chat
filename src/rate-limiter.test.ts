/**
 * Tests for the client-side message rate limiter
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stubLocalStorage } from './test-utils.ts';

import {
  canSend,
  recordSend,
  getRemainingCooldown,
  getCooldownMs,
  setCooldownMs,
  resetRateLimiter,
} from './rate-limiter.ts';

describe('rate-limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubLocalStorage();
    resetRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── canSend ──

  describe('canSend', () => {
    it('returns true when no message has been sent', () => {
      expect(canSend()).toBe(true);
    });

    it('returns false immediately after a send', () => {
      recordSend();
      expect(canSend()).toBe(false);
    });

    it('returns true after the cooldown period elapses', () => {
      recordSend();
      vi.advanceTimersByTime(1000);
      expect(canSend()).toBe(true);
    });

    it('returns false during the cooldown period', () => {
      recordSend();
      vi.advanceTimersByTime(500);
      expect(canSend()).toBe(false);
    });

    it('always returns true when cooldown is set to 0', () => {
      setCooldownMs(0);
      recordSend();
      expect(canSend()).toBe(true);
    });
  });

  // ── getRemainingCooldown ──

  describe('getRemainingCooldown', () => {
    it('returns 0 when no message has been sent', () => {
      expect(getRemainingCooldown()).toBe(0);
    });

    it('returns the full cooldown right after a send', () => {
      recordSend();
      expect(getRemainingCooldown()).toBe(1000);
    });

    it('decreases over time', () => {
      recordSend();
      vi.advanceTimersByTime(300);
      expect(getRemainingCooldown()).toBe(700);
    });

    it('returns 0 after the cooldown expires', () => {
      recordSend();
      vi.advanceTimersByTime(1200);
      expect(getRemainingCooldown()).toBe(0);
    });

    it('never returns negative values', () => {
      recordSend();
      vi.advanceTimersByTime(5000);
      expect(getRemainingCooldown()).toBe(0);
    });

    it('reflects custom cooldown setting', () => {
      setCooldownMs(3000);
      recordSend();
      expect(getRemainingCooldown()).toBe(3000);
      vi.advanceTimersByTime(1500);
      expect(getRemainingCooldown()).toBe(1500);
    });
  });

  // ── recordSend ──

  describe('recordSend', () => {
    it('resets the cooldown timer', () => {
      recordSend();
      vi.advanceTimersByTime(800);
      expect(getRemainingCooldown()).toBe(200);

      // Send again — cooldown resets
      recordSend();
      expect(getRemainingCooldown()).toBe(1000);
    });

    it('can be called multiple times', () => {
      recordSend();
      recordSend();
      recordSend();
      expect(getRemainingCooldown()).toBe(1000);
    });
  });

  // ── getCooldownMs ──

  describe('getCooldownMs', () => {
    it('returns default (1000ms) when no value is stored', () => {
      expect(getCooldownMs()).toBe(1000);
    });

    it('returns stored value', () => {
      localStorage.setItem('corvid-rate-limit-ms', '2000');
      expect(getCooldownMs()).toBe(2000);
    });

    it('returns default for invalid stored values', () => {
      localStorage.setItem('corvid-rate-limit-ms', 'abc');
      expect(getCooldownMs()).toBe(1000);
    });

    it('clamps negative values to 0', () => {
      localStorage.setItem('corvid-rate-limit-ms', '-500');
      expect(getCooldownMs()).toBe(0);
    });

    it('clamps values exceeding max to 10000', () => {
      localStorage.setItem('corvid-rate-limit-ms', '99999');
      expect(getCooldownMs()).toBe(10000);
    });
  });

  // ── setCooldownMs ──

  describe('setCooldownMs', () => {
    it('stores the value in localStorage', () => {
      setCooldownMs(2000);
      expect(localStorage.getItem('corvid-rate-limit-ms')).toBe('2000');
    });

    it('clamps negative values to 0', () => {
      setCooldownMs(-100);
      expect(getCooldownMs()).toBe(0);
    });

    it('clamps values over 10000 to 10000', () => {
      setCooldownMs(50000);
      expect(getCooldownMs()).toBe(10000);
    });

    it('accepts 0 to disable rate limiting', () => {
      setCooldownMs(0);
      expect(getCooldownMs()).toBe(0);
    });

    it('accepts the maximum value', () => {
      setCooldownMs(10000);
      expect(getCooldownMs()).toBe(10000);
    });

    it('rounds the stored value when read back', () => {
      setCooldownMs(1500);
      expect(getCooldownMs()).toBe(1500);
    });
  });

  // ── resetRateLimiter ──

  describe('resetRateLimiter', () => {
    it('clears the last send time', () => {
      recordSend();
      expect(canSend()).toBe(false);
      resetRateLimiter();
      expect(canSend()).toBe(true);
    });

    it('does not affect the stored cooldown setting', () => {
      setCooldownMs(5000);
      resetRateLimiter();
      expect(getCooldownMs()).toBe(5000);
    });
  });

  // ── Integration scenarios ──

  describe('integration', () => {
    it('allows rapid sends when cooldown is disabled', () => {
      setCooldownMs(0);
      for (let i = 0; i < 10; i++) {
        expect(canSend()).toBe(true);
        recordSend();
      }
    });

    it('enforces cooldown across multiple sends', () => {
      setCooldownMs(500);

      recordSend();
      expect(canSend()).toBe(false);

      vi.advanceTimersByTime(500);
      expect(canSend()).toBe(true);

      recordSend();
      expect(canSend()).toBe(false);

      vi.advanceTimersByTime(500);
      expect(canSend()).toBe(true);
    });

    it('changing cooldown takes effect immediately', () => {
      setCooldownMs(5000);
      recordSend();
      expect(getRemainingCooldown()).toBe(5000);

      // Reduce cooldown
      setCooldownMs(500);
      vi.advanceTimersByTime(500);
      expect(canSend()).toBe(true);
    });

    it('increasing cooldown extends the existing wait', () => {
      setCooldownMs(500);
      recordSend();
      vi.advanceTimersByTime(400); // 100ms remaining at 500ms cooldown

      setCooldownMs(2000);
      // Now 400ms elapsed of a 2000ms cooldown = 1600ms remaining
      expect(getRemainingCooldown()).toBe(1600);
      expect(canSend()).toBe(false);
    });
  });
});
