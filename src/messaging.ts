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
import type { AgentConnection, ChatMessage } from './types.ts';
import { base64ToBuffer } from './utils.ts';

const PSK_STATE_KEY = 'corvid-psk-state';
const LAST_ROUND_KEY = 'corvid-last-round';
const POLL_INTERVAL = 10_000; // 10 seconds
const MAX_PROCESSED_TXIDS = 500;

type MessageCallback = (message: ChatMessage) => void;

// Indexer response types (subset)
interface IndexerTransaction {
  id: string;
  sender: string;
  'tx-type': string;
  note?: string;
  'confirmed-round'?: number;
  'round-time'?: number;
  'payment-transaction'?: {
    receiver: string;
    amount: number;
  };
}

interface IndexerSearchResponse {
  transactions: IndexerTransaction[];
  'next-token'?: string;
}

export class MessagingService {
  private algodClient: algosdk.Algodv2 | null = null;
  private indexerClient: algosdk.Indexer | null = null;
  private algorandService: AlgorandService | null = null;
  private chatAccount: ChatAccount | null = null;
  private connection: AgentConnection | null = null;
  private pskState: PSKState = createPSKState();
  private lastRound = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: Set<MessageCallback> = new Set();
  private processedTxids: Set<string> = new Set();
  private agentEncryptionKey: Uint8Array | null = null;
  private _polling = false;

  get isPolling(): boolean {
    return this._polling;
  }

  /**
   * Initialize the service with a wallet and agent connection
   */
  initialize(account: ChatAccount, connection: AgentConnection): void {
    this.chatAccount = account;
    this.connection = connection;

    const networkConfig =
      connection.network === 'mainnet' ? mainnet() : testnet();

    this.algodClient = new algosdk.Algodv2(
      networkConfig.algodToken,
      networkConfig.algodUrl
    );
    this.indexerClient = new algosdk.Indexer(
      networkConfig.indexerToken ?? '',
      networkConfig.indexerUrl ?? ''
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
  }

  /**
   * Subscribe to incoming messages
   */
  onMessage(callback: MessageCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Start polling for incoming messages
   */
  startPolling(): void {
    if (this.pollTimer) return;
    this._polling = true;
    // Do an immediate poll then set interval
    this.poll().catch(console.error);
    this.pollTimer = setInterval(() => {
      this.poll().catch(console.error);
    }, POLL_INTERVAL);
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this._polling = false;
    this.savePSKState();
  }

  /**
   * Send a message to the connected agent
   */
  async sendMessage(content: string): Promise<string> {
    if (!this.chatAccount || !this.connection || !this.algodClient) {
      throw new Error('Service not initialized');
    }

    // Advance send counter
    const { counter, state: newState } = advanceSendCounter(this.pskState);
    this.pskState = newState;

    // Derive PSK at current counter
    const currentPSK = derivePSKAtCounter(this.connection.psk, counter);

    // Get recipient's encryption key
    const recipientPubKey = await this.getAgentPublicKey();

    // Encrypt
    const envelope = encryptPSKMessage(
      content,
      this.chatAccount.encryptionKeys.publicKey,
      recipientPubKey,
      currentPSK,
      counter
    );

    // Encode to bytes
    const note = encodePSKEnvelope(envelope);

    // Build, sign, and submit transaction
    const params = await this.algodClient.getTransactionParams().do();
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.chatAccount.address,
      receiver: this.connection.address,
      amount: 1000, // 0.001 ALGO minimum
      note,
      suggestedParams: params,
    });

    const signedTxn = txn.signTxn(this.chatAccount.account.sk);
    const { txid } = await this.algodClient
      .sendRawTransaction(signedTxn)
      .do();

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
        nextToken = response['next-token'];

        for (const tx of txns) {
          // Only payment transactions with notes, sent to us
          if (tx['tx-type'] !== 'pay' || !tx.note) continue;
          if (tx.sender !== agentAddress) continue;
          if (tx['payment-transaction']?.receiver !== myAddress) continue;

          // Deduplication
          if (this.processedTxids.has(tx.id)) continue;

          const noteBytes = base64ToBuffer(tx.note);

          // Check PSK protocol
          if (!isPSKMessage(noteBytes)) continue;

          try {
            const envelope = decodePSKEnvelope(noteBytes);

            // Validate counter
            if (
              !validateCounter(this.pskState, envelope.ratchetCounter)
            ) {
              console.warn(
                `Rejected message with counter ${envelope.ratchetCounter}`
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

            if (!decrypted) continue;

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

            // Create message
            const message: ChatMessage = {
              id: tx.id,
              content: decrypted.text,
              direction: 'received',
              timestamp: new Date(
                (tx['round-time'] ?? Math.floor(Date.now() / 1000)) * 1000
              ),
              status: 'confirmed',
              txid: tx.id,
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

          const txRound = Number(tx['confirmed-round'] ?? 0);
          if (txRound > maxRound) {
            maxRound = txRound;
          }
        }
      } catch (err) {
        console.error('Poll error:', err);
        nextToken = undefined; // Stop pagination on error
      }
    } while (nextToken);

    if (maxRound > this.lastRound) {
      this.lastRound = maxRound;
      this.saveLastRound();
      this.savePSKState();
    }
  }

  private trackProcessedTxid(txid: string): void {
    this.processedTxids.add(txid);
    if (this.processedTxids.size > MAX_PROCESSED_TXIDS) {
      const iter = this.processedTxids.values();
      for (let i = 0; i < 100; i++) {
        const val = iter.next().value;
        if (val) this.processedTxids.delete(val);
      }
    }
  }

  // ── State persistence ──

  private savePSKState(): void {
    if (!this.connection) return;
    const key = `${PSK_STATE_KEY}-${this.connection.address}`;
    const data = {
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
}

// Singleton
export const messaging = new MessagingService();
