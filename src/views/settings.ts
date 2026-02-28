/**
 * Settings view - Wallet management, agent info, disconnect
 */
import { store } from '../store.ts';
import { getAccount, exportMnemonic, deleteWallet, lockWallet } from '../wallet.ts';
import { clearConnection, loadConnection } from '../qr-scanner.ts';
import { messaging } from '../messaging.ts';
import { showToast } from '../toast.ts';
import { escapeHtml } from '../utils.ts';
import { deleteDatabase } from '../db.ts';
import { getIdleTimeout, setIdleTimeout, startIdleLock } from '../idle-lock.ts';
import { getDeviceName, setDeviceName } from '../device-name.ts';

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
  const idleTimeoutMin = Math.round(getIdleTimeout() / 60_000);
  const currentDeviceName = getDeviceName() ?? '';

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
        <div class="form-group">
          <label class="form-label">Auto-lock timeout</label>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <input type="number" id="idle-timeout" class="form-input" value="${idleTimeoutMin}"
              min="1" max="120" style="width:5rem;text-align:center">
            <span style="font-size:0.75rem;color:var(--text-secondary)">minutes</span>
          </div>
          <div class="form-hint">Wallet locks automatically after inactivity</div>
        </div>
        <div class="form-group">
          <label class="form-label">Device name</label>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <input type="text" id="device-name" class="form-input"
              value="${escapeHtml(currentDeviceName)}" placeholder="e.g. mac, phone"
              maxlength="16" style="width:10rem">
          </div>
          <div class="form-hint">Identifies this device in multi-device chat</div>
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

      <!-- Send Section -->
      <div class="setup-card" style="max-width:100%;margin-top:1rem">
        <div class="setup-card__title">Send</div>
        <div style="display:flex;gap:0.25rem;margin-bottom:0.75rem">
          <button id="btn-send-tab-algo" class="btn btn--secondary send-tab send-tab--active"
            style="flex:1;padding:0.35rem 0.5rem;font-size:0.75rem">ALGO</button>
          <button id="btn-send-tab-usdc" class="btn btn--secondary send-tab"
            style="flex:1;padding:0.35rem 0.5rem;font-size:0.75rem"${network === 'testnet' ? ' disabled title="USDC not available on testnet"' : ''}>USDC</button>
        </div>
        <div class="form-group">
          <label class="form-label">Recipient</label>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <input type="text" id="send-recipient" class="form-input"
              placeholder="Algorand address..." style="font-family:var(--font-mono);font-size:0.7rem">
            ${agentAddr ? `<button id="btn-send-agent" class="btn btn--secondary" style="white-space:nowrap;padding:0.4rem 0.6rem;font-size:0.7rem">Agent</button>` : ''}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Amount</label>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <input type="number" id="send-amount" class="form-input"
              placeholder="0.00" min="0" step="any" style="width:10rem;text-align:right">
            <span id="send-unit" style="font-size:0.8rem;color:var(--text-secondary);min-width:3rem">ALGO</span>
          </div>
          <div class="form-hint" id="send-hint">1 ALGO = 1,000,000 microALGO</div>
        </div>
        <button id="btn-send" class="btn btn--primary" style="width:100%">
          Send
        </button>
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

      <!-- Ecosystem Links -->
      <div class="setup-card" style="max-width:100%;margin-top:1rem">
        <div class="setup-card__title">Ecosystem</div>
        <div class="ecosystem-links">
          <a href="https://corvid-agent.github.io/" target="_blank" rel="noopener" class="eco-link">
            <span class="eco-link__icon">&#x1F3E0;</span>
            <span class="eco-link__text">Home</span>
          </a>
          <a href="https://corvid-agent.github.io/agent-dashboard/" target="_blank" rel="noopener" class="eco-link">
            <span class="eco-link__icon">&#x1F4CA;</span>
            <span class="eco-link__text">Dashboard</span>
          </a>
          <a href="https://corvid-agent.github.io/agent-profile/" target="_blank" rel="noopener" class="eco-link">
            <span class="eco-link__icon">&#x1F464;</span>
            <span class="eco-link__text">Profile</span>
          </a>
          <a href="https://corvid-agent.github.io/algo-explorer/" target="_blank" rel="noopener" class="eco-link">
            <span class="eco-link__icon">&#x1F50D;</span>
            <span class="eco-link__text">Explorer</span>
          </a>
          <a href="https://corvid-agent.github.io/bw-cinema/" target="_blank" rel="noopener" class="eco-link">
            <span class="eco-link__icon">&#x1F3AC;</span>
            <span class="eco-link__text">Cinema</span>
          </a>
          <a href="https://github.com/corvid-agent/corvid-agent-chat" target="_blank" rel="noopener" class="eco-link">
            <span class="eco-link__icon">&#x2699;</span>
            <span class="eco-link__text">Source</span>
          </a>
        </div>
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

  // Idle timeout setting
  const idleInput = document.getElementById('idle-timeout') as HTMLInputElement | null;
  idleInput?.addEventListener('change', () => {
    const val = parseInt(idleInput.value, 10);
    if (val >= 1 && val <= 120) {
      setIdleTimeout(val);
      startIdleLock(); // restart with new timeout
      showToast(`Auto-lock set to ${val} min`, 'info');
    } else {
      idleInput.value = String(Math.round(getIdleTimeout() / 60_000));
      showToast('Timeout must be 1-120 minutes', 'error');
    }
  });

  // Device name setting
  const deviceNameInput = document.getElementById('device-name') as HTMLInputElement | null;
  deviceNameInput?.addEventListener('change', () => {
    const val = deviceNameInput.value.trim();
    if (setDeviceName(val)) {
      showToast(val ? `Device name set to "${val}"` : 'Device name cleared', 'info');
    } else {
      deviceNameInput.value = getDeviceName() ?? '';
      showToast('Invalid name (letters, numbers, hyphens, underscores, max 16)', 'error');
    }
  });

  // ── Send section ──
  let sendAsset: 'algo' | 'usdc' = 'algo';
  const MAINNET_USDC_ASA = 31566704;

  const algoTab = document.getElementById('btn-send-tab-algo');
  const usdcTab = document.getElementById('btn-send-tab-usdc');
  const sendUnit = document.getElementById('send-unit');
  const sendHint = document.getElementById('send-hint');
  const sendAmountInput = document.getElementById('send-amount') as HTMLInputElement | null;

  const updateSendTabs = () => {
    if (algoTab) algoTab.className = `btn btn--secondary send-tab${sendAsset === 'algo' ? ' send-tab--active' : ''}`;
    if (usdcTab) usdcTab.className = `btn btn--secondary send-tab${sendAsset === 'usdc' ? ' send-tab--active' : ''}`;
    if (sendUnit) sendUnit.textContent = sendAsset === 'algo' ? 'ALGO' : 'USDC';
    if (sendHint) sendHint.textContent = sendAsset === 'algo' ? '1 ALGO = 1,000,000 microALGO' : '6 decimal places (e.g. 1.00 = 1 USDC)';
    if (sendAmountInput) sendAmountInput.value = '';
  };

  algoTab?.addEventListener('click', () => { sendAsset = 'algo'; updateSendTabs(); });
  usdcTab?.addEventListener('click', () => {
    if ((usdcTab as HTMLButtonElement).disabled) return;
    sendAsset = 'usdc';
    updateSendTabs();
  });

  // Pre-fill agent address
  document.getElementById('btn-send-agent')?.addEventListener('click', () => {
    const recipientInput = document.getElementById('send-recipient') as HTMLInputElement | null;
    const agentAddress = store.getState().agent.connection?.address;
    if (recipientInput && agentAddress) {
      recipientInput.value = agentAddress;
    }
  });

  // Send button
  document.getElementById('btn-send')?.addEventListener('click', () => {
    const recipientInput = document.getElementById('send-recipient') as HTMLInputElement | null;
    const amountInput = document.getElementById('send-amount') as HTMLInputElement | null;
    const recipient = recipientInput?.value.trim() ?? '';
    const amountStr = amountInput?.value.trim() ?? '';
    const amount = parseFloat(amountStr);

    if (!recipient || recipient.length < 58) {
      showToast('Enter a valid Algorand address', 'error');
      return;
    }
    if (!amountStr || isNaN(amount) || amount <= 0) {
      showToast('Enter a positive amount', 'error');
      return;
    }

    const displayAmount = `${amount} ${sendAsset === 'algo' ? 'ALGO' : 'USDC'}`;
    const shortAddr = `${recipient.slice(0, 6)}...${recipient.slice(-6)}`;

    // Confirmation modal
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__title">Confirm Send</div>
        <div style="font-size:0.85rem;margin-bottom:0.75rem;color:var(--text-secondary)">
          Send <strong style="color:var(--accent-green)">${displayAmount}</strong> to
          <code style="font-size:0.7rem;color:var(--accent-cyan)">${shortAddr}</code>?
        </div>
        <div class="modal__actions">
          <button class="btn btn--secondary" id="send-cancel">Cancel</button>
          <button class="btn btn--primary" id="send-confirm">Send</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const closeOverlay = () => overlay.remove();
    document.getElementById('send-cancel')?.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });

    document.getElementById('send-confirm')?.addEventListener('click', async () => {
      closeOverlay();
      const sendBtn = document.getElementById('btn-send') as HTMLButtonElement | null;
      if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; }

      try {
        let txid: string;
        if (sendAsset === 'algo') {
          const microAlgos = Math.round(amount * 1_000_000);
          txid = await messaging.sendAlgo(recipient, microAlgos);
        } else {
          const usdcMicro = Math.round(amount * 1_000_000);
          txid = await messaging.sendUsdc(recipient, usdcMicro, MAINNET_USDC_ASA);
        }
        showToast(`Sent! txid: ${txid.slice(0, 12)}...`, 'success');
        if (recipientInput) recipientInput.value = '';
        if (amountInput) amountInput.value = '';
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Send failed', 'error');
      } finally {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
      }
    });
  });

  // Export mnemonic
  document
    .getElementById('btn-export-mnemonic')
    ?.addEventListener('click', () => {
      // Show a proper password modal instead of prompt()
      const pwOverlay = document.createElement('div');
      pwOverlay.className = 'modal-overlay';
      pwOverlay.innerHTML = `
        <div class="modal">
          <div class="modal__title">Export Mnemonic</div>
          <div class="form-group">
            <label class="form-label">Wallet Password</label>
            <input type="password" id="export-pw-input" class="form-input"
              placeholder="Enter your wallet password..." autocomplete="current-password" autofocus>
          </div>
          <div class="modal__actions">
            <button class="btn btn--secondary" id="export-pw-cancel">Cancel</button>
            <button class="btn btn--primary" id="export-pw-confirm">Export</button>
          </div>
        </div>
      `;
      document.body.appendChild(pwOverlay);

      const pwInput = document.getElementById('export-pw-input') as HTMLInputElement;
      pwInput?.focus();

      const closeOverlay = () => pwOverlay.remove();
      document.getElementById('export-pw-cancel')?.addEventListener('click', closeOverlay);
      pwOverlay.addEventListener('click', (e) => { if (e.target === pwOverlay) closeOverlay(); });
      const onEscPw = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { closeOverlay(); document.removeEventListener('keydown', onEscPw); }
      };
      document.addEventListener('keydown', onEscPw);

      const doExport = async () => {
        const password = pwInput?.value;
        if (!password) { showToast('Enter your password', 'error'); return; }
        closeOverlay();
        document.removeEventListener('keydown', onEscPw);

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

        // Close on click outside modal
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) overlay.remove();
        });

        // Close on Escape key
        const onEscape = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', onEscape);
          }
        };
        document.addEventListener('keydown', onEscape);
        } catch (err) {
          showToast(
            err instanceof Error ? err.message : 'Export failed',
            'error'
          );
        }
      };

      document.getElementById('export-pw-confirm')?.addEventListener('click', doExport);
      pwInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doExport(); });
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
    ?.addEventListener('click', async () => {
      if (
        confirm(
          'This will permanently delete your wallet and all data. This cannot be undone. Continue?'
        )
      ) {
        messaging.destroy();
        clearConnection();
        deleteWallet();
        await deleteDatabase();
        localStorage.clear();
        store.lockWallet();
        showToast('All data deleted', 'info');
      }
    });
}
