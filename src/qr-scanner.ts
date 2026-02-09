/**
 * QR Code scanner for PSK exchange
 * Wraps html5-qrcode for camera-based scanning
 */
import { Html5Qrcode } from 'html5-qrcode';
import { parsePSKExchangeURI } from '@corvidlabs/ts-algochat';
import type { AgentConnection } from './types.ts';
import { bufferToBase64, base64ToBuffer } from './utils.ts';

const AGENT_STORAGE_KEY = 'corvid-agent-connection';

export interface ScanResult {
  success: boolean;
  connection?: AgentConnection;
  error?: string;
}

let scanner: Html5Qrcode | null = null;

/**
 * Start QR scanning on the given element
 */
export async function startScanning(
  elementId: string,
  onResult: (result: ScanResult) => void
): Promise<void> {
  // Stop any existing scanner
  await stopScanning();

  scanner = new Html5Qrcode(elementId);

  try {
    await scanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1,
      },
      (decodedText: string) => {
        // Try to parse as AlgoChat PSK URI
        const result = parseScanResult(decodedText);
        if (result.success && result.connection) {
          // Save connection and stop scanning
          saveConnection(result.connection);
          stopScanning().catch(console.error);
        }
        onResult(result);
      },
      // Ignore scan failures (expected while searching)
      () => {}
    );
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : 'Camera access denied';
    onResult({ success: false, error: errorMsg });
  }
}

/**
 * Stop the QR scanner
 */
export async function stopScanning(): Promise<void> {
  if (scanner) {
    try {
      const state = scanner.getState();
      if (state === 2) {
        // SCANNING
        await scanner.stop();
      }
    } catch {
      // Ignore errors during cleanup
    }
    scanner = null;
  }
}

/**
 * Parse a scanned QR code result
 */
function parseScanResult(text: string): ScanResult {
  // Try AlgoChat PSK URI format
  if (text.startsWith('algochat-psk://')) {
    try {
      const parsed = parsePSKExchangeURI(text);

      // Detect network from URI params or default to mainnet
      const url = new URL(text.replace('algochat-psk://', 'https://'));
      const networkParam = url.searchParams.get('network');
      const network: 'mainnet' | 'testnet' =
        networkParam === 'testnet' ? 'testnet' : 'mainnet';

      const connection: AgentConnection = {
        address: parsed.address,
        psk: parsed.psk,
        label: parsed.label ?? `Agent ${parsed.address.slice(0, 8)}...`,
        network,
        addedAt: Date.now(),
      };

      return { success: true, connection };
    } catch (err) {
      return {
        success: false,
        error: `Invalid PSK URI: ${err instanceof Error ? err.message : 'parse error'}`,
      };
    }
  }

  return {
    success: false,
    error: 'Not a valid AlgoChat QR code',
  };
}

/**
 * Manually enter a PSK URI (for desktop users who can't scan)
 */
export function parseManualURI(uri: string): ScanResult {
  const result = parseScanResult(uri.trim());
  if (result.success && result.connection) {
    saveConnection(result.connection);
  }
  return result;
}

/**
 * Save agent connection to localStorage
 */
function saveConnection(connection: AgentConnection): void {
  // Serialize PSK as base64
  const data = {
    ...connection,
    psk: bufferToBase64(connection.psk),
  };
  localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify(data));
}

/**
 * Load saved agent connection from localStorage
 */
export function loadConnection(): AgentConnection | null {
  const raw = localStorage.getItem(AGENT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return {
      ...data,
      psk: base64ToBuffer(data.psk),
    };
  } catch {
    return null;
  }
}

/**
 * Clear saved agent connection
 */
export function clearConnection(): void {
  localStorage.removeItem(AGENT_STORAGE_KEY);
}
