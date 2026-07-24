/**
 * Snapshot file format: a portable JSON envelope, optionally encrypted.
 *
 * An **empty password gives plain JSON** — readable, diffable, inspectable, and
 * the point of a local-first backup. A password wraps the same payload in
 * AES-GCM with a PBKDF2-derived key. Import tells the two apart from the file
 * itself, so the user never has to declare which kind they are opening.
 *
 * Only standard WebCrypto is used, so this stays testable in Node and works
 * unchanged in the MV3 service worker.
 */

/** Bumped only on a breaking change to the payload shape. */
export const SNAPSHOT_FORMAT = 1;

/** PBKDF2 cost. OWASP's 2023 floor for SHA-256 is 600k; this is deliberate. */
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface SnapshotMeta {
  /** Human-readable, so a file is identifiable without decrypting it. */
  projectName: string;
  exportedAt: string;
}

interface PlainEnvelope extends SnapshotMeta {
  format: number;
  encrypted: false;
  payload: unknown;
}

interface EncryptedEnvelope extends SnapshotMeta {
  format: number;
  encrypted: true;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  iv: string;
  ciphertext: string;
}

export type SnapshotEnvelope = PlainEnvelope | EncryptedEnvelope;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Serialise a payload to file text. An empty password means plain JSON. */
export async function sealSnapshot(
  payload: unknown,
  meta: SnapshotMeta,
  password = '',
): Promise<string> {
  if (!password) {
    const envelope: PlainEnvelope = { format: SNAPSHOT_FORMAT, encrypted: false, ...meta, payload };
    return JSON.stringify(envelope, null, 2);
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );

  const envelope: EncryptedEnvelope = {
    format: SNAPSHOT_FORMAT,
    encrypted: true,
    ...meta,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) },
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(envelope, null, 2);
}

function parseEnvelope(text: string): SnapshotEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not a snapshot (invalid JSON)');
  }
  const envelope = parsed as Partial<SnapshotEnvelope>;
  if (typeof envelope?.format !== 'number' || typeof envelope.encrypted !== 'boolean') {
    throw new Error('That file is not a snapshot');
  }
  if (envelope.format > SNAPSHOT_FORMAT) {
    throw new Error(
      `This snapshot was written by a newer version (format ${envelope.format}). Update the extension first.`,
    );
  }
  return envelope as SnapshotEnvelope;
}

/** True when the file needs a password — lets the UI ask before importing. */
export function isEncryptedSnapshot(text: string): boolean {
  return parseEnvelope(text).encrypted;
}

/** Read the meta of a file without decrypting it. */
export function snapshotMeta(text: string): SnapshotMeta {
  const envelope = parseEnvelope(text);
  return { projectName: envelope.projectName, exportedAt: envelope.exportedAt };
}

/** Parse file text back into its payload, decrypting when needed. */
export async function openSnapshot(text: string, password = ''): Promise<unknown> {
  const envelope = parseEnvelope(text);
  if (!envelope.encrypted) return envelope.payload;
  if (!password) throw new Error('This snapshot is encrypted — a password is needed');

  const key = await deriveKey(password, fromBase64(envelope.kdf.salt), envelope.kdf.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) as BufferSource },
      key,
      fromBase64(envelope.ciphertext) as BufferSource,
    );
  } catch {
    // AES-GCM authentication failing means the wrong key or a tampered file;
    // the two are indistinguishable by design.
    throw new Error('Wrong password, or the file has been altered');
  }
  return JSON.parse(new TextDecoder().decode(plaintext));
}
