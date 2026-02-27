/**
 * Unit tests for the scan view — QR code scanning and manual URI entry
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ──

const { mockStore, mockQrScanner, mockToast } = vi.hoisted(() => ({
  mockStore: {
    setAgentConnection: vi.fn(),
    setView: vi.fn(),
  },
  mockQrScanner: {
    startScanning: vi.fn().mockResolvedValue(undefined),
    stopScanning: vi.fn().mockResolvedValue(undefined),
    parseManualURI: vi.fn(),
  },
  mockToast: {
    showToast: vi.fn(),
  },
}));

vi.mock('../store.ts', () => ({ store: mockStore }));
vi.mock('../qr-scanner.ts', () => mockQrScanner);
vi.mock('../toast.ts', () => mockToast);

import { renderScan, bindScanEvents, cleanupScan } from './scan.ts';

// ── Helpers ──

function renderIntoDOM(html: string): void {
  document.body.innerHTML = `<div id="app">${html}</div>`;
}

// ── Tests ──

describe('scan view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // ── renderScan ──

  describe('renderScan', () => {
    it('renders the header with title and back button', () => {
      const html = renderScan();
      expect(html).toContain('Connect Agent');
      expect(html).toContain('id="btn-back-setup"');
    });

    it('renders camera and manual tabs', () => {
      const html = renderScan();
      expect(html).toContain('id="tab-camera"');
      expect(html).toContain('id="tab-manual"');
    });

    it('renders camera panel visible and manual panel hidden', () => {
      renderIntoDOM(renderScan());
      const cameraPanel = document.getElementById('camera-panel');
      const manualPanel = document.getElementById('manual-panel');
      expect(cameraPanel).toBeTruthy();
      expect(manualPanel).toBeTruthy();
      expect(manualPanel!.style.display).toBe('none');
    });

    it('renders QR reader element', () => {
      const html = renderScan();
      expect(html).toContain('id="qr-reader"');
    });

    it('renders manual URI input and connect button', () => {
      const html = renderScan();
      expect(html).toContain('id="manual-uri"');
      expect(html).toContain('id="btn-manual-connect"');
    });
  });

  // ── bindScanEvents — tab switching ──

  describe('tab switching', () => {
    beforeEach(() => {
      renderIntoDOM(renderScan());
      bindScanEvents();
    });

    it('switches to manual tab on click', () => {
      const tabManual = document.getElementById('tab-manual')!;
      const tabCamera = document.getElementById('tab-camera')!;
      const cameraPanel = document.getElementById('camera-panel')!;
      const manualPanel = document.getElementById('manual-panel')!;

      tabManual.click();

      expect(tabManual.className).toContain('tab--active');
      expect(tabCamera.className).not.toContain('tab--active');
      expect(cameraPanel.style.display).toBe('none');
      expect(manualPanel.style.display).toBe('');
      expect(mockQrScanner.stopScanning).toHaveBeenCalled();
    });

    it('switches back to camera tab on click', () => {
      const tabManual = document.getElementById('tab-manual')!;
      const tabCamera = document.getElementById('tab-camera')!;
      const cameraPanel = document.getElementById('camera-panel')!;
      const manualPanel = document.getElementById('manual-panel')!;

      // Switch to manual first
      tabManual.click();
      vi.clearAllMocks();

      // Switch back to camera
      tabCamera.click();

      expect(tabCamera.className).toContain('tab--active');
      expect(tabManual.className).not.toContain('tab--active');
      expect(cameraPanel.style.display).toBe('');
      expect(manualPanel.style.display).toBe('none');
    });
  });

  // ── bindScanEvents — camera scanning ──

  describe('camera scanning', () => {
    it('starts scanning on mount', () => {
      renderIntoDOM(renderScan());
      bindScanEvents();

      expect(mockQrScanner.startScanning).toHaveBeenCalledWith(
        'qr-reader',
        expect.any(Function)
      );
    });

    it('navigates to chat on successful camera scan', () => {
      renderIntoDOM(renderScan());
      bindScanEvents();

      const callback = mockQrScanner.startScanning.mock.calls[0]![1] as (
        result: { success: boolean; connection?: object; error?: string }
      ) => void;

      const connection = {
        address: 'AGENT_ADDR',
        psk: new Uint8Array(32),
        label: 'MyAgent',
        network: 'testnet',
        addedAt: Date.now(),
      };

      callback({ success: true, connection });

      expect(mockToast.showToast).toHaveBeenCalledWith('Connected to MyAgent', 'success');
      expect(mockStore.setAgentConnection).toHaveBeenCalledWith(connection);
      expect(mockStore.setView).toHaveBeenCalledWith('chat');
    });

    it('shows error toast on failed camera scan', () => {
      renderIntoDOM(renderScan());
      bindScanEvents();

      const callback = mockQrScanner.startScanning.mock.calls[0]![1] as (
        result: { success: boolean; connection?: object; error?: string }
      ) => void;

      callback({ success: false, error: 'Invalid QR code' });

      expect(mockToast.showToast).toHaveBeenCalledWith('Invalid QR code', 'error');
      expect(mockStore.setView).not.toHaveBeenCalled();
    });
  });

  // ── bindScanEvents — manual connect ──

  describe('manual connect', () => {
    beforeEach(() => {
      renderIntoDOM(renderScan());
      bindScanEvents();
    });

    it('shows error when manual URI is empty', () => {
      const uriInput = document.getElementById('manual-uri') as HTMLTextAreaElement;
      uriInput.value = '';

      document.getElementById('btn-manual-connect')!.click();

      expect(mockToast.showToast).toHaveBeenCalledWith('Please enter a PSK URI', 'error');
    });

    it('parses valid URI and navigates to chat', () => {
      const connection = {
        address: 'AGENT_ADDR',
        psk: new Uint8Array(32),
        label: 'ManualAgent',
        network: 'testnet',
        addedAt: Date.now(),
      };
      mockQrScanner.parseManualURI.mockReturnValue({
        success: true,
        connection,
      });

      const uriInput = document.getElementById('manual-uri') as HTMLTextAreaElement;
      uriInput.value = 'algochat-psk://v1?addr=AGENT_ADDR&psk=abc&label=ManualAgent';

      document.getElementById('btn-manual-connect')!.click();

      expect(mockQrScanner.parseManualURI).toHaveBeenCalledWith(
        'algochat-psk://v1?addr=AGENT_ADDR&psk=abc&label=ManualAgent'
      );
      expect(mockToast.showToast).toHaveBeenCalledWith('Connected to ManualAgent', 'success');
      expect(mockStore.setAgentConnection).toHaveBeenCalledWith(connection);
      expect(mockStore.setView).toHaveBeenCalledWith('chat');
    });

    it('shows error on invalid manual URI', () => {
      mockQrScanner.parseManualURI.mockReturnValue({
        success: false,
        error: 'Not a valid AlgoChat QR code',
      });

      const uriInput = document.getElementById('manual-uri') as HTMLTextAreaElement;
      uriInput.value = 'https://not-a-psk-uri.com';

      document.getElementById('btn-manual-connect')!.click();

      expect(mockToast.showToast).toHaveBeenCalledWith(
        'Not a valid AlgoChat QR code',
        'error'
      );
      expect(mockStore.setView).not.toHaveBeenCalled();
    });

    it('shows fallback error message when parseManualURI returns no error string', () => {
      mockQrScanner.parseManualURI.mockReturnValue({
        success: false,
      });

      const uriInput = document.getElementById('manual-uri') as HTMLTextAreaElement;
      uriInput.value = 'something';

      document.getElementById('btn-manual-connect')!.click();

      expect(mockToast.showToast).toHaveBeenCalledWith('Invalid URI', 'error');
    });
  });

  // ── bindScanEvents — back button ──

  describe('back button', () => {
    it('stops scanning and navigates to setup', () => {
      renderIntoDOM(renderScan());
      bindScanEvents();

      document.getElementById('btn-back-setup')!.click();

      expect(mockQrScanner.stopScanning).toHaveBeenCalled();
      expect(mockStore.setView).toHaveBeenCalledWith('setup');
    });
  });

  // ── cleanupScan ──

  describe('cleanupScan', () => {
    it('calls stopScanning', () => {
      cleanupScan();
      expect(mockQrScanner.stopScanning).toHaveBeenCalled();
    });
  });
});
