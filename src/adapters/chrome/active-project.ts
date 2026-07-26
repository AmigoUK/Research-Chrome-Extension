/**
 * The one canonical "active project", shared by the side panel, the dashboard
 * and the injected annotator. Lives in chrome.storage.local (persistent, and
 * readable from a content script) so a web annotation always has an unambiguous
 * project to file into.
 */
const ACTIVE_PROJECT_KEY = 'activeProjectId';

export async function getActiveProjectId(): Promise<string | null> {
  try {
    const got = await chrome.storage.local.get(ACTIVE_PROJECT_KEY);
    const id = got[ACTIVE_PROJECT_KEY];
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

export async function setActiveProjectId(id: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [ACTIVE_PROJECT_KEY]: id });
  } catch {
    // Best-effort: a failed persist just falls back to the first project.
  }
}
