/**
 * Tests for device name persistence and message envelope handling.
 * Covers: name validation, envelope wrapping/parsing, error paths, edge cases.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { stubLocalStorage } from './test-utils.ts';
import type { Attachment } from './types.ts';

// Stub localStorage before imports
const ls = stubLocalStorage();

import {
  getDeviceName,
  setDeviceName,
  wrapWithDeviceName,
  parseDeviceEnvelope,
} from './device-name.ts';

beforeEach(() => {
  ls.store.clear();
});

// ── getDeviceName ──

describe('getDeviceName', () => {
  it('returns null when no device name is stored', () => {
    expect(getDeviceName()).toBeNull();
  });

  it('returns the stored device name', () => {
    ls.store.set('corvid-device-name', 'myphone');
    expect(getDeviceName()).toBe('myphone');
  });
});

// ── setDeviceName ──

describe('setDeviceName', () => {
  it('stores a valid alphanumeric name', () => {
    expect(setDeviceName('laptop01')).toBe(true);
    expect(ls.store.get('corvid-device-name')).toBe('laptop01');
  });

  it('accepts hyphens and underscores', () => {
    expect(setDeviceName('my-phone_2')).toBe(true);
    expect(ls.store.get('corvid-device-name')).toBe('my-phone_2');
  });

  it('accepts single character name', () => {
    expect(setDeviceName('X')).toBe(true);
    expect(ls.store.get('corvid-device-name')).toBe('X');
  });

  it('accepts max length name (16 chars)', () => {
    const name = 'a'.repeat(16);
    expect(setDeviceName(name)).toBe(true);
    expect(ls.store.get('corvid-device-name')).toBe(name);
  });

  it('rejects name exceeding 16 characters', () => {
    expect(setDeviceName('a'.repeat(17))).toBe(false);
    expect(ls.store.has('corvid-device-name')).toBe(false);
  });

  it('rejects name with spaces', () => {
    expect(setDeviceName('my phone')).toBe(false);
  });

  it('rejects name with special characters', () => {
    expect(setDeviceName('phone@home')).toBe(false);
    expect(setDeviceName('dev!ce')).toBe(false);
    expect(setDeviceName('name.dot')).toBe(false);
  });

  it('rejects name with unicode characters', () => {
    expect(setDeviceName('\u00FCmlaut')).toBe(false);
    expect(setDeviceName('\u{1F4F1}phone')).toBe(false);
  });

  it('clears the stored name when given an empty string', () => {
    ls.store.set('corvid-device-name', 'old-name');
    expect(setDeviceName('')).toBe(true);
    expect(ls.store.has('corvid-device-name')).toBe(false);
  });

  it('clears the stored name when given whitespace-only string', () => {
    ls.store.set('corvid-device-name', 'old-name');
    expect(setDeviceName('   ')).toBe(true);
    expect(ls.store.has('corvid-device-name')).toBe(false);
  });

  it('trims whitespace before validation', () => {
    expect(setDeviceName('  laptop  ')).toBe(true);
    expect(ls.store.get('corvid-device-name')).toBe('laptop');
  });
});

// ── wrapWithDeviceName ──

describe('wrapWithDeviceName', () => {
  it('returns plain content when no device name and no attachment', () => {
    const result = wrapWithDeviceName('hello world');
    expect(result).toBe('hello world');
  });

  it('wraps content with device name in JSON envelope', () => {
    setDeviceName('phone');
    const result = wrapWithDeviceName('hello');
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ m: 'hello', d: 'phone' });
  });

  it('wraps content with attachment when no device name', () => {
    const attachment: Attachment = {
      type: 'image',
      mimeType: 'image/png',
      fileName: 'photo.png',
      size: 1024,
      base64: 'aGVsbG8=',
    };
    const result = wrapWithDeviceName('check this', attachment);
    const parsed = JSON.parse(result);
    expect(parsed.m).toBe('check this');
    expect(parsed.d).toBeUndefined();
    expect(parsed.a).toEqual({
      t: 'i',
      mt: 'image/png',
      fn: 'photo.png',
      sz: 1024,
      b: 'aGVsbG8=',
    });
  });

  it('wraps content with both device name and attachment', () => {
    setDeviceName('laptop');
    const attachment: Attachment = {
      type: 'file',
      mimeType: 'application/pdf',
      fileName: 'doc.pdf',
      size: 5000,
      ipfsHash: 'QmTest123',
    };
    const result = wrapWithDeviceName('see attached', attachment);
    const parsed = JSON.parse(result);
    expect(parsed.m).toBe('see attached');
    expect(parsed.d).toBe('laptop');
    expect(parsed.a).toEqual({
      t: 'f',
      mt: 'application/pdf',
      fn: 'doc.pdf',
      sz: 5000,
      h: 'QmTest123',
    });
  });

  it('handles empty content string with device name', () => {
    setDeviceName('dev');
    const result = wrapWithDeviceName('');
    const parsed = JSON.parse(result);
    expect(parsed.m).toBe('');
    expect(parsed.d).toBe('dev');
  });

  it('handles content containing JSON-like strings', () => {
    setDeviceName('dev');
    const result = wrapWithDeviceName('{"key": "value"}');
    const parsed = JSON.parse(result);
    expect(parsed.m).toBe('{"key": "value"}');
  });
});

// ── parseDeviceEnvelope ──

describe('parseDeviceEnvelope', () => {
  it('parses a valid envelope with device name and content', () => {
    const envelope = JSON.stringify({ m: 'hello', d: 'phone' });
    const result = parseDeviceEnvelope(envelope);
    expect(result).toEqual({
      deviceName: 'phone',
      content: 'hello',
    });
  });

  it('parses an envelope without device name', () => {
    const envelope = JSON.stringify({ m: 'hello' });
    const result = parseDeviceEnvelope(envelope);
    expect(result.content).toBe('hello');
    expect(result.deviceName).toBeUndefined();
  });

  it('parses an envelope with image attachment', () => {
    const envelope = JSON.stringify({
      m: 'photo',
      d: 'cam',
      a: { t: 'i', mt: 'image/jpeg', fn: 'pic.jpg', sz: 2048, b: 'data==' },
    });
    const result = parseDeviceEnvelope(envelope);
    expect(result.content).toBe('photo');
    expect(result.deviceName).toBe('cam');
    expect(result.attachment).toEqual({
      type: 'image',
      mimeType: 'image/jpeg',
      fileName: 'pic.jpg',
      size: 2048,
      base64: 'data==',
    });
  });

  it('parses an envelope with file attachment via IPFS hash', () => {
    const envelope = JSON.stringify({
      m: 'doc',
      a: { t: 'f', mt: 'application/pdf', fn: 'report.pdf', sz: 9999, h: 'QmABC' },
    });
    const result = parseDeviceEnvelope(envelope);
    expect(result.attachment).toEqual({
      type: 'file',
      mimeType: 'application/pdf',
      fileName: 'report.pdf',
      size: 9999,
      ipfsHash: 'QmABC',
    });
  });

  it('falls back to plain text for non-JSON content', () => {
    const result = parseDeviceEnvelope('just a plain message');
    expect(result).toEqual({ content: 'just a plain message' });
  });

  it('falls back to plain text for malformed JSON starting with {', () => {
    const result = parseDeviceEnvelope('{this is not valid json!!!');
    expect(result).toEqual({ content: '{this is not valid json!!!' });
  });

  it('falls back to plain text for JSON without m field', () => {
    const result = parseDeviceEnvelope(JSON.stringify({ d: 'phone', x: 'data' }));
    expect(result).toEqual({
      content: JSON.stringify({ d: 'phone', x: 'data' }),
    });
  });

  it('falls back to plain text when m field is not a string', () => {
    const result = parseDeviceEnvelope(JSON.stringify({ m: 42 }));
    expect(result).toEqual({ content: JSON.stringify({ m: 42 }) });
  });

  it('ignores non-string d field', () => {
    const envelope = JSON.stringify({ m: 'hi', d: 123 });
    const result = parseDeviceEnvelope(envelope);
    expect(result.content).toBe('hi');
    expect(result.deviceName).toBeUndefined();
  });

  it('ignores incomplete attachment (missing required fields)', () => {
    const envelope = JSON.stringify({ m: 'test', a: { t: 'i' } });
    const result = parseDeviceEnvelope(envelope);
    expect(result.content).toBe('test');
    expect(result.attachment).toBeUndefined();
  });

  it('handles empty string content', () => {
    const result = parseDeviceEnvelope('');
    expect(result).toEqual({ content: '' });
  });

  it('round-trips: wrap then parse preserves content and device name', () => {
    setDeviceName('tablet');
    const original = 'round-trip test message';
    const wrapped = wrapWithDeviceName(original);
    const parsed = parseDeviceEnvelope(wrapped);
    expect(parsed.content).toBe(original);
    expect(parsed.deviceName).toBe('tablet');
  });

  it('round-trips: wrap then parse preserves attachment', () => {
    setDeviceName('phone');
    const attachment: Attachment = {
      type: 'image',
      mimeType: 'image/webp',
      fileName: 'screenshot.webp',
      size: 3333,
      base64: 'c2NyZWVu',
    };
    const wrapped = wrapWithDeviceName('look at this', attachment);
    const parsed = parseDeviceEnvelope(wrapped);
    expect(parsed.content).toBe('look at this');
    expect(parsed.deviceName).toBe('phone');
    expect(parsed.attachment).toEqual(attachment);
  });

  it('handles JSON array starting with { bracket in content gracefully', () => {
    // Edge case: content is a valid JSON but not an envelope
    const result = parseDeviceEnvelope('{"name":"Alice","age":30}');
    // Has no 'm' field, so falls back to plain text
    expect(result).toEqual({ content: '{"name":"Alice","age":30}' });
  });
});
