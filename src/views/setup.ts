/**
 * Setup view - Wallet creation/unlock + Agent connection
 */
import { store } from '../store.ts';
import {
  hasStoredWallet,
  getStoredWallet,
  createWallet,
  importWallet,
  unlockWallet,
  deleteWallet,
} from '../wallet.ts';
import { loadConnection } from '../qr-scanner.ts';
import { showToast } from '../toast.ts';

export function renderSetup(): string {
  const hasWallet = hasStoredWallet();
  const stored = getStoredWallet();
  const savedAgent = loadConnection();

  if (hasWallet && stored) {
    return renderUnlockView(stored.address, !!savedAgent);
  }

  return renderCreateView();
}

function renderCreateView(): string {
  return `
    <div class="setup-view">
      <div class="setup-view__title">CORVID CHAT</div>
      <div class="setup-view__subtitle">
        Decentralized messaging powered by Algorand.
        Create or import a wallet to get started.
      </div>

      <div class="setup-card">
        <div class="setup-card__title">Create Wallet</div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="create-password" class="form-input"
            placeholder="Choose a password..." autocomplete="new-password">
          <div class="form-hint">Encrypts your wallet locally</div>
        </div>
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <input type="password" id="create-password-confirm" class="form-input"
            placeholder="Confirm password..." autocomplete="new-password">
        </div>
        <button id="btn-create" class="btn btn--primary btn--full">
          Generate New Wallet
        </button>
      </div>

      <div class="divider">or</div>

      <div class="setup-card">
        <div class="setup-card__title">Import Wallet</div>
        <div class="form-group">
          <label class="form-label">25-word Mnemonic</label>
          <textarea id="import-mnemonic" class="form-input form-textarea"
            placeholder="Enter your Algorand mnemonic..." rows="3"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="import-password" class="form-input"
            placeholder="Choose a password..." autocomplete="new-password">
        </div>
        <button id="btn-import" class="btn btn--secondary btn--full">
          Import Wallet
        </button>
      </div>
    </div>
  `;
}

function renderUnlockView(address: string, hasAgent: boolean): string {
  const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`;
  return `
    <div class="setup-view">
      <div class="setup-view__title">CORVID CHAT</div>
      <div class="setup-view__subtitle">
        Welcome back. Unlock your wallet to continue.
      </div>

      <div class="setup-card">
        <div class="setup-card__title">Unlock Wallet</div>
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem">
          <span class="status-dot status-dot--grey"></span>
          <span style="font-family:var(--font-mono);font-size:0.75rem;color:var(--text-secondary)">
            ${shortAddr}
          </span>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="unlock-password" class="form-input"
            placeholder="Enter your password..." autocomplete="current-password"
            autofocus>
        </div>
        <button id="btn-unlock" class="btn btn--primary btn--full">
          Unlock
        </button>
        ${hasAgent ? '<div class="form-hint" style="text-align:center;margin-top:0.75rem">Agent connection saved</div>' : ''}
      </div>

      <div style="margin-top:1rem">
        <button id="btn-reset-wallet" class="btn btn--danger" style="font-size:0.7rem">
          Reset Wallet
        </button>
      </div>
    </div>
  `;
}

export function bindSetupEvents(): void {
  // Create wallet
  const btnCreate = document.getElementById('btn-create');
  btnCreate?.addEventListener('click', async () => {
    const password = (
      document.getElementById('create-password') as HTMLInputElement
    )?.value;
    const confirm = (
      document.getElementById('create-password-confirm') as HTMLInputElement
    )?.value;

    if (!password || password.length < 8) {
      showToast('Password must be at least 8 characters', 'error');
      return;
    }
    if (password !== confirm) {
      showToast('Passwords do not match', 'error');
      return;
    }

    try {
      btnCreate.setAttribute('disabled', 'true');
      btnCreate.textContent = 'Generating...';
      const account = await createWallet(password);
      store.setWallet(account.address);
      showToast('Wallet created!', 'success');

      // Check for saved agent connection
      const savedAgent = loadConnection();
      if (savedAgent) {
        store.setAgentConnection(savedAgent);
        store.setView('chat');
      } else {
        store.setView('scan');
      }
    } catch (err) {
      showToast(
        `Failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        'error'
      );
      btnCreate.removeAttribute('disabled');
      btnCreate.textContent = 'Generate New Wallet';
    }
  });

  // Import wallet
  const btnImport = document.getElementById('btn-import');
  btnImport?.addEventListener('click', async () => {
    const mnemonic = (
      document.getElementById('import-mnemonic') as HTMLTextAreaElement
    )?.value;
    const password = (
      document.getElementById('import-password') as HTMLInputElement
    )?.value;

    if (!mnemonic || mnemonic.trim().split(/\s+/).length !== 25) {
      showToast('Please enter a valid 25-word mnemonic', 'error');
      return;
    }
    if (!password || password.length < 8) {
      showToast('Password must be at least 8 characters', 'error');
      return;
    }

    try {
      btnImport.setAttribute('disabled', 'true');
      btnImport.textContent = 'Importing...';
      const account = await importWallet(mnemonic, password);
      store.setWallet(account.address);
      showToast('Wallet imported!', 'success');

      const savedAgent = loadConnection();
      if (savedAgent) {
        store.setAgentConnection(savedAgent);
        store.setView('chat');
      } else {
        store.setView('scan');
      }
    } catch (err) {
      showToast(
        `Failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        'error'
      );
      btnImport.removeAttribute('disabled');
      btnImport.textContent = 'Import Wallet';
    }
  });

  // Unlock wallet
  const btnUnlock = document.getElementById('btn-unlock');
  const unlockPassword = document.getElementById(
    'unlock-password'
  ) as HTMLInputElement;

  const doUnlock = async () => {
    const password = unlockPassword?.value;
    if (!password) {
      showToast('Please enter your password', 'error');
      return;
    }

    try {
      if (btnUnlock) {
        btnUnlock.setAttribute('disabled', 'true');
        btnUnlock.textContent = 'Unlocking...';
      }
      const account = await unlockWallet(password);
      store.setWallet(account.address);
      showToast('Wallet unlocked', 'success');

      const savedAgent = loadConnection();
      if (savedAgent) {
        store.setAgentConnection(savedAgent);
        store.setView('chat');
      } else {
        store.setView('scan');
      }
    } catch (err) {
      showToast(
        err instanceof Error && err.message === 'Invalid password'
          ? 'Wrong password'
          : 'Unlock failed',
        'error'
      );
      if (btnUnlock) {
        btnUnlock.removeAttribute('disabled');
        btnUnlock.textContent = 'Unlock';
      }
    }
  };

  btnUnlock?.addEventListener('click', doUnlock);
  unlockPassword?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doUnlock();
  });

  // Reset wallet
  const btnReset = document.getElementById('btn-reset-wallet');
  btnReset?.addEventListener('click', () => {
    if (
      confirm(
        'This will delete your stored wallet. Make sure you have your mnemonic backed up. Continue?'
      )
    ) {
      deleteWallet();
      showToast('Wallet deleted', 'info');
      store.setView('setup');
    }
  });
}
