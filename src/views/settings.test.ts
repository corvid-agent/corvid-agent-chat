/**
 * Unit tests for the settings view — wallet management, agent info, and danger zone
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentConnection, ChatMessage } from '../types.ts';
import { stubLocalStorage } from '../test-utils.ts';

// ── Hoisted mocks ──

const {
  fakeConnection,
  defaultStoreState,
  mockStore,
  mockWallet,
  mockQrScanner,
  mockMessaging,
  mockToast,
  mockDb,
  mockIdleLock,
  mockDeviceName,
} = vi.hoisted(() => {
  const fakeConnection: AgentConnection = {
    address: 'AGENTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEF',
    psk: new Uint8Array(32),
    label: 'TestAgent',
    network: 'testnet',
    addedAt: Date.now(),
  };

  const defaultStoreState = (): {
    view: string;
    wallet: { address: string | null; unlocked: boolean; balance: number };
    agent: { connection: AgentConnection | null; online: boolean; lastSeen: number | null };
    chat: { messages: ChatMessage[]; polling: boolean; sending: boolean };
  } => ({
    view: 'settings',
    wallet: { address: 'WALLETADDR1234567890', unlocked: true, balance: 5_000_000 },
    agent: { connection: fakeConnection, online: true, lastSeen: Date.now() },
    chat: { messages: [], polling: false, sending: false },
  });

  return {
    fakeConnection,
    defaultStoreState,
    mockStore: {
      getState: vi.fn(defaultStoreState),
      setView: vi.fn(),
      lockWallet: vi.fn(),
      clearAgent: vi.fn(),
    },
    mockWallet: {
      getAccount: vi.fn(),
      exportMnemonic: vi.fn(),
      deleteWallet: vi.fn(),
      lockWallet: vi.fn(),
    },
    mockQrScanner: {
      clearConnection: vi.fn(),
      loadConnection: vi.fn(() => null),
    },
    mockMessaging: {
      destroy: vi.fn(),
      stopPolling: vi.fn(),
    },
    mockToast: { showToast: vi.fn() },
    mockDb: { deleteDatabase: vi.fn().mockResolvedValue(undefined) },
    mockIdleLock: {
      getIdleTimeout: vi.fn(() => 900_000),
      setIdleTimeout: vi.fn(),
      startIdleLock: vi.fn(),
    },
    mockDeviceName: {
      getDeviceName: vi.fn((): string | null => 'mac-studio'),
      setDeviceName: vi.fn((): boolean => true),
    },
  };
});

vi.mock('../store.ts', () => ({ store: mockStore }));
vi.mock('../wallet.ts', () => mockWallet);
vi.mock('../qr-scanner.ts', () => mockQrScanner);
vi.mock('../messaging.ts', () => ({ messaging: mockMessaging }));
vi.mock('../toast.ts', () => mockToast);
vi.mock('../db.ts', () => mockDb);
vi.mock('../idle-lock.ts', () => mockIdleLock);
vi.mock('../device-name.ts', () => mockDeviceName);
vi.mock('../utils.ts', () => ({
  escapeHtml: (s: string) => s,
}));

import { renderSettings, bindSettingsEvents } from './settings.ts';

// ── Helpers ──

function renderIntoDOM(html: string): void {
  document.body.innerHTML = `<div id="app">${html}</div>`;
}

function setup(): void {
  renderIntoDOM(renderSettings());
  bindSettingsEvents();
}

// ── Tests ──

describe('settings view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mockStore.getState.mockImplementation(defaultStoreState);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // ── renderSettings ──

  describe('renderSettings', () => {
    it('renders the header with title and back button', () => {
      const html = renderSettings();
      expect(html).toContain('Settings');
      expect(html).toContain('id="btn-back-chat"');
    });

    it('renders wallet address', () => {
      const html = renderSettings();
      expect(html).toContain('WALLETADDR1234567890');
    });

    it('renders balance in ALGO', () => {
      const html = renderSettings();
      expect(html).toContain('5.0000 ALGO');
      expect(html).toContain('5,000,000');
    });

    it('renders auto-lock timeout field', () => {
      const html = renderSettings();
      expect(html).toContain('id="idle-timeout"');
      expect(html).toContain('Auto-lock timeout');
    });

    it('renders device name field', () => {
      const html = renderSettings();
      expect(html).toContain('id="device-name"');
      expect(html).toContain('mac-studio');
    });

    it('renders export mnemonic and lock wallet buttons', () => {
      const html = renderSettings();
      expect(html).toContain('id="btn-export-mnemonic"');
      expect(html).toContain('id="btn-lock-wallet"');
    });

    it('renders agent connection info when agent is connected', () => {
      const html = renderSettings();
      expect(html).toContain('TestAgent');
      expect(html).toContain('AGENTADDRESS');
      expect(html).toContain('testnet');
      expect(html).toContain('Online');
      expect(html).toContain('id="btn-reconnect"');
      expect(html).toContain('id="btn-disconnect"');
    });

    it('renders "No agent connected" when agent is null', () => {
      mockStore.getState.mockReturnValue({
        ...defaultStoreState(),
        agent: { connection: null, online: false, lastSeen: null },
      });

      const html = renderSettings();
      expect(html).toContain('No agent connected');
      expect(html).toContain('id="btn-scan-agent"');
    });

    it('renders offline status when agent is not online', () => {
      mockStore.getState.mockReturnValue({
        ...defaultStoreState(),
        agent: { connection: fakeConnection, online: false, lastSeen: null },
      });

      const html = renderSettings();
      expect(html).toContain('Offline');
      expect(html).toContain('status-dot--grey');
    });

    it('renders danger zone with delete button', () => {
      const html = renderSettings();
      expect(html).toContain('Danger Zone');
      expect(html).toContain('id="btn-delete-all"');
    });

    it('renders ecosystem links', () => {
      const html = renderSettings();
      expect(html).toContain('Ecosystem');
      expect(html).toContain('corvid-agent.github.io');
    });
  });

  // ── back button ──

  describe('back button', () => {
    it('navigates to chat when agent is connected', () => {
      setup();
      document.getElementById('btn-back-chat')!.click();
      expect(mockStore.setView).toHaveBeenCalledWith('chat');
    });

    it('navigates to setup when no agent is connected', () => {
      mockStore.getState.mockReturnValue({
        ...defaultStoreState(),
        agent: { connection: null, online: false, lastSeen: null },
      });
      setup();
      document.getElementById('btn-back-chat')!.click();
      expect(mockStore.setView).toHaveBeenCalledWith('setup');
    });
  });

  // ── idle timeout ──

  describe('idle timeout setting', () => {
    it('updates idle timeout on valid input', () => {
      setup();
      const input = document.getElementById('idle-timeout') as HTMLInputElement;
      input.value = '30';
      input.dispatchEvent(new Event('change', { bubbles: true }));

      expect(mockIdleLock.setIdleTimeout).toHaveBeenCalledWith(30);
      expect(mockIdleLock.startIdleLock).toHaveBeenCalled();
      expect(mockToast.showToast).toHaveBeenCalledWith('Auto-lock set to 30 min', 'info');
    });

    it('rejects invalid timeout value above maximum', () => {
      setup();
      const input = document.getElementById('idle-timeout') as HTMLInputElement;
      input.value = '200';
      input.dispatchEvent(new Event('change', { bubbles: true }));

      expect(mockIdleLock.setIdleTimeout).not.toHaveBeenCalled();
      expect(mockToast.showToast).toHaveBeenCalledWith(
        'Timeout must be 1-120 minutes',
        'error'
      );
    });

    it('rejects zero timeout value', () => {
      setup();
      const input = document.getElementById('idle-timeout') as HTMLInputElement;
      input.value = '0';
      input.dispatchEvent(new Event('change', { bubbles: true }));

      expect(mockIdleLock.setIdleTimeout).not.toHaveBeenCalled();
      expect(mockToast.showToast).toHaveBeenCalledWith(
        'Timeout must be 1-120 minutes',
        'error'
      );
    });
  });

  // ── device name ──

  describe('device name setting', () => {
    it('updates device name on valid input', () => {
      setup();
      const input = document.getElementById('device-name') as HTMLInputElement;
      input.value = 'my-phone';
      input.dispatchEvent(new Event('change', { bubbles: true }));

      expect(mockDeviceName.setDeviceName).toHaveBeenCalledWith('my-phone');
      expect(mockToast.showToast).toHaveBeenCalledWith(
        'Device name set to "my-phone"',
        'info'
      );
    });

    it('shows cleared message when name is set to empty', () => {
      setup();
      const input = document.getElementById('device-name') as HTMLInputElement;
      input.value = '';
      input.dispatchEvent(new Event('change', { bubbles: true }));

      expect(mockDeviceName.setDeviceName).toHaveBeenCalledWith('');
      expect(mockToast.showToast).toHaveBeenCalledWith('Device name cleared', 'info');
    });

    it('shows error on invalid device name', () => {
      mockDeviceName.setDeviceName.mockReturnValueOnce(false);
      setup();
      const input = document.getElementById('device-name') as HTMLInputElement;
      input.value = 'invalid name!!!';
      input.dispatchEvent(new Event('change', { bubbles: true }));

      expect(mockToast.showToast).toHaveBeenCalledWith(
        'Invalid name (letters, numbers, hyphens, underscores, max 16)',
        'error'
      );
    });
  });

  // ── export mnemonic ──

  describe('export mnemonic flow', () => {
    it('shows password modal on export button click', () => {
      setup();
      document.getElementById('btn-export-mnemonic')!.click();

      const overlay = document.querySelector('.modal-overlay');
      expect(overlay).toBeTruthy();
      expect(overlay!.textContent).toContain('Export Mnemonic');
      expect(document.getElementById('export-pw-input')).toBeTruthy();
      expect(document.getElementById('export-pw-confirm')).toBeTruthy();
      expect(document.getElementById('export-pw-cancel')).toBeTruthy();
    });

    it('dismisses password modal on cancel', () => {
      setup();
      document.getElementById('btn-export-mnemonic')!.click();

      document.getElementById('export-pw-cancel')!.click();

      expect(document.querySelector('.modal-overlay')).toBeNull();
    });

    it('shows error when password is empty', () => {
      setup();
      document.getElementById('btn-export-mnemonic')!.click();

      const pwInput = document.getElementById('export-pw-input') as HTMLInputElement;
      pwInput.value = '';
      document.getElementById('export-pw-confirm')!.click();

      expect(mockToast.showToast).toHaveBeenCalledWith('Enter your password', 'error');
    });

    it('shows mnemonic modal on successful export', async () => {
      mockWallet.exportMnemonic.mockResolvedValue(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon agent'
      );

      setup();
      document.getElementById('btn-export-mnemonic')!.click();

      const pwInput = document.getElementById('export-pw-input') as HTMLInputElement;
      pwInput.value = 'correctpassword';
      document.getElementById('export-pw-confirm')!.click();

      await vi.waitFor(() => {
        expect(mockWallet.exportMnemonic).toHaveBeenCalledWith('correctpassword');
        const overlays = document.querySelectorAll('.modal-overlay');
        expect(overlays.length).toBe(1);
        expect(overlays[0]!.textContent).toContain('Your Mnemonic');
        expect(overlays[0]!.textContent).toContain('abandon');
      });
    });

    it('shows error toast on export failure', async () => {
      mockWallet.exportMnemonic.mockRejectedValue(new Error('Wrong password'));

      setup();
      document.getElementById('btn-export-mnemonic')!.click();

      const pwInput = document.getElementById('export-pw-input') as HTMLInputElement;
      pwInput.value = 'wrongpassword';
      document.getElementById('export-pw-confirm')!.click();

      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith('Wrong password', 'error');
      });
    });

    it('closes mnemonic modal on close button', async () => {
      mockWallet.exportMnemonic.mockResolvedValue('test mnemonic words');

      setup();
      document.getElementById('btn-export-mnemonic')!.click();

      const pwInput = document.getElementById('export-pw-input') as HTMLInputElement;
      pwInput.value = 'password';
      document.getElementById('export-pw-confirm')!.click();

      await vi.waitFor(() => {
        expect(document.getElementById('btn-close-mnemonic')).toBeTruthy();
      });

      document.getElementById('btn-close-mnemonic')!.click();

      expect(document.querySelector('.modal-overlay')).toBeNull();
    });

    it('exports mnemonic on Enter key in password field', async () => {
      mockWallet.exportMnemonic.mockResolvedValue('test mnemonic words');

      setup();
      document.getElementById('btn-export-mnemonic')!.click();

      const pwInput = document.getElementById('export-pw-input') as HTMLInputElement;
      pwInput.value = 'password';
      pwInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );

      await vi.waitFor(() => {
        expect(mockWallet.exportMnemonic).toHaveBeenCalledWith('password');
      });
    });
  });

  // ── lock wallet ──

  describe('lock wallet', () => {
    it('locks wallet and shows toast', () => {
      setup();
      document.getElementById('btn-lock-wallet')!.click();

      expect(mockMessaging.destroy).toHaveBeenCalled();
      expect(mockWallet.lockWallet).toHaveBeenCalled();
      expect(mockStore.lockWallet).toHaveBeenCalled();
      expect(mockToast.showToast).toHaveBeenCalledWith('Wallet locked', 'info');
    });
  });

  // ── scan new agent ──

  describe('scan new agent', () => {
    it('stops polling and navigates to scan', () => {
      setup();
      document.getElementById('btn-reconnect')!.click();

      expect(mockMessaging.stopPolling).toHaveBeenCalled();
      expect(mockStore.setView).toHaveBeenCalledWith('scan');
    });
  });

  // ── disconnect agent ──

  describe('disconnect agent', () => {
    it('disconnects when user confirms', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      setup();
      document.getElementById('btn-disconnect')!.click();

      expect(mockMessaging.destroy).toHaveBeenCalled();
      expect(mockQrScanner.clearConnection).toHaveBeenCalled();
      expect(mockStore.clearAgent).toHaveBeenCalled();
      expect(mockToast.showToast).toHaveBeenCalledWith('Disconnected', 'info');
      expect(mockStore.setView).toHaveBeenCalledWith('scan');
    });

    it('does nothing when user cancels disconnect', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      setup();
      document.getElementById('btn-disconnect')!.click();

      expect(mockMessaging.destroy).not.toHaveBeenCalled();
      expect(mockQrScanner.clearConnection).not.toHaveBeenCalled();
    });
  });

  // ── delete all data ──

  describe('delete all data', () => {
    it('deletes everything when user confirms', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      const { clear: clearFn } = stubLocalStorage();

      setup();
      document.getElementById('btn-delete-all')!.click();

      await vi.waitFor(() => {
        expect(mockMessaging.destroy).toHaveBeenCalled();
        expect(mockQrScanner.clearConnection).toHaveBeenCalled();
        expect(mockWallet.deleteWallet).toHaveBeenCalled();
        expect(mockDb.deleteDatabase).toHaveBeenCalled();
        expect(clearFn).toHaveBeenCalled();
        expect(mockStore.lockWallet).toHaveBeenCalled();
        expect(mockToast.showToast).toHaveBeenCalledWith('All data deleted', 'info');
      });

      vi.unstubAllGlobals();
    });

    it('does nothing when user cancels deletion', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      setup();
      document.getElementById('btn-delete-all')!.click();

      expect(mockMessaging.destroy).not.toHaveBeenCalled();
      expect(mockWallet.deleteWallet).not.toHaveBeenCalled();
    });
  });

  // ── scan agent (no agent connected) ──

  describe('scan agent when none connected', () => {
    it('navigates to scan view', () => {
      mockStore.getState.mockReturnValue({
        ...defaultStoreState(),
        agent: { connection: null, online: false, lastSeen: null },
      });
      setup();
      document.getElementById('btn-scan-agent')!.click();

      expect(mockStore.setView).toHaveBeenCalledWith('scan');
    });
  });
});
