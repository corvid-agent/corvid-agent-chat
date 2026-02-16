import { describe, it, expect } from 'vitest';
import { escapeHtml, bufferToBase64, base64ToBuffer, shortenAddress, formatTime } from './utils.ts';

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });
});

describe('bufferToBase64 / base64ToBuffer', () => {
  it('round-trips simple data', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const b64 = bufferToBase64(original);
    const restored = base64ToBuffer(b64);
    expect(restored).toEqual(original);
  });

  it('round-trips empty array', () => {
    const original = new Uint8Array([]);
    const b64 = bufferToBase64(original);
    const restored = base64ToBuffer(b64);
    expect(restored).toEqual(original);
  });

  it('round-trips binary data (0-255)', () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    const b64 = bufferToBase64(original);
    const restored = base64ToBuffer(b64);
    expect(restored).toEqual(original);
  });

  it('produces valid base64', () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const b64 = bufferToBase64(data);
    expect(b64).toBe(btoa('Hello'));
  });
});

describe('shortenAddress', () => {
  const addr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ2345';

  it('shortens with default params', () => {
    const result = shortenAddress(addr);
    expect(result).toBe('ABCDEF...2345');
    expect(result.length).toBeLessThan(addr.length);
  });

  it('shortens with custom prefix/suffix', () => {
    const result = shortenAddress(addr, 4, 6);
    expect(result).toBe('ABCD...YZ2345');
  });

  it('returns full address if short enough', () => {
    const short = 'ABCDE';
    expect(shortenAddress(short, 3, 3)).toBe('ABCDE');
  });
});

describe('formatTime', () => {
  it('formats morning time', () => {
    const d = new Date(2026, 0, 15, 9, 5);
    expect(formatTime(d)).toBe('09:05');
  });

  it('formats afternoon time', () => {
    const d = new Date(2026, 0, 15, 14, 30);
    expect(formatTime(d)).toBe('14:30');
  });

  it('formats midnight', () => {
    const d = new Date(2026, 0, 15, 0, 0);
    expect(formatTime(d)).toBe('00:00');
  });
});
