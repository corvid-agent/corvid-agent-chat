/**
 * QR Code scanning view for connecting to an agent
 */
import { store } from '../store.ts';
import { startScanning, stopScanning, parseManualURI } from '../qr-scanner.ts';
import { showToast } from '../toast.ts';

export function renderScan(): string {
  return `
    <div class="header">
      <div class="header__brand">
        <div class="header__title">Connect Agent</div>
      </div>
      <div class="header__controls">
        <button id="btn-back-setup" class="icon-btn" title="Back">&#x2190;</button>
      </div>
    </div>

    <div class="setup-view" style="justify-content: flex-start; padding-top: 1.5rem">
      <div class="setup-view__subtitle" style="margin-bottom: 1.5rem">
        Scan the QR code from your agent's admin settings to establish an encrypted connection.
      </div>

      <div class="setup-card" style="max-width:340px">
        <div class="tabs">
          <button class="tab tab--active" id="tab-camera">Camera</button>
          <button class="tab" id="tab-manual">Manual</button>
        </div>

        <div id="camera-panel">
          <div class="qr-scanner" id="qr-reader">
            <div class="qr-scanner__overlay">
              <span>Starting camera...</span>
            </div>
          </div>
          <div class="form-hint" style="text-align:center;margin-top:0.5rem">
            Point camera at the PSK QR code
          </div>
        </div>

        <div id="manual-panel" style="display:none">
          <div class="form-group">
            <label class="form-label">PSK Exchange URI</label>
            <textarea id="manual-uri" class="form-input form-textarea"
              placeholder="algochat-psk://v1?addr=...&psk=...&label=..." rows="4"
            ></textarea>
            <div class="form-hint">
              Paste the URI from your agent's admin panel
            </div>
          </div>
          <button id="btn-manual-connect" class="btn btn--primary btn--full">
            Connect
          </button>
        </div>
      </div>
    </div>
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
    if (tabManual) tabManual.className = 'tab';
    if (cameraPanel) cameraPanel.style.display = '';
    if (manualPanel) manualPanel.style.display = 'none';
    // Start scanning when switching to camera
    if (!scanning) {
      startCameraScanning();
    }
  });

  tabManual?.addEventListener('click', () => {
    if (tabCamera) tabCamera.className = 'tab';
    tabManual.className = 'tab tab--active';
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
