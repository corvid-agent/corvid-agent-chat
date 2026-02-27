/**
 * Unit tests for the setup view — wallet creation, import, unlock, and reset flows
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks (vi.mock is hoisted, so variables must be too) ──

const { mockStore, mockWallet, mockQrScanner, mockToast } = vi.hoisted(() => ({
  mockStore: {
    setWallet: vi.fn(),
    setAgentConnection: vi.fn(),
    setView: vi.fn(),
  },
  mockWallet: {
    hasStoredWallet: vi.fn((): boolean => false),
    getStoredWallet: vi.fn((): unknown => null),
    createWallet: vi.fn(),
    importWallet: vi.fn(),
    unlockWallet: vi.fn(),
    deleteWallet: vi.fn(),
  },
  mockQrScanner: {
    loadConnection: vi.fn((): unknown => null),
  },
  mockToast: {
    showToast: vi.fn(),
  },
}));

vi.mock('../store.ts', () => ({ store: mockStore }));
vi.mock('../wallet.ts', () => mockWallet);
vi.mock('../qr-scanner.ts', () => mockQrScanner);
vi.mock('../toast.ts', () => mockToast);

import { renderSetup, bindSetupEvents } from './setup.ts';

// ── Helpers ──

function renderIntoDOM(html: string): void {
  document.body.innerHTML = `<div id="app">${html}</div>`;
}

// ── Tests ──

describe('setup view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // ── renderSetup ──

  describe('renderSetup', () => {
    it('renders the create/import view when no wallet is stored', () => {
      mockWallet.hasStoredWallet.mockReturnValue(false);
      mockWallet.getStoredWallet.mockReturnValue(null);

      const html = renderSetup();

      expect(html).toContain('Create Wallet');
      expect(html).toContain('Import Wallet');
      expect(html).toContain('id="btn-create"');
      expect(html).toContain('id="btn-import"');
      expect(html).toContain('id="create-password"');
      expect(html).toContain('id="create-password-confirm"');
      expect(html).toContain('id="import-mnemonic"');
      expect(html).toContain('id="import-password"');
    });

    it('renders the unlock view when a wallet is stored', () => {
      mockWallet.hasStoredWallet.mockReturnValue(true);
      mockWallet.getStoredWallet.mockReturnValue({
        address: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX',
        encryptedMnemonic: 'enc',
        iv: 'iv',
        salt: 'salt',
      });

      const html = renderSetup();

      expect(html).toContain('Unlock Wallet');
      expect(html).toContain('id="btn-unlock"');
      expect(html).toContain('id="unlock-password"');
      expect(html).toContain('id="btn-reset-wallet"');
      expect(html).toContain('ABCDEF');
      expect(html).toContain('...');
    });

    it('shows "Agent connection saved" hint when a saved agent exists on unlock view', () => {
      mockWallet.hasStoredWallet.mockReturnValue(true);
      mockWallet.getStoredWallet.mockReturnValue({
        address: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX',
        encryptedMnemonic: 'enc',
        iv: 'iv',
        salt: 'salt',
      });
      mockQrScanner.loadConnection.mockReturnValue({
        address: 'AGENT_ADDR',
        psk: new Uint8Array(32),
        label: 'TestAgent',
        network: 'testnet',
        addedAt: Date.now(),
      });

      const html = renderSetup();
      expect(html).toContain('Agent connection saved');
    });

    it('does not show "Agent connection saved" when no saved agent exists', () => {
      mockWallet.hasStoredWallet.mockReturnValue(true);
      mockWallet.getStoredWallet.mockReturnValue({
        address: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX',
        encryptedMnemonic: 'enc',
        iv: 'iv',
        salt: 'salt',
      });
      mockQrScanner.loadConnection.mockReturnValue(null);

      const html = renderSetup();
      expect(html).not.toContain('Agent connection saved');
    });
  });

  // ── bindSetupEvents — create wallet ──

  describe('create wallet flow', () => {
    beforeEach(() => {
      mockWallet.hasStoredWallet.mockReturnValue(false);
      mockWallet.getStoredWallet.mockReturnValue(null);
      renderIntoDOM(renderSetup());
      bindSetupEvents();
    });

    it('shows error toast when password is too short', async () => {
      const pwInput = document.getElementById('create-password') as HTMLInputElement;
      const confirmInput = document.getElementById('create-password-confirm') as HTMLInputElement;
      pwInput.value = 'short';
      confirmInput.value = 'short';

      document.getElementById('btn-create')!.click();
      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith(
          'Password must be at least 8 characters',
          'error'
        );
      });
    });

    it('shows error toast when passwords do not match', async () => {
      const pwInput = document.getElementById('create-password') as HTMLInputElement;
      const confirmInput = document.getElementById('create-password-confirm') as HTMLInputElement;
      pwInput.value = 'longpassword1';
      confirmInput.value = 'longpassword2';

      document.getElementById('btn-create')!.click();
      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith(
          'Passwords do not match',
          'error'
        );
      });
    });

    it('creates wallet and navigates to scan when no saved agent', async () => {
      mockWallet.createWallet.mockResolvedValue({ address: 'NEW_ADDR' });
      mockQrScanner.loadConnection.mockReturnValue(null);

      const pwInput = document.getElementById('create-password') as HTMLInputElement;
      const confirmInput = document.getElementById('create-password-confirm') as HTMLInputElement;
      pwInput.value = 'validpassword';
      confirmInput.value = 'validpassword';

      document.getElementById('btn-create')!.click();

      await vi.waitFor(() => {
        expect(mockWallet.createWallet).toHaveBeenCalledWith('validpassword');
        expect(mockStore.setWallet).toHaveBeenCalledWith('NEW_ADDR');
        expect(mockToast.showToast).toHaveBeenCalledWith('Wallet created!', 'success');
        expect(mockStore.setView).toHaveBeenCalledWith('scan');
      });
    });

    it('creates wallet and navigates to chat when saved agent exists', async () => {
      const savedAgent = {
        address: 'AGENT_ADDR',
        psk: new Uint8Array(32),
        label: 'TestAgent',
        network: 'testnet' as const,
        addedAt: Date.now(),
      };
      mockWallet.createWallet.mockResolvedValue({ address: 'NEW_ADDR' });
      mockQrScanner.loadConnection.mockReturnValue(savedAgent);

      const pwInput = document.getElementById('create-password') as HTMLInputElement;
      const confirmInput = document.getElementById('create-password-confirm') as HTMLInputElement;
      pwInput.value = 'validpassword';
      confirmInput.value = 'validpassword';

      document.getElementById('btn-create')!.click();

      await vi.waitFor(() => {
        expect(mockStore.setAgentConnection).toHaveBeenCalledWith(savedAgent);
        expect(mockStore.setView).toHaveBeenCalledWith('chat');
      });
    });

    it('disables button and shows loading text during creation', async () => {
      let resolveCreate!: (val: { address: string }) => void;
      mockWallet.createWallet.mockImplementation(
        () => new Promise((r) => { resolveCreate = r; })
      );

      const pwInput = document.getElementById('create-password') as HTMLInputElement;
      const confirmInput = document.getElementById('create-password-confirm') as HTMLInputElement;
      pwInput.value = 'validpassword';
      confirmInput.value = 'validpassword';

      const btn = document.getElementById('btn-create')!;
      btn.click();

      await vi.waitFor(() => {
        expect(btn.getAttribute('disabled')).toBe('true');
        expect(btn.textContent).toBe('Generating...');
      });

      resolveCreate({ address: 'NEW_ADDR' });
    });

    it('shows error and re-enables button on creation failure', async () => {
      mockWallet.createWallet.mockRejectedValue(new Error('Crypto failed'));

      const pwInput = document.getElementById('create-password') as HTMLInputElement;
      const confirmInput = document.getElementById('create-password-confirm') as HTMLInputElement;
      pwInput.value = 'validpassword';
      confirmInput.value = 'validpassword';

      const btn = document.getElementById('btn-create')!;
      btn.click();

      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith('Failed: Crypto failed', 'error');
        expect(btn.getAttribute('disabled')).toBeNull();
        expect(btn.textContent).toBe('Generate New Wallet');
      });
    });
  });

  // ── bindSetupEvents — import wallet ──

  describe('import wallet flow', () => {
    beforeEach(() => {
      mockWallet.hasStoredWallet.mockReturnValue(false);
      mockWallet.getStoredWallet.mockReturnValue(null);
      renderIntoDOM(renderSetup());
      bindSetupEvents();
    });

    it('shows error when mnemonic is empty', async () => {
      const mnemonicInput = document.getElementById('import-mnemonic') as HTMLTextAreaElement;
      const pwInput = document.getElementById('import-password') as HTMLInputElement;
      mnemonicInput.value = '';
      pwInput.value = 'validpassword';

      document.getElementById('btn-import')!.click();

      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith(
          'Please enter a valid 25-word mnemonic',
          'error'
        );
      });
    });

    it('shows error when mnemonic has wrong word count', async () => {
      const mnemonicInput = document.getElementById('import-mnemonic') as HTMLTextAreaElement;
      const pwInput = document.getElementById('import-password') as HTMLInputElement;
      mnemonicInput.value = 'word1 word2 word3';
      pwInput.value = 'validpassword';

      document.getElementById('btn-import')!.click();

      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith(
          'Please enter a valid 25-word mnemonic',
          'error'
        );
      });
    });

    it('shows error when import password is too short', async () => {
      const words = Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ');
      const mnemonicInput = document.getElementById('import-mnemonic') as HTMLTextAreaElement;
      const pwInput = document.getElementById('import-password') as HTMLInputElement;
      mnemonicInput.value = words;
      pwInput.value = 'short';

      document.getElementById('btn-import')!.click();

      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith(
          'Password must be at least 8 characters',
          'error'
        );
      });
    });

    it('imports wallet and navigates to scan when no saved agent', async () => {
      const words = Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ');
      mockWallet.importWallet.mockResolvedValue({ address: 'IMPORTED_ADDR' });
      mockQrScanner.loadConnection.mockReturnValue(null);

      const mnemonicInput = document.getElementById('import-mnemonic') as HTMLTextAreaElement;
      const pwInput = document.getElementById('import-password') as HTMLInputElement;
      mnemonicInput.value = words;
      pwInput.value = 'validpassword';

      document.getElementById('btn-import')!.click();

      await vi.waitFor(() => {
        expect(mockWallet.importWallet).toHaveBeenCalledWith(words, 'validpassword');
        expect(mockStore.setWallet).toHaveBeenCalledWith('IMPORTED_ADDR');
        expect(mockToast.showToast).toHaveBeenCalledWith('Wallet imported!', 'success');
        expect(mockStore.setView).toHaveBeenCalledWith('scan');
      });
    });

    it('shows error and re-enables button on import failure', async () => {
      const words = Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ');
      mockWallet.importWallet.mockRejectedValue(new Error('Invalid mnemonic'));

      const mnemonicInput = document.getElementById('import-mnemonic') as HTMLTextAreaElement;
      const pwInput = document.getElementById('import-password') as HTMLInputElement;
      mnemonicInput.value = words;
      pwInput.value = 'validpassword';

      const btn = document.getElementById('btn-import')!;
      btn.click();

      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith('Failed: Invalid mnemonic', 'error');
        expect(btn.getAttribute('disabled')).toBeNull();
        expect(btn.textContent).toBe('Import Wallet');
      });
    });
  });

  // ── bindSetupEvents — unlock wallet ──

  describe('unlock wallet flow', () => {
    beforeEach(() => {
      mockWallet.hasStoredWallet.mockReturnValue(true);
      mockWallet.getStoredWallet.mockReturnValue({
        address: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX',
        encryptedMnemonic: 'enc',
        iv: 'iv',
        salt: 'salt',
      });
      mockQrScanner.loadConnection.mockReturnValue(null);
      renderIntoDOM(renderSetup());
      bindSetupEvents();
    });

    it('shows error when password is empty', async () => {
      const pwInput = document.getElementById('unlock-password') as HTMLInputElement;
      pwInput.value = '';

      document.getElementById('btn-unlock')!.click();

      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith(
          'Please enter your password',
          'error'
        );
      });
    });

    it('unlocks wallet and navigates to scan when no saved agent', async () => {
      mockWallet.unlockWallet.mockResolvedValue({ address: 'UNLOCKED_ADDR' });

      const pwInput = document.getElementById('unlock-password') as HTMLInputElement;
      pwInput.value = 'mypassword';

      document.getElementById('btn-unlock')!.click();

      await vi.waitFor(() => {
        expect(mockWallet.unlockWallet).toHaveBeenCalledWith('mypassword');
        expect(mockStore.setWallet).toHaveBeenCalledWith('UNLOCKED_ADDR');
        expect(mockStore.setView).toHaveBeenCalledWith('scan');
      });
    });

    it('unlocks wallet and navigates to chat when saved agent exists', async () => {
      const savedAgent = {
        address: 'AGENT_ADDR',
        psk: new Uint8Array(32),
        label: 'TestAgent',
        network: 'testnet' as const,
        addedAt: Date.now(),
      };
      mockWallet.unlockWallet.mockResolvedValue({ address: 'UNLOCKED_ADDR' });
      mockQrScanner.loadConnection.mockReturnValue(savedAgent);

      renderIntoDOM(renderSetup());
      bindSetupEvents();

      const pwInput = document.getElementById('unlock-password') as HTMLInputElement;
      pwInput.value = 'mypassword';
      document.getElementById('btn-unlock')!.click();

      await vi.waitFor(() => {
        expect(mockStore.setAgentConnection).toHaveBeenCalledWith(savedAgent);
        expect(mockStore.setView).toHaveBeenCalledWith('chat');
      });
    });

    it('shows "Wrong password" on invalid password error', async () => {
      mockWallet.unlockWallet.mockRejectedValue(new Error('Invalid password'));

      const pwInput = document.getElementById('unlock-password') as HTMLInputElement;
      pwInput.value = 'wrongpassword';

      document.getElementById('btn-unlock')!.click();

      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith('Wrong password', 'error');
      });
    });

    it('shows "Unlock failed" on non-password error', async () => {
      mockWallet.unlockWallet.mockRejectedValue(new Error('Database corrupt'));

      const pwInput = document.getElementById('unlock-password') as HTMLInputElement;
      pwInput.value = 'somepassword';

      document.getElementById('btn-unlock')!.click();

      await vi.waitFor(() => {
        expect(mockToast.showToast).toHaveBeenCalledWith('Unlock failed', 'error');
      });
    });

    it('unlocks on Enter key press in password field', async () => {
      mockWallet.unlockWallet.mockResolvedValue({ address: 'UNLOCKED_ADDR' });

      const pwInput = document.getElementById('unlock-password') as HTMLInputElement;
      pwInput.value = 'mypassword';
      pwInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      await vi.waitFor(() => {
        expect(mockWallet.unlockWallet).toHaveBeenCalledWith('mypassword');
      });
    });

    it('re-enables button after unlock failure', async () => {
      mockWallet.unlockWallet.mockRejectedValue(new Error('Invalid password'));

      const pwInput = document.getElementById('unlock-password') as HTMLInputElement;
      pwInput.value = 'wrong';
      const btn = document.getElementById('btn-unlock')!;
      btn.click();

      await vi.waitFor(() => {
        expect(btn.getAttribute('disabled')).toBeNull();
        expect(btn.textContent).toBe('Unlock');
      });
    });
  });

  // ── bindSetupEvents — reset wallet ──

  describe('reset wallet flow', () => {
    beforeEach(() => {
      mockWallet.hasStoredWallet.mockReturnValue(true);
      mockWallet.getStoredWallet.mockReturnValue({
        address: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX',
        encryptedMnemonic: 'enc',
        iv: 'iv',
        salt: 'salt',
      });
      renderIntoDOM(renderSetup());
      bindSetupEvents();
    });

    it('deletes wallet when user confirms reset', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      document.getElementById('btn-reset-wallet')!.click();

      expect(mockWallet.deleteWallet).toHaveBeenCalled();
      expect(mockToast.showToast).toHaveBeenCalledWith('Wallet deleted', 'info');
      expect(mockStore.setView).toHaveBeenCalledWith('setup');
    });

    it('does nothing when user cancels reset', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      document.getElementById('btn-reset-wallet')!.click();

      expect(mockWallet.deleteWallet).not.toHaveBeenCalled();
    });
  });
});
