/**
 * Toast notification system
 * Uses ARIA live regions so screen readers announce notifications.
 */

let container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(
  message: string,
  type: 'success' | 'error' | 'info' = 'info',
  duration = 4000
): void {
  const c = getContainer();

  // Use assertive for errors so they interrupt
  if (type === 'error') {
    c.setAttribute('role', 'alert');
    c.setAttribute('aria-live', 'assertive');
  } else {
    c.setAttribute('role', 'status');
    c.setAttribute('aria-live', 'polite');
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  c.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease-in';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
