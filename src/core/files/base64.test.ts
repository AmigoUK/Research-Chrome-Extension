import { describe, it, expect } from 'vitest';
import { bytesToBase64, base64ToBytes } from './base64';

describe('base64 round-trip', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 37, 128, 200, 255, 254, 100]).buffer;
    const b64 = bytesToBase64(bytes);
    const back = new Uint8Array(base64ToBytes(b64));
    expect([...back]).toEqual([0, 1, 2, 37, 128, 200, 255, 254, 100]);
  });

  it('encodes a known %PDF header', () => {
    // "%PDF-1.7" — the magic bytes a PDF starts with.
    const bytes = new TextEncoder().encode('%PDF-1.7').buffer;
    const b64 = bytesToBase64(bytes);
    expect(b64).toBe('JVBERi0xLjc=');
    const back = new TextDecoder().decode(base64ToBytes(b64));
    expect(back).toBe('%PDF-1.7');
  });

  it('handles empty input', () => {
    expect(bytesToBase64(new ArrayBuffer(0))).toBe('');
    expect(base64ToBytes('').byteLength).toBe(0);
  });
});
