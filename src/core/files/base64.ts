/**
 * Base64 ⇄ bytes helpers. File bytes (PDFs) cross the UI↔service-worker boundary
 * as base64 because `chrome.runtime.sendMessage` is JSON-serialised and cannot
 * carry `ArrayBuffer`/`Blob`. IndexedDB itself stores the decoded `ArrayBuffer`.
 *
 * Pure — relies only on the platform `btoa`/`atob` (available in the service
 * worker, extension pages, and the Node/jsdom test env).
 */
export function bytesToBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000; // avoid arg-count limits on String.fromCharCode
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) u8[i] = binary.charCodeAt(i);
  return u8.buffer;
}
