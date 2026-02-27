/**
 * Unit tests for qr-scanner.ts
 * Covers parseManualURI, loadConnection, clearConnection, and network detection
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bufferToBase64 } from './utils.ts';
import { stubLocalStorage } from './test-utils.ts';

const { store } = stubLocalStorage();

/** Encode Uint8Array to base64url (no padding) — mirrors ts-algochat encoding */
function toBase64Url(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode base64url to Uint8Array */
function fromBase64Url(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Mock @corvidlabs/ts-algochat to avoid ESM resolution issues in test env
vi.mock('@corvidlabs/ts-algochat', () => ({
  parsePSKExchangeURI: (uri: string) => {
    if (!uri.startsWith('algochat-psk://v1?')) {
      throw new Error(`Invalid PSK exchange URI scheme: ${uri.split('?')[0]}`);
    }
    const queryString = uri.slice('algochat-psk://v1?'.length);
    const params = new URLSearchParams(queryString);
    const address = params.get('addr');
    if (!address) throw new Error('Missing addr parameter in PSK exchange URI');
    const pskParam = params.get('psk');
    if (!pskParam) throw new Error('Missing psk parameter in PSK exchange URI');
    const psk = fromBase64Url(pskParam);
    if (psk.length !== 32) throw new Error(`PSK must be 32 bytes, got ${psk.length}`);
    const label = params.get('label') ?? undefined;
    return { address, psk, label };
  },
}));

// Mock html5-qrcode (not used in unit tests but imported by qr-scanner.ts)
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: vi.fn(),
}));

// Import after mocks are set up
const { parseManualURI, loadConnection, clearConnection } = await import('./qr-scanner.ts');

// A valid 32-byte PSK for testing
const testPsk = new Uint8Array(32).fill(0xab);
// Fake but plausible Algorand address (58 chars)
const testAddress = 'TESTADDR234567TESTADDR234567TESTADDR234567TESTADDR234567TE';

/** Build a valid algochat-psk URI */
function buildURI(opts?: {
  address?: string;
  psk?: Uint8Array;
  label?: string;
  network?: string;
}): string {
  const addr = opts?.address ?? testAddress;
  const psk = opts?.psk ?? testPsk;
  const pskEncoded = toBase64Url(psk);
  let uri = `algochat-psk://v1?addr=${encodeURIComponent(addr)}&psk=${pskEncoded}`;
  if (opts?.label) {
    uri += `&label=${encodeURIComponent(opts.label)}`;
  }
  if (opts?.network) {
    uri += `&network=${opts.network}`;
  }
  return uri;
}

describe('parseManualURI', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('parses a valid PSK URI', () => {
    const uri = buildURI({ label: 'TestAgent' });
    const result = parseManualURI(uri);

    expect(result.success).toBe(true);
    expect(result.connection).toBeDefined();
    expect(result.connection!.address).toBe(testAddress);
    expect(result.connection!.label).toBe('TestAgent');
    expect(result.connection!.psk).toBeInstanceOf(Uint8Array);
    expect(result.connection!.psk.length).toBe(32);
    expect(result.connection!.addedAt).toBeGreaterThan(0);
  });

  it('saves connection to localStorage on success', () => {
    const uri = buildURI({ label: 'TestAgent' });
    parseManualURI(uri);

    const loaded = loadConnection();
    expect(loaded).not.toBeNull();
    expect(loaded!.address).toBe(testAddress);
    expect(loaded!.label).toBe('TestAgent');
  });

  it('trims whitespace from input', () => {
    const uri = buildURI();
    const result = parseManualURI(`  ${uri}  `);
    expect(result.success).toBe(true);
  });

  it('defaults network to mainnet when not specified', () => {
    const uri = buildURI();
    const result = parseManualURI(uri);

    expect(result.success).toBe(true);
    expect(result.connection!.network).toBe('mainnet');
  });

  it('detects testnet from network parameter', () => {
    const uri = buildURI({ network: 'testnet' });
    const result = parseManualURI(uri);

    expect(result.success).toBe(true);
    expect(result.connection!.network).toBe('testnet');
  });

  it('defaults unknown network values to mainnet', () => {
    const uri = buildURI({ network: 'betanet' });
    const result = parseManualURI(uri);

    expect(result.success).toBe(true);
    expect(result.connection!.network).toBe('mainnet');
  });

  it('generates label from address when none provided', () => {
    const uri = buildURI();
    const result = parseManualURI(uri);

    expect(result.success).toBe(true);
    expect(result.connection!.label).toContain('Agent');
    expect(result.connection!.label).toContain(testAddress.slice(0, 8));
  });

  it('rejects non-algochat URIs', () => {
    const result = parseManualURI('https://example.com');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Not a valid AlgoChat QR code');
  });

  it('rejects empty string', () => {
    const result = parseManualURI('');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects malformed PSK URI (missing addr)', () => {
    const result = parseManualURI('algochat-psk://v1?psk=AAAA');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects malformed PSK URI (missing psk)', () => {
    const result = parseManualURI('algochat-psk://v1?addr=TESTADDR');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('does not save connection on failure', () => {
    parseManualURI('not-a-valid-uri');

    const loaded = loadConnection();
    expect(loaded).toBeNull();
  });

  it('preserves PSK bytes through save/load round-trip', () => {
    const uri = buildURI({ psk: testPsk });
    parseManualURI(uri);

    const loaded = loadConnection();
    expect(loaded).not.toBeNull();
    expect(loaded!.psk).toEqual(testPsk);
  });
});

describe('loadConnection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no connection is saved', () => {
    expect(loadConnection()).toBeNull();
  });

  it('returns null on corrupted localStorage data', () => {
    localStorage.setItem('corvid-agent-connection', 'not-json!!!');
    expect(loadConnection()).toBeNull();
  });

  it('loads a previously saved connection', () => {
    // Save via parseManualURI
    const uri = buildURI({ label: 'MyAgent', network: 'testnet' });
    parseManualURI(uri);

    const loaded = loadConnection();
    expect(loaded).not.toBeNull();
    expect(loaded!.address).toBe(testAddress);
    expect(loaded!.label).toBe('MyAgent');
    expect(loaded!.network).toBe('testnet');
    expect(loaded!.psk).toBeInstanceOf(Uint8Array);
    expect(loaded!.psk.length).toBe(32);
  });

  it('deserializes PSK from base64 to Uint8Array', () => {
    // Manually craft localStorage to verify deserialization
    const data = {
      address: testAddress,
      psk: bufferToBase64(testPsk),
      label: 'Test',
      network: 'mainnet',
      addedAt: Date.now(),
    };
    localStorage.setItem('corvid-agent-connection', JSON.stringify(data));

    const loaded = loadConnection();
    expect(loaded).not.toBeNull();
    expect(loaded!.psk).toBeInstanceOf(Uint8Array);
    expect(loaded!.psk).toEqual(testPsk);
  });
});

describe('clearConnection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes saved connection', () => {
    const uri = buildURI();
    parseManualURI(uri);
    expect(loadConnection()).not.toBeNull();

    clearConnection();
    expect(loadConnection()).toBeNull();
  });

  it('does not throw if no connection exists', () => {
    expect(() => clearConnection()).not.toThrow();
  });
});

describe('connection serialization', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips random PSK bytes correctly', () => {
    // Use a PSK with values that stress base64 encoding
    const psk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) psk[i] = i * 8; // 0, 8, 16, ..., 248
    const uri = buildURI({ psk, label: 'RoundTrip' });
    parseManualURI(uri);

    const loaded = loadConnection();
    expect(loaded!.psk).toEqual(psk);
  });

  it('preserves addedAt timestamp', () => {
    const before = Date.now();
    const uri = buildURI();
    parseManualURI(uri);
    const after = Date.now();

    const loaded = loadConnection();
    expect(loaded!.addedAt).toBeGreaterThanOrEqual(before);
    expect(loaded!.addedAt).toBeLessThanOrEqual(after);
  });

  it('overwrites previous connection on re-scan', () => {
    const uri1 = buildURI({ label: 'Agent1' });
    parseManualURI(uri1);
    expect(loadConnection()!.label).toBe('Agent1');

    const uri2 = buildURI({ label: 'Agent2' });
    parseManualURI(uri2);
    expect(loadConnection()!.label).toBe('Agent2');
  });
});
