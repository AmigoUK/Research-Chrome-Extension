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

/** Inject the scanner into the active tab and return its primitives. */
export async function scanActiveTab(): Promise<RawPageScan> {
  const tabId = await getActiveTabId();
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: scanDocumentRaw,
  });
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
