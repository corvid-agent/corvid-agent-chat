/**
 * AlgoChat messaging service
 * Handles sending/receiving encrypted messages via Algorand transactions
 */
import algosdk from 'algosdk';
import {
  type ChatAccount,
  type PSKState,
  mainnet,
  testnet,
  AlgorandService,
  createPSKState,
  advanceSendCounter,
  derivePSKAtCounter,
  encryptPSKMessage,
  encodePSKEnvelope,
  decodePSKEnvelope,
  isPSKMessage,
  validateCounter,
  recordReceive,
  decryptPSKMessage,
} from '@corvidlabs/ts-algochat';
import type { Attachment, AgentConnection, ChatMessage } from './types.ts';
import { base64ToBuffer } from './utils.ts';
import { wrapWithDeviceName, parseDeviceEnvelope } from './device-name.ts';

const PSK_STATE_KEY = 'corvid-psk-state';
const LAST_ROUND_KEY = 'corvid-last-round';
const SENT_LAST_ROUND_KEY = 'corvid-sent-last-round';
const PROCESSED_TXIDS_KEY = 'corvid-processed-txids';
const POLL_INTERVAL_MS = 10_000;
const POLL_INTERVAL_MAX_MS = 120_000;
const POLL_BACKOFF_MULTIPLIER = 2;
/** Minimum ALGO to send per message (in microALGO) */
const MIN_TX_AMOUNT_MICROALGO = 1_000;

type MessageCallback = (message: ChatMessage) => void;

// Indexer response types — algosdk v3 uses camelCase and returns note as Uint8Array
interface IndexerTransaction {
  id: string;
  sender: string;
  txType: string;
  note?: Uint8Array;
  confirmedRound?: number;
  roundTime?: number;
  paymentTransaction?: {
    receiver: string;
    amount: number;
  };
}

interface IndexerSearchResponse {
  transactions: IndexerTransaction[];
  nextToken?: string;
}

export class MessagingService {
  private algodClient: algosdk.Algodv2 | null = null;
  private indexerClient: algosdk.Indexer | null = null;
  private algorandService: AlgorandService | null = null;
  private chatAccount: ChatAccount | null = null;
  private connection: AgentConnection | null = null;
  private pskState: PSKState = createPSKState();
  private lastRound = 0;
  private lastSentRound = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private callbacks: Set<MessageCallback> = new Set();
  private processedTxids: Set<string> = new Set();
  private agentEncryptionKey: Uint8Array | null = null;
  private _polling = false;
  private _pollInProgress = false;
  private _currentInterval = POLL_INTERVAL_MS;
  private _consecutiveErrors = 0;
  private _errorCallbacks: Set<(error: Error | null) => void> = new Set();

  get isPolling(): boolean {
    return this._polling;
  }

  get consecutiveErrors(): number {
    return this._consecutiveErrors;
  }

  /**
   * Subscribe to polling error state changes
   */
  onPollError(callback: (error: Error | null) => void): () => void {
    this._errorCallbacks.add(callback);
    return () => this._errorCallbacks.delete(callback);
  }

  private emitPollError(error: Error | null): void {
    for (const cb of this._errorCallbacks) {
      try { cb(error); } catch { /* ignore */ }
    }
  }

  /**
   * Initialize the service with a wallet and agent connection
   */
  initialize(account: ChatAccount, connection: AgentConnection): void {
    this.chatAccount = account;
    this.connection = connection;

    // Diagnostic: log PSK fingerprint on init
    const pskFp = Array.from(connection.psk.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
    console.info(`[messaging] initialize: address=${connection.address.slice(0, 8)}… pskFp=${pskFp} pskLen=${connection.psk.length} network=${connection.network}`);

    const networkConfig =
      connection.network === 'mainnet' ? mainnet() : testnet();

    this.algodClient = new algosdk.Algodv2(
      networkConfig.algodToken,
      networkConfig.algodUrl,
      ''
    );
    this.indexerClient = new algosdk.Indexer(
      networkConfig.indexerToken ?? '',
      networkConfig.indexerUrl ?? '',
      ''
    );
    this.algorandService = new AlgorandService({
      algodToken: networkConfig.algodToken,
      algodServer: networkConfig.algodUrl,
      indexerToken: networkConfig.indexerToken ?? '',
      indexerServer: networkConfig.indexerUrl ?? '',
    });

    // Load persisted state
    this.loadPSKState();
    this.loadLastRound();
    this.loadLastSentRound();
    this.loadProcessedTxids();
  }

  /**
   * Subscribe to incoming messages
   */
  onMessage(callback: MessageCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Start polling for incoming messages with exponential backoff on errors
   */
  startPolling(): void {
    if (this._polling) return;
    this._polling = true;
    this._currentInterval = POLL_INTERVAL_MS;
    this._consecutiveErrors = 0;
    this.schedulePoll(0); // immediate first poll
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this._polling = false;
    this._pollInProgress = false;
    this.savePSKState();
  }

  private schedulePoll(delayMs: number): void {
    if (!this._polling) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);

    this.pollTimer = setTimeout(async () => {
      if (!this._polling) return;

      // Guard against overlapping polls
      if (this._pollInProgress) {
        this.schedulePoll(this._currentInterval);
        return;
      }

      this._pollInProgress = true;
      try {
        await this.poll();
        // Success — reset backoff
        if (this._consecutiveErrors > 0) {
          this._consecutiveErrors = 0;
          this._currentInterval = POLL_INTERVAL_MS;
          this.emitPollError(null); // signal recovery
        }
      } catch (err) {
        this._consecutiveErrors++;
        // Exponential backoff: 10s → 20s → 40s → 80s → 120s (cap)
        this._currentInterval = Math.min(
          POLL_INTERVAL_MS * Math.pow(POLL_BACKOFF_MULTIPLIER, this._consecutiveErrors),
          POLL_INTERVAL_MAX_MS
        );
        console.error(
          `Poll error (attempt ${this._consecutiveErrors}, next retry in ${this._currentInterval / 1000}s):`,
          err
        );
        this.emitPollError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        this._pollInProgress = false;
      }

      // Schedule next poll
      this.schedulePoll(this._currentInterval);
    }, delayMs);
  }

  /**
   * Send a message to the connected agent
   */
  async sendMessage(content: string, attachment?: Attachment): Promise<string> {
    if (!this.chatAccount || !this.connection || !this.algodClient) {
      throw new Error('Service not initialized');
    }

    // Wrap content with device name envelope (includes attachment if present)
    const wrappedContent = wrapWithDeviceName(content, attachment);

    // Advance send counter
    const { counter, state: newState } = advanceSendCounter(this.pskState);
    this.pskState = newState;

    // Derive PSK at current counter
    const currentPSK = derivePSKAtCounter(this.connection.psk, counter);

    // Diagnostic: log PSK fingerprint and counter so we can compare with server
    const pskFp = Array.from(this.connection.psk.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
    const derivedFp = Array.from(currentPSK.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
    console.debug(`[send] PSK fingerprint=${pskFp} counter=${counter} derivedPSK=${derivedFp} pskLen=${this.connection.psk.length}`);

    // Get recipient's encryption key
    const recipientPubKey = await this.getAgentPublicKey();

    // Encrypt
    const envelope = encryptPSKMessage(
      wrappedContent,
      this.chatAccount.encryptionKeys.publicKey,
      recipientPubKey,
      currentPSK,
      counter
    );

    // Encode to bytes
    const note = encodePSKEnvelope(envelope);
    console.debug(`[send] note=${note.length}b recipientKey=${Array.from(recipientPubKey.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')} senderKey=${Array.from(this.chatAccount.encryptionKeys.publicKey.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')}`);

    // Build, sign, and submit transaction
    const params = await this.algodClient.getTransactionParams().do();
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.chatAccount.address,
      receiver: this.connection.address,
      amount: MIN_TX_AMOUNT_MICROALGO,
      note,
      suggestedParams: params,
    });

    const signedTxn = txn.signTxn(this.chatAccount.account.sk);
    const { txid } = await this.algodClient
      .sendRawTransaction(signedTxn)
      .do();

    // Track locally sent txid so the cross-device poll skips it
    this.trackProcessedTxid(txid as string);
    this.savePSKState();

    return txid as string;
  }

  /**
   * Get wallet balance
   */
  async getBalance(): Promise<number> {
    if (!this.chatAccount || !this.algodClient) return 0;
    try {
      const info = await this.algodClient
        .accountInformation(this.chatAccount.address)
        .do();
      return Number(info.amount ?? 0);
    } catch {
      return 0;
    }
  }

  /**
   * Check if the agent is reachable (has published a key)
   */
  async checkAgentOnline(): Promise<boolean> {
    try {
      const pubKey = await this.getAgentPublicKey();
      return pubKey.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopPolling();
    this.chatAccount = null;
    this.connection = null;
    this.algodClient = null;
    this.indexerClient = null;
    this.algorandService = null;
    this.agentEncryptionKey = null;
    this.callbacks.clear();
    this.processedTxids.clear();
    this._errorCallbacks.clear();
    this._consecutiveErrors = 0;
    this.lastSentRound = 0;
  }

  // ── Private ──

  private async getAgentPublicKey(): Promise<Uint8Array> {
    if (this.agentEncryptionKey) return this.agentEncryptionKey;

    if (this.connection?.publicKey) {
      this.agentEncryptionKey = this.connection.publicKey;
      return this.agentEncryptionKey;
    }

    if (!this.algorandService || !this.connection) {
      throw new Error('Service not initialized');
    }

    const pubKey = await this.algorandService.discoverPublicKey(
      this.connection.address
    );
    this.agentEncryptionKey = pubKey;
    return pubKey;
  }

  private async poll(): Promise<void> {
    if (!this.chatAccount || !this.connection || !this.indexerClient) return;

    const myAddress = this.chatAccount.address;
    const agentAddress = this.connection.address;
    let maxRound = this.lastRound;
    let nextToken: string | undefined;

    do {
      try {
        let query = this.indexerClient
          .searchForTransactions()
          .address(agentAddress)
          .addressRole('sender')
          .limit(50);

        if (this.lastRound > 0) {
          query = query.minRound(this.lastRound + 1);
        }

        if (nextToken) {
          query = query.nextToken(nextToken);
        }

        const response =
          (await query.do()) as unknown as IndexerSearchResponse;
        const txns = response.transactions ?? [];
        nextToken = response.nextToken;

        if (txns.length > 0) {
          console.debug(`[poll] ${txns.length} txns from ${agentAddress.slice(0, 8)}… (minRound=${this.lastRound + 1})`);
        }

        for (const tx of txns) {
          // Only payment transactions with notes, sent to us
          if (tx.txType !== 'pay' || !tx.note) continue;
          if (tx.sender !== agentAddress) continue;
          if (tx.paymentTransaction?.receiver !== myAddress) continue;

          // Deduplication
          if (this.processedTxids.has(tx.id)) continue;

          // algosdk v3 returns note as Uint8Array, not base64 string
          const noteBytes = tx.note instanceof Uint8Array
            ? tx.note
            : base64ToBuffer(tx.note as unknown as string);

          // Check PSK protocol
          if (!isPSKMessage(noteBytes)) {
            console.debug(`[poll] txid=${tx.id.slice(0, 8)}… not a PSK message (${noteBytes.length} bytes)`);
            continue;
          }

          try {
            const envelope = decodePSKEnvelope(noteBytes);
            console.debug(`[poll] PSK envelope txid=${tx.id.slice(0, 8)}… counter=${envelope.ratchetCounter}`);

            // Validate counter
            if (
              !validateCounter(this.pskState, envelope.ratchetCounter)
            ) {
              console.warn(
                `Rejected message with counter ${envelope.ratchetCounter} (peerLast=${this.pskState.peerLastCounter})`
              );
              continue;
            }

            // Derive PSK
            const currentPSK = derivePSKAtCounter(
              this.connection.psk,
              envelope.ratchetCounter
            );

            // Decrypt
            const decrypted = decryptPSKMessage(
              envelope,
              this.chatAccount.encryptionKeys.privateKey,
              this.chatAccount.encryptionKeys.publicKey,
              currentPSK
            );

            if (!decrypted) {
              console.warn(`[poll] decryption failed for txid=${tx.id.slice(0, 8)}…`);
              continue;
            }
            console.debug(`[poll] decrypted message: ${decrypted.text.slice(0, 60)}…`);

            // Cache agent's encryption key
            if (!this.agentEncryptionKey && envelope.senderPublicKey) {
              this.agentEncryptionKey = envelope.senderPublicKey;
            }

            // Update counter state
            this.pskState = recordReceive(
              this.pskState,
              envelope.ratchetCounter
            );

            // Track processed
            this.trackProcessedTxid(tx.id);

            // Parse device envelope for device name and attachment
            const deviceEnvelope = parseDeviceEnvelope(decrypted.text);

            // Create message
            const message: ChatMessage = {
              id: tx.id,
              content: deviceEnvelope.content,
              direction: 'received',
              timestamp: new Date(
                (tx.roundTime ?? Math.floor(Date.now() / 1000)) * 1000
              ),
              status: 'confirmed',
              txid: tx.id,
              deviceName: deviceEnvelope.deviceName,
              attachment: deviceEnvelope.attachment,
            };

            // Emit to callbacks
            for (const cb of this.callbacks) {
              try {
                cb(message);
              } catch (err) {
                console.error('Message callback error:', err);
              }
            }
          } catch (err) {
            console.error(`Error processing message ${tx.id}:`, err);
          }

          const txRound = Number(tx.confirmedRound ?? 0);
          if (txRound > maxRound) {
            maxRound = txRound;
          }
        }
      } catch (err) {
        // Rethrow to trigger backoff in schedulePoll
        throw err;
      }
    } while (nextToken);

    if (maxRound > this.lastRound) {
      this.lastRound = maxRound;
      this.saveLastRound();
      this.savePSKState();
      // Clear processed txids — minRound filtering prevents re-processing old transactions
      this.processedTxids.clear();
      this.saveProcessedTxids();
    }

    // Also poll for messages sent from our wallet by other devices
    await this.pollSentMessages();
  }

  private trackProcessedTxid(txid: string): void {
    this.processedTxids.add(txid);
    this.saveProcessedTxids();
  }

  private saveProcessedTxids(): void {
    if (!this.connection) return;
    const key = `${PROCESSED_TXIDS_KEY}-${this.connection.address}`;
    localStorage.setItem(key, JSON.stringify([...this.processedTxids]));
  }

  private loadProcessedTxids(): void {
    if (!this.connection) return;
    const key = `${PROCESSED_TXIDS_KEY}-${this.connection.address}`;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        this.processedTxids = new Set(arr);
      }
    } catch {
      // Reset on parse error
      this.processedTxids = new Set();
    }
  }

  /**
   * Poll for PSK messages sent FROM our wallet TO the agent by other devices.
   * Decrypts as sender, emits as 'sent' messages, and syncs the send counter.
   */
  private async pollSentMessages(): Promise<void> {
    if (!this.chatAccount || !this.connection || !this.indexerClient) return;

    const myAddress = this.chatAccount.address;
    const agentAddress = this.connection.address;
    let maxRound = this.lastSentRound;
    let nextToken: string | undefined;
    let counterSynced = false;

    do {
      let query = this.indexerClient
        .searchForTransactions()
        .address(myAddress)
        .addressRole('sender')
        .limit(50);

      if (this.lastSentRound > 0) {
        query = query.minRound(this.lastSentRound + 1);
      }

      if (nextToken) {
        query = query.nextToken(nextToken);
      }

      const response =
        (await query.do()) as unknown as IndexerSearchResponse;
      const txns = response.transactions ?? [];
      nextToken = response.nextToken;

      for (const tx of txns) {
        // Only payment transactions with notes, sent by us to the agent
        if (tx.txType !== 'pay' || !tx.note) continue;
        if (tx.sender !== myAddress) continue;
        if (tx.paymentTransaction?.receiver !== agentAddress) continue;

        // Skip already-processed (including locally sent by this device)
        if (this.processedTxids.has(tx.id)) continue;

        const noteBytes = tx.note instanceof Uint8Array
          ? tx.note
          : base64ToBuffer(tx.note as unknown as string);

        if (!isPSKMessage(noteBytes)) continue;

        const txRound = Number(tx.confirmedRound ?? 0);
        if (txRound > maxRound) maxRound = txRound;

        try {
          const envelope = decodePSKEnvelope(noteBytes);

          // Derive PSK at this counter
          const currentPSK = derivePSKAtCounter(
            this.connection.psk,
            envelope.ratchetCounter
          );

          // Decrypt as sender (auto-detected by decryptPSKMessage since
          // our publicKey matches envelope.senderPublicKey)
          const decrypted = decryptPSKMessage(
            envelope,
            this.chatAccount.encryptionKeys.privateKey,
            this.chatAccount.encryptionKeys.publicKey,
            currentPSK
          );

          if (!decrypted) {
            this.trackProcessedTxid(tx.id);
            continue;
          }

          // Sync send counter — ensure we don't reuse a counter from another device
          const nextNeeded = envelope.ratchetCounter + 1;
          if (nextNeeded > this.pskState.sendCounter) {
            this.pskState.sendCounter = nextNeeded;
            counterSynced = true;
            console.info(
              `[cross-device] Synced sendCounter to ${nextNeeded} (saw counter ${envelope.ratchetCounter})`
            );
          }

          this.trackProcessedTxid(tx.id);

          // Parse device envelope from cross-device message
          const { deviceName, content: unwrappedContent, attachment: crossDeviceAttachment } = parseDeviceEnvelope(decrypted.text);

          // Emit as a sent message from another device
          const message: ChatMessage = {
            id: tx.id,
            content: unwrappedContent,
            direction: 'sent',
            timestamp: new Date(
              (tx.roundTime ?? Math.floor(Date.now() / 1000)) * 1000
            ),
            status: 'confirmed',
            txid: tx.id,
            deviceName,
            attachment: crossDeviceAttachment,
          };

          for (const cb of this.callbacks) {
            try {
              cb(message);
            } catch (err) {
              console.error('Message callback error:', err);
            }
          }
        } catch (err) {
          this.trackProcessedTxid(tx.id);
          console.error(`Error processing cross-device message ${tx.id}:`, err);
        }
      }
    } while (nextToken);

    if (maxRound > this.lastSentRound) {
      this.lastSentRound = maxRound;
      this.saveLastSentRound();
    }
    if (counterSynced) {
      this.savePSKState();
    }
  }

  // ── State persistence ──

  /** Compute a short fingerprint of the PSK for change detection. */
  private pskFingerprint(): string {
    if (!this.connection) return '';
    // First 8 bytes as hex — enough to detect PSK changes
    return Array.from(this.connection.psk.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private savePSKState(): void {
    if (!this.connection) return;
    const key = `${PSK_STATE_KEY}-${this.connection.address}`;
    const data = {
      pskFingerprint: this.pskFingerprint(),
      sendCounter: this.pskState.sendCounter,
      peerLastCounter: this.pskState.peerLastCounter,
      seenCounters: [...this.pskState.seenCounters],
    };
    localStorage.setItem(key, JSON.stringify(data));
  }

  private loadPSKState(): void {
    if (!this.connection) return;
    const key = `${PSK_STATE_KEY}-${this.connection.address}`;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);

      // If the PSK changed (new QR scanned) or state predates fingerprinting, discard stale state
      if (data.pskFingerprint !== this.pskFingerprint()) {
        console.info('PSK changed — resetting state for fresh connection');
        this.pskState = createPSKState();
        this.lastRound = 0;
        this.lastSentRound = 0;
        this.processedTxids.clear();
        // Clear stale persisted data
        localStorage.removeItem(key);
        localStorage.removeItem(`${LAST_ROUND_KEY}-${this.connection.address}`);
        localStorage.removeItem(`${SENT_LAST_ROUND_KEY}-${this.connection.address}`);
        localStorage.removeItem(`${PROCESSED_TXIDS_KEY}-${this.connection.address}`);
        return;
      }

      this.pskState = {
        sendCounter: data.sendCounter ?? 0,
        peerLastCounter: data.peerLastCounter ?? 0,
        seenCounters: new Set(data.seenCounters ?? []),
      };
    } catch {
      // Reset on parse error
      this.pskState = createPSKState();
    }
  }

  private saveLastRound(): void {
    if (!this.connection) return;
    const key = `${LAST_ROUND_KEY}-${this.connection.address}`;
    localStorage.setItem(key, String(this.lastRound));
  }

  private loadLastRound(): void {
    if (!this.connection) return;
    const key = `${LAST_ROUND_KEY}-${this.connection.address}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      this.lastRound = parseInt(raw, 10) || 0;
    }
  }

  private saveLastSentRound(): void {
    if (!this.connection) return;
    const key = `${SENT_LAST_ROUND_KEY}-${this.connection.address}`;
    localStorage.setItem(key, String(this.lastSentRound));
  }

  private loadLastSentRound(): void {
    if (!this.connection) return;
    const key = `${SENT_LAST_ROUND_KEY}-${this.connection.address}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      this.lastSentRound = parseInt(raw, 10) || 0;
    }
  }
}

// Singleton
export const messaging = new MessagingService();
