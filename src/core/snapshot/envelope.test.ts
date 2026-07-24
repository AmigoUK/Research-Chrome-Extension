import { describe, it, expect, vi } from 'vitest';
import {
  SNAPSHOT_FORMAT,
  isEncryptedSnapshot,
  openSnapshot,
  sealSnapshot,
  snapshotMeta,
} from './envelope';

// These tests exercise the shipped KDF parameters — 600k PBKDF2 iterations are
// deliberately slow, and six derivations under a loaded parallel run go past
// the 5s default. Weakening the parameters for the test would test nothing.
vi.setConfig({ testTimeout: 30_000 });

const META = { projectName: 'Urban Heat', exportedAt: '2026-07-24T12:00:00.000Z' };
const PAYLOAD = {
  project: { id: 'p1', name: 'Urban Heat' },
  documents: [{ id: 'd1', url: 'https://example.org/d1' }],
};

describe('plain snapshots', () => {
  it('writes readable JSON when there is no password', async () => {
    const text = await sealSnapshot(PAYLOAD, META);
    const parsed = JSON.parse(text) as Record<string, unknown>;

    expect(parsed['format']).toBe(SNAPSHOT_FORMAT);
    expect(parsed['encrypted']).toBe(false);
    expect(parsed['payload']).toEqual(PAYLOAD);
    // The point of a plain snapshot is that a human can read it.
    expect(text).toContain('Urban Heat');
    expect(await openSnapshot(text)).toEqual(PAYLOAD);
  });
});

describe('encrypted snapshots', () => {
  it('round-trips with the right password and hides the payload', async () => {
    const text = await sealSnapshot(PAYLOAD, META, 'correct horse');

    expect(isEncryptedSnapshot(text)).toBe(true);
    // A payload string that cannot occur in base64 — it has dots and a slash.
    // A two-character id like `d1` turns up in random ciphertext often enough
    // to fail about one run in three, which is how CI caught this.
    expect(text).not.toContain('example.org');
    expect(JSON.parse(text)).not.toHaveProperty('payload');
    expect(await openSnapshot(text, 'correct horse')).toEqual(PAYLOAD);
  });

  it('keeps the meta readable without the password, so a file is identifiable', async () => {
    const text = await sealSnapshot(PAYLOAD, META, 'pw');
    expect(snapshotMeta(text)).toEqual(META);
  });

  it('refuses the wrong password, and refuses to guess when none is given', async () => {
    const text = await sealSnapshot(PAYLOAD, META, 'right');

    await expect(openSnapshot(text, 'wrong')).rejects.toThrow(/Wrong password/);
    await expect(openSnapshot(text)).rejects.toThrow(/password is needed/);
  });

  it('detects tampering — AES-GCM authenticates the ciphertext', async () => {
    const envelope = JSON.parse(await sealSnapshot(PAYLOAD, META, 'pw')) as {
      ciphertext: string;
    };
    // Flip one base64 character of the ciphertext.
    const flipped = envelope.ciphertext.startsWith('A')
      ? `B${envelope.ciphertext.slice(1)}`
      : `A${envelope.ciphertext.slice(1)}`;
    const text = JSON.stringify({ ...envelope, ciphertext: flipped });

    await expect(openSnapshot(text, 'pw')).rejects.toThrow(/Wrong password, or the file/);
  });

  it('uses a fresh salt and IV each time, so two exports never match', async () => {
    const a = await sealSnapshot(PAYLOAD, META, 'pw');
    const b = await sealSnapshot(PAYLOAD, META, 'pw');
    expect(a).not.toEqual(b);
  });
});

describe('rejecting files that are not snapshots', () => {
  it('rejects non-JSON and JSON that is not an envelope', async () => {
    await expect(openSnapshot('not json')).rejects.toThrow(/not a snapshot \(invalid JSON\)/);
    await expect(openSnapshot('{"hello":"world"}')).rejects.toThrow(/not a snapshot/);
  });

  it('refuses a newer format rather than mangling it', async () => {
    const text = JSON.stringify({ ...META, format: SNAPSHOT_FORMAT + 1, encrypted: false });
    await expect(openSnapshot(text)).rejects.toThrow(/newer version \(format 2\)/);
  });
});
