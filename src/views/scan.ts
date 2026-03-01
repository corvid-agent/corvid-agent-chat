/**
 * QR Code scanning view for connecting to an agent
 */
import { store } from '../store.ts';
import { startScanning, stopScanning, parseManualURI } from '../qr-scanner.ts';
import { showToast } from '../toast.ts';

export function renderScan(): string {
  return `
    <header class="header" role="banner">
      <div class="header__brand">
        <h1 class="header__title">Connect Agent</h1>
      </div>
      <nav class="header__controls" aria-label="Navigation">
        <button id="btn-back-setup" class="icon-btn" aria-label="Back to setup">&#x2190;</button>
      </nav>
    </header>

    <main id="main-content" class="setup-view" style="justify-content: flex-start; padding-top: 1.5rem" tabindex="-1">
      <p class="setup-view__subtitle" style="margin-bottom: 1.5rem">
        Scan the QR code from your agent's admin settings to establish an encrypted connection.
      </p>

      <section class="setup-card" style="max-width:340px" aria-labelledby="connect-heading">
        <h2 id="connect-heading" class="sr-only">Connection method</h2>
        <div class="tabs" role="tablist" aria-label="Connection method">
          <button class="tab tab--active" id="tab-camera" role="tab" aria-selected="true" aria-controls="camera-panel">Camera</button>
          <button class="tab" id="tab-manual" role="tab" aria-selected="false" aria-controls="manual-panel">Manual</button>
        </div>

        <div id="camera-panel" role="tabpanel" aria-labelledby="tab-camera">
          <div class="qr-scanner" id="qr-reader" aria-label="QR code scanner">
            <div class="qr-scanner__overlay" aria-live="polite">
              <span>Starting camera...</span>
            </div>
          </div>
          <p class="form-hint" style="text-align:center;margin-top:0.5rem">
            Point camera at the PSK QR code
          </p>
        </div>

        <div id="manual-panel" role="tabpanel" aria-labelledby="tab-manual" style="display:none">
          <div class="form-group">
            <label class="form-label" for="manual-uri">PSK Exchange URI</label>
            <textarea id="manual-uri" class="form-input form-textarea"
              placeholder="algochat-psk://v1?addr=...&psk=...&label=..." rows="4"
              aria-describedby="manual-uri-hint"></textarea>
            <div id="manual-uri-hint" class="form-hint">
              Paste the URI from your agent's admin panel
            </div>
          </div>
          <button id="btn-manual-connect" class="btn btn--primary btn--full">
            Connect
          </button>
        </div>
      </section>
    </main>
  `;
}

export function bindScanEvents(): void {
  let scanning = false;

  // Tab switching
  const tabCamera = document.getElementById('tab-camera');
  const tabManual = document.getElementById('tab-manual');
  const cameraPanel = document.getElementById('camera-panel');
  const manualPanel = document.getElementById('manual-panel');

  tabCamera?.addEventListener('click', () => {
    tabCamera.className = 'tab tab--active';
    tabCamera.setAttribute('aria-selected', 'true');
    if (tabManual) { tabManual.className = 'tab'; tabManual.setAttribute('aria-selected', 'false'); }
    if (cameraPanel) cameraPanel.style.display = '';
    if (manualPanel) manualPanel.style.display = 'none';
    // Start scanning when switching to camera
    if (!scanning) {
      startCameraScanning();
    }
  });

  tabManual?.addEventListener('click', () => {
    if (tabCamera) { tabCamera.className = 'tab'; tabCamera.setAttribute('aria-selected', 'false'); }
    tabManual.className = 'tab tab--active';
    tabManual.setAttribute('aria-selected', 'true');
    if (cameraPanel) cameraPanel.style.display = 'none';
    if (manualPanel) manualPanel.style.display = '';
    // Stop scanning when switching to manual
    stopScanning().catch(console.error);
    scanning = false;
  });

  // Start camera scanning
  const startCameraScanning = async () => {
    scanning = true;
    await startScanning('qr-reader', (result) => {
      if (result.success && result.connection) {
        showToast(
          `Connected to ${result.connection.label}`,
          'success'
        );
        store.setAgentConnection(result.connection);
        store.setView('chat');
      } else if (result.error) {
        showToast(result.error, 'error');
      }
    });
  };

  // Start scanning immediately
  startCameraScanning();

  // Manual connect
  const btnManual = document.getElementById('btn-manual-connect');
  btnManual?.addEventListener('click', () => {
    const uri = (
      document.getElementById('manual-uri') as HTMLTextAreaElement
    )?.value;
    if (!uri) {
      showToast('Please enter a PSK URI', 'error');
      return;
    }

    const result = parseManualURI(uri);
    if (result.success && result.connection) {
      showToast(`Connected to ${result.connection.label}`, 'success');
      store.setAgentConnection(result.connection);
      store.setView('chat');
    } else {
      showToast(result.error ?? 'Invalid URI', 'error');
    }
  });

  // Back button
  document.getElementById('btn-back-setup')?.addEventListener('click', () => {
    stopScanning().catch(console.error);
    store.setView('setup');
  });
}

/**
 * Cleanup when leaving the scan view
 */
export function cleanupScan(): void {
  stopScanning().catch(console.error);
}
