/**
 * Settings view - Wallet management, agent info, disconnect
 */
import { store } from '../store.ts';
import { getAccount, exportMnemonic, deleteWallet, lockWallet } from '../wallet.ts';
import { clearConnection, loadConnection } from '../qr-scanner.ts';
import { messaging } from '../messaging.ts';
import { showToast } from '../toast.ts';

export function renderSettings(): string {
  const state = store.getState();
  const wallet = state.wallet;
  const agent = state.agent.connection;

  const walletAddr = wallet.address ?? 'Not connected';
  const balance = wallet.balance;
  const balanceAlgo = (balance / 1_000_000).toFixed(4);
  const agentLabel = agent?.label ?? 'None';
  const agentAddr = agent?.address ?? '';
  const network = agent?.network ?? 'mainnet';

  return `
    <div class="header">
      <div class="header__brand">
        <div class="header__title">Settings</div>
      </div>
      <div class="header__controls">
        <button id="btn-back-chat" class="icon-btn" title="Back to chat">&#x2190;</button>
      </div>
    </div>

    <div style="flex:1;overflow-y:auto;padding:1.25rem">
      <!-- Wallet Section -->
      <div class="setup-card" style="max-width:100%">
        <div class="setup-card__title">Wallet</div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <input type="text" class="form-input" value="${walletAddr}" readonly
              style="font-family:var(--font-mono);font-size:0.7rem">
            <button id="btn-copy-addr" class="btn btn--secondary" style="white-space:nowrap;padding:0.4rem 0.6rem;font-size:0.7rem">
              Copy
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Balance</label>
          <div style="font-size:0.9rem;color:var(--accent-green)">
            ${balanceAlgo} ALGO
          </div>
          <div class="form-hint">${balance.toLocaleString()} microALGO</div>
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button id="btn-export-mnemonic" class="btn btn--secondary">
            Export Mnemonic
          </button>
          <button id="btn-lock-wallet" class="btn btn--secondary">
            Lock Wallet
          </button>
        </div>
      </div>

      <!-- Agent Connection Section -->
      <div class="setup-card" style="max-width:100%;margin-top:1rem">
        <div class="setup-card__title">Agent Connection</div>
        ${agent ? `
          <div class="form-group">
            <label class="form-label">Label</label>
            <div style="font-size:0.85rem">${escapeHtml(agentLabel)}</div>
          </div>
          <div class="form-group">
            <label class="form-label">Address</label>
            <div style="font-family:var(--font-mono);font-size:0.7rem;color:var(--accent-cyan);word-break:break-all">
              ${agentAddr}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Network</label>
            <span class="network-badge network-badge--${network}">${network}</span>
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <div style="display:flex;align-items:center;gap:0.4rem">
              <span class="status-dot ${state.agent.online ? 'status-dot--green' : 'status-dot--grey'}"></span>
              <span style="font-size:0.8rem">${state.agent.online ? 'Online' : 'Offline'}</span>
            </div>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            <button id="btn-reconnect" class="btn btn--secondary">
              Scan New Agent
            </button>
            <button id="btn-disconnect" class="btn btn--danger">
              Disconnect
            </button>
          </div>
        ` : `
          <div style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:1rem">
            No agent connected
          </div>
          <button id="btn-scan-agent" class="btn btn--primary">
            Scan QR Code
          </button>
        `}
      </div>

      <!-- Danger Zone -->
      <div class="setup-card" style="max-width:100%;margin-top:1rem;border-color:rgba(255,51,85,0.3)">
        <div class="setup-card__title" style="color:var(--accent-red)">Danger Zone</div>
        <div class="form-hint" style="margin-bottom:0.75rem">
          This will delete your wallet and all local data. Make sure you've backed up your mnemonic.
        </div>
        <button id="btn-delete-all" class="btn btn--danger">
          Delete Wallet &amp; Data
        </button>
      </div>
    </div>
  `;
}

export function bindSettingsEvents(): void {
  // Back to chat
  document
    .getElementById('btn-back-chat')
    ?.addEventListener('click', () => {
      const agent = store.getState().agent.connection;
      store.setView(agent ? 'chat' : 'setup');
    });

  // Copy address
  document
    .getElementById('btn-copy-addr')
    ?.addEventListener('click', () => {
      const addr = store.getState().wallet.address;
      if (addr) {
        navigator.clipboard.writeText(addr).then(() => {
          showToast('Address copied', 'info');
        });
      }
    });

  // Export mnemonic
  document
    .getElementById('btn-export-mnemonic')
    ?.addEventListener('click', async () => {
      const password = prompt('Enter your wallet password to export mnemonic:');
      if (!password) return;

      try {
        const mnemonic = await exportMnemonic(password);
        // Show in a temporary modal-like display
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
          <div class="modal">
            <div class="modal__title">Your Mnemonic</div>
            <div style="font-family:var(--font-mono);font-size:0.75rem;background:var(--bg-input);padding:0.75rem;border-radius:var(--radius);word-break:break-word;line-height:2;color:var(--accent-amber)">
              ${escapeHtml(mnemonic)}
            </div>
            <div class="form-hint" style="margin-top:0.5rem;color:var(--accent-red)">
              Store this securely. Anyone with this mnemonic can access your wallet.
            </div>
            <div class="modal__actions">
              <button class="btn btn--secondary" id="btn-copy-mnemonic">Copy</button>
              <button class="btn btn--primary" id="btn-close-mnemonic">Close</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

        document
          .getElementById('btn-copy-mnemonic')
          ?.addEventListener('click', () => {
            navigator.clipboard.writeText(mnemonic).then(() => {
              showToast('Mnemonic copied', 'info');
            });
          });

        document
          .getElementById('btn-close-mnemonic')
          ?.addEventListener('click', () => {
            overlay.remove();
          });

        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) overlay.remove();
        });
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'Export failed',
          'error'
        );
      }
    });

  // Lock wallet
  document
    .getElementById('btn-lock-wallet')
    ?.addEventListener('click', () => {
      messaging.destroy();
      lockWallet();
      store.lockWallet();
      showToast('Wallet locked', 'info');
    });

  // Scan new agent
  document
    .getElementById('btn-reconnect')
    ?.addEventListener('click', () => {
      messaging.stopPolling();
      store.setView('scan');
    });

  // Scan agent (when none connected)
  document
    .getElementById('btn-scan-agent')
    ?.addEventListener('click', () => {
      store.setView('scan');
    });

  // Disconnect agent
  document
    .getElementById('btn-disconnect')
    ?.addEventListener('click', () => {
      if (confirm('Disconnect from this agent? You can reconnect by scanning again.')) {
        messaging.destroy();
        clearConnection();
        store.clearAgent();
        showToast('Disconnected', 'info');
        store.setView('scan');
      }
    });

  // Delete all data
  document
    .getElementById('btn-delete-all')
    ?.addEventListener('click', () => {
      if (
        confirm(
          'This will permanently delete your wallet and all data. This cannot be undone. Continue?'
        )
      ) {
        messaging.destroy();
        clearConnection();
        deleteWallet();
        localStorage.clear();
        store.lockWallet();
        showToast('All data deleted', 'info');
      }
    });
}
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
