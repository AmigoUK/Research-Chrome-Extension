/**
 * Capture glue for the side panel.
 *
 * Injects the self-contained page scanner into the active tab (needs only
 * `activeTab` + `scripting`, on a user gesture — no persistent host access),
 * then sends the built input to the service worker's capture use-case.
 */
import { scanDocumentRaw, buildCaptureInput, type RawPageScan } from './page-scan';
import { sendRequest } from './messaging';
import type { CaptureResult } from '../../core/usecases/capture';
import type { Id } from '../../core/model/types';

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) throw new Error('No active tab to capture');
  return tab.id;
}

/**
 * Chrome refused to inject into the tab. In the field this is the NORMAL
 * state, not an edge case: `activeTab` is granted for the one tab the user
 * invoked the extension on and dies on navigation — so with the panel left
 * open, every new page the user browses to is unscriptable until either a
 * fresh invocation or a standing host grant. Callers must tell the user the
 * truth ("no access yet") rather than "this page has no metadata".
 */
export class ScanAccessError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ScanAccessError';
  }
}

/** The optional standing grant that makes the preview work on every tab. */
export const ALL_SITES_ORIGIN = '*://*/*';

/** True when the user has granted standing access to read pages. */
export async function hasStandingPageAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [ALL_SITES_ORIGIN] });
  } catch {
    return false;
  }
}

/**
 * Ask for the standing grant. MUST be called from a user gesture. Returns
 * whether the user accepted.
 */
export async function requestStandingPageAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [ALL_SITES_ORIGIN] });
  } catch {
    return false;
  }
}

/** Inject the scanner into the active tab and return its primitives. */
export async function scanActiveTab(): Promise<RawPageScan> {
  const tabId = await getActiveTabId();
  let injection;
  try {
    [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scanDocumentRaw,
    });
  } catch (err) {
    throw new ScanAccessError(err);
  }
  const scan = injection?.result as RawPageScan | undefined;
  if (!scan) throw new Error('Page scan returned no result');
  return scan;
}

/** Scan the active tab and file it into the given project. */
export async function captureActiveTab(projectId: Id, section?: string): Promise<CaptureResult> {
  const scan = await scanActiveTab();
  const input = buildCaptureInput(scan, projectId, section);
  return sendRequest({ type: 'capture/page', input });
}
