/**
 * Tests for toast notification system
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showToast } from './toast.ts';

describe('showToast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a toast container on first call', () => {
    showToast('hello');
    const container = document.querySelector('.toast-container');
    expect(container).not.toBeNull();
    expect(container?.getAttribute('role')).toBe('status');
    expect(container?.getAttribute('aria-live')).toBe('polite');
  });

  it('reuses the same container on subsequent calls', () => {
    showToast('first');
    showToast('second');
    const containers = document.querySelectorAll('.toast-container');
    expect(containers.length).toBe(1);
    expect(containers[0]!.children.length).toBe(2);
  });

  it('creates a toast element with correct class and text', () => {
    showToast('Test message');
    const toast = document.querySelector('.toast');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toBe('Test message');
    expect(toast?.classList.contains('toast--info')).toBe(true);
  });

  it('applies success type class', () => {
    showToast('Saved!', 'success');
    const toast = document.querySelector('.toast--success');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toBe('Saved!');
  });

  it('applies error type class and uses assertive aria-live', () => {
    showToast('Failed!', 'error');
    const toast = document.querySelector('.toast--error');
    expect(toast).not.toBeNull();
    const container = document.querySelector('.toast-container');
    expect(container?.getAttribute('role')).toBe('alert');
    expect(container?.getAttribute('aria-live')).toBe('assertive');
  });

  it('restores polite aria-live for non-error toasts after error', () => {
    showToast('Error!', 'error');
    showToast('Info!', 'info');
    const container = document.querySelector('.toast-container');
    expect(container?.getAttribute('role')).toBe('status');
    expect(container?.getAttribute('aria-live')).toBe('polite');
  });

  it('removes toast after the specified duration', () => {
    showToast('Temporary', 'info', 2000);
    expect(document.querySelector('.toast')).not.toBeNull();

    // Advance past the fade-out trigger
    vi.advanceTimersByTime(2000);
    // Toast should have opacity/transform set but still in DOM during transition
    const toast = document.querySelector('.toast') as HTMLElement;
    expect(toast?.style.opacity).toBe('0');
    expect(toast?.style.transform).toBe('translateX(100%)');

    // Advance past the removal transition (300ms)
    vi.advanceTimersByTime(300);
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('uses default 4000ms duration when not specified', () => {
    showToast('Default duration');
    expect(document.querySelector('.toast')).not.toBeNull();

    vi.advanceTimersByTime(3999);
    expect(document.querySelector('.toast')?.textContent).toBe('Default duration');

    vi.advanceTimersByTime(1);
    const toast = document.querySelector('.toast') as HTMLElement;
    expect(toast?.style.opacity).toBe('0');
  });

  it('handles multiple toasts with different durations', () => {
    showToast('First', 'info', 1000);
    showToast('Second', 'info', 3000);

    const container = document.querySelector('.toast-container')!;
    expect(container.children.length).toBe(2);

    // First toast fades out
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(300);
    expect(container.children.length).toBe(1);
    expect(container.children[0]?.textContent).toBe('Second');

    // Second toast fades out
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(300);
    expect(container.children.length).toBe(0);
  });

  it('sets aria-atomic to false on container', () => {
    showToast('test');
    const container = document.querySelector('.toast-container');
    expect(container?.getAttribute('aria-atomic')).toBe('false');
  });
});
