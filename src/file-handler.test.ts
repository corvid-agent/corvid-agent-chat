/**
 * Tests for file-handler module and device envelope attachment support
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isImageType,
  isAcceptedType,
  formatFileSize,
  base64ToArray,
  MAX_INLINE_BASE64,
  MAX_INLINE_BYTES,
} from './file-handler.ts';
import type { Attachment } from './types.ts';

describe('file-handler utilities', () => {
  test('isImageType recognizes image MIME types', () => {
    expect(isImageType('image/jpeg')).toBe(true);
    expect(isImageType('image/png')).toBe(true);
    expect(isImageType('image/gif')).toBe(true);
    expect(isImageType('image/webp')).toBe(true);
    expect(isImageType('text/plain')).toBe(false);
    expect(isImageType('application/json')).toBe(false);
  });

  test('isAcceptedType recognizes valid file types', () => {
    expect(isAcceptedType('image/jpeg')).toBe(true);
    expect(isAcceptedType('image/png')).toBe(true);
    expect(isAcceptedType('text/plain')).toBe(true);
    expect(isAcceptedType('text/csv')).toBe(true);
    expect(isAcceptedType('application/json')).toBe(true);
    expect(isAcceptedType('text/markdown')).toBe(true);
    expect(isAcceptedType('text/html')).toBe(true);
    expect(isAcceptedType('application/pdf')).toBe(false);
    expect(isAcceptedType('application/zip')).toBe(false);
  });

  test('formatFileSize formats correctly', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  test('base64ToArray round-trips correctly', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const b64 = btoa(String.fromCharCode(...original));
    const result = base64ToArray(b64);
    expect(result).toEqual(original);
  });

  test('MAX_INLINE constants are consistent', () => {
    // base64 expands by ~4/3, so MAX_INLINE_BYTES * 4/3 should be roughly MAX_INLINE_BASE64
    const expectedBase64 = Math.ceil((MAX_INLINE_BYTES * 4) / 3);
    expect(MAX_INLINE_BASE64).toBeGreaterThanOrEqual(expectedBase64 - 10);
    expect(MAX_INLINE_BASE64).toBeLessThanOrEqual(expectedBase64 + 10);
  });
});

describe('device envelope with attachments', () => {
  // Use a proper localStorage mock that works in all environments
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
      clear: vi.fn(() => { store = {}; }),
      get length() { return Object.keys(store).length; },
      key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Import dynamically after mocking to get fresh module state
  async function getDeviceNameModule() {
    // Clear module cache to get fresh imports with our mocked localStorage
    const mod = await import('./device-name.ts');
    return mod;
  }

  test('wrapWithDeviceName includes attachment in envelope', async () => {
    const { wrapWithDeviceName, setDeviceName } = await getDeviceNameModule();
    setDeviceName('testdev');

    const attachment: Attachment = {
      type: 'image',
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      size: 1234,
      base64: 'dGVzdA==',
    };

    const wrapped = wrapWithDeviceName('check this out', attachment);
    const parsed = JSON.parse(wrapped);

    expect(parsed.d).toBe('testdev');
    expect(parsed.m).toBe('check this out');
    expect(parsed.a).toBeDefined();
    expect(parsed.a.t).toBe('i'); // 'i' for image
    expect(parsed.a.mt).toBe('image/jpeg');
    expect(parsed.a.fn).toBe('photo.jpg');
    expect(parsed.a.sz).toBe(1234);
    expect(parsed.a.b).toBe('dGVzdA==');
  });

  test('parseDeviceEnvelope extracts attachment', async () => {
    const { parseDeviceEnvelope } = await getDeviceNameModule();

    const raw = JSON.stringify({
      d: 'mydevice',
      m: 'here is the file',
      a: {
        t: 'f',
        mt: 'text/plain',
        fn: 'notes.txt',
        sz: 42,
        b: 'aGVsbG8=',
      },
    });

    const result = parseDeviceEnvelope(raw);
    expect(result.deviceName).toBe('mydevice');
    expect(result.content).toBe('here is the file');
    expect(result.attachment).toBeDefined();
    expect(result.attachment!.type).toBe('file');
    expect(result.attachment!.mimeType).toBe('text/plain');
    expect(result.attachment!.fileName).toBe('notes.txt');
    expect(result.attachment!.size).toBe(42);
    expect(result.attachment!.base64).toBe('aGVsbG8=');
  });

  test('parseDeviceEnvelope handles missing attachment gracefully', async () => {
    const { parseDeviceEnvelope } = await getDeviceNameModule();

    const raw = JSON.stringify({ d: 'dev', m: 'plain message' });
    const result = parseDeviceEnvelope(raw);
    expect(result.content).toBe('plain message');
    expect(result.attachment).toBeUndefined();
  });

  test('parseDeviceEnvelope handles plain text without envelope', async () => {
    const { parseDeviceEnvelope } = await getDeviceNameModule();

    const result = parseDeviceEnvelope('just plain text');
    expect(result.content).toBe('just plain text');
    expect(result.deviceName).toBeUndefined();
    expect(result.attachment).toBeUndefined();
  });

  test('parseDeviceEnvelope handles IPFS hash field', async () => {
    const { parseDeviceEnvelope } = await getDeviceNameModule();

    const raw = JSON.stringify({
      m: 'large file',
      a: {
        t: 'i',
        mt: 'image/png',
        fn: 'large.png',
        sz: 500000,
        h: 'QmXoYpTzJm4bRGbz6gQrDmFNKXhLmNYGTuKnVLEpiZLSim',
      },
    });

    const result = parseDeviceEnvelope(raw);
    expect(result.attachment).toBeDefined();
    expect(result.attachment!.ipfsHash).toBe('QmXoYpTzJm4bRGbz6gQrDmFNKXhLmNYGTuKnVLEpiZLSim');
    expect(result.attachment!.base64).toBeUndefined();
  });

  test('wrapWithDeviceName without attachment or device name returns plain text', async () => {
    const { wrapWithDeviceName } = await getDeviceNameModule();

    // No device name set (store is empty)
    const wrapped = wrapWithDeviceName('hello');
    expect(wrapped).toBe('hello');
  });

  test('wrapWithDeviceName with attachment but no device name still wraps', async () => {
    const { wrapWithDeviceName } = await getDeviceNameModule();

    // No device name set
    const attachment: Attachment = {
      type: 'file',
      mimeType: 'text/plain',
      fileName: 'test.txt',
      size: 5,
      base64: 'dGVzdA==',
    };

    const wrapped = wrapWithDeviceName('see attached', attachment);
    const parsed = JSON.parse(wrapped);
    expect(parsed.m).toBe('see attached');
    expect(parsed.d).toBeUndefined();
    expect(parsed.a).toBeDefined();
    expect(parsed.a.t).toBe('f');
  });

  test('round-trip: wrap with attachment then parse', async () => {
    const { wrapWithDeviceName, setDeviceName, parseDeviceEnvelope } = await getDeviceNameModule();
    setDeviceName('myphone');

    const attachment: Attachment = {
      type: 'file',
      mimeType: 'application/json',
      fileName: 'config.json',
      size: 23,
      base64: 'eyJrZXkiOiJ2YWx1ZSJ9',
    };

    const wrapped = wrapWithDeviceName('config file', attachment);
    const parsed = parseDeviceEnvelope(wrapped);

    expect(parsed.deviceName).toBe('myphone');
    expect(parsed.content).toBe('config file');
    expect(parsed.attachment).toBeDefined();
    expect(parsed.attachment!.type).toBe('file');
    expect(parsed.attachment!.mimeType).toBe('application/json');
    expect(parsed.attachment!.fileName).toBe('config.json');
    expect(parsed.attachment!.size).toBe(23);
    expect(parsed.attachment!.base64).toBe('eyJrZXkiOiJ2YWx1ZSJ9');
  });
});
