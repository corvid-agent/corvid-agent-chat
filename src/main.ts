/**
 * CorvidAgent Chat - AlgoChat Client
 * Main entry point
 */
import { store } from './store.ts';
import { hasStoredWallet } from './wallet.ts';
import { loadConnection } from './qr-scanner.ts';
import { startIdleLock, stopIdleLock } from './idle-lock.ts';
import type { AppView } from './types.ts';

// View modules (lazy imported for code splitting)
import { renderSetup, bindSetupEvents } from './views/setup.ts';
import { renderScan, bindScanEvents, cleanupScan } from './views/scan.ts';
import { renderChat, bindChatEvents, cleanupChat } from './views/chat.ts';
import { renderSettings, bindSettingsEvents } from './views/settings.ts';

const app = document.getElementById('app')!;
let currentView: AppView | null = null;

/**
 * Render the current view
 */
function render() {
  const state = store.getState();
  const view = state.view;

  // Don't re-render if same view
  if (view === currentView) return;

  // Cleanup previous view
  cleanupView(currentView);

  // Manage idle lock based on wallet state
  const walletUnlocked = store.getState().wallet.unlocked;
  if (walletUnlocked) {
    startIdleLock();
  } else {
    stopIdleLock();
  }

  // Render new view
  currentView = view;

  switch (view) {
    case 'setup':
      app.innerHTML = renderSetup();
      bindSetupEvents();
      break;
    case 'scan':
      app.innerHTML = renderScan();
      bindScanEvents();
      break;
    case 'chat':
      app.innerHTML = renderChat();
      bindChatEvents();
      break;
    case 'settings':
      app.innerHTML = renderSettings();
      bindSettingsEvents();
      break;
    default:
      app.innerHTML = renderSetup();
      bindSetupEvents();
  }
}

/**
 * Cleanup when leaving a view
 */
function cleanupView(view: AppView | null) {
  switch (view) {
    case 'scan':
      cleanupScan();
      break;
    case 'chat':
      cleanupChat();
      break;
  }
}

/**
 * Determine initial view based on stored state
 */
function determineInitialView(): AppView {
  // Check if wallet exists
  if (!hasStoredWallet()) {
    return 'setup';
  }

  // Wallet exists but needs unlocking - go to setup (which shows unlock form)
  return 'setup';
}

// ── Initialize ──

// Subscribe to state changes
store.subscribe(render);

// Set initial view
store.setView(determineInitialView());

// Log startup
console.log(
  '%c[CorvidChat]%c AlgoChat client initialized',
  'color: #00e5ff; font-weight: bold',
  'color: inherit'
);
