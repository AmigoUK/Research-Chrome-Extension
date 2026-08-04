/**
 * "What's new" plumbing. The Chrome Web Store updates extensions silently —
 * without this, a user never learns they have a new, better version. The
 * service worker records the update (storage flag + a NEW badge on the
 * toolbar icon); the side panel shows a one-line banner until dismissed.
 */

const KEY = 'whatsNewVersion';

/** Called by the service worker on `onInstalled` with reason 'update'. */
export async function recordUpdate(version: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: version });
    await chrome.action.setBadgeText({ text: 'NEW' });
    await chrome.action.setBadgeBackgroundColor({ color: '#9a4433' });
  } catch {
    // Cosmetic — a failed badge must never break the update itself.
  }
}

/** The version to announce, or undefined when there is nothing pending. */
export async function getUpdateNotice(): Promise<string | undefined> {
  try {
    const stored = await chrome.storage.local.get(KEY);
    const version = stored[KEY];
    return typeof version === 'string' && version ? version : undefined;
  } catch {
    return undefined;
  }
}

/** User saw it: clear the flag and take the badge off the icon. */
export async function dismissUpdateNotice(): Promise<void> {
  try {
    await chrome.storage.local.remove(KEY);
    await chrome.action.setBadgeText({ text: '' });
  } catch {
    // Cosmetic; the banner is hidden for this session either way.
  }
}
