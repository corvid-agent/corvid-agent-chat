/**
 * PWA service worker registration and update prompt
 */
import { showToast } from './toast.ts';

/**
 * Register the service worker and handle updates.
 * Uses the 'prompt' strategy — the user is notified when
 * a new version is available and can choose to reload.
 */
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const { registerSW } = await import('virtual:pwa-register');

    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW(swUrl, registration) {
        // Check for updates every 30 minutes
        if (registration) {
          setInterval(() => {
            registration.update();
          }, 30 * 60 * 1000);
        }
      },
      onOfflineReady() {
        showToast('App ready to work offline', 'success');
      },
      onNeedRefresh() {
        // Show update prompt
        if (confirm('A new version of CorvidAgent Chat is available. Reload to update?')) {
          updateSW(true);
        }
      },
      onRegisterError(error) {
        console.warn('SW registration failed:', error);
      },
    });
  } catch {
    // Service worker registration not available (e.g. dev mode)
  }
}
