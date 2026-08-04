/**
 * Persistence for the panel's getting-started checklist, in
 * `chrome.storage.local` beside the active-project id: two booleans the
 * domain has no reason to know about — whether the user closed the checklist,
 * and whether they have ever copied a citation (the one step no stored record
 * proves).
 */

const DISMISSED_KEY = 'gettingStartedDismissed';
const COPIED_KEY = 'hasCopiedCitation';

export interface OnboardingState {
  dismissed: boolean;
  copiedCitation: boolean;
}

export async function getOnboardingState(): Promise<OnboardingState> {
  try {
    const stored = await chrome.storage.local.get([DISMISSED_KEY, COPIED_KEY]);
    return {
      dismissed: stored[DISMISSED_KEY] === true,
      copiedCitation: stored[COPIED_KEY] === true,
    };
  } catch {
    // Storage briefly unavailable → show the checklist; worst case the user
    // sees it once more than intended.
    return { dismissed: false, copiedCitation: false };
  }
}

export async function dismissGettingStarted(): Promise<void> {
  try {
    await chrome.storage.local.set({ [DISMISSED_KEY]: true });
  } catch {
    // Non-fatal: it hides for this session either way.
  }
}

export async function markCitationCopied(): Promise<void> {
  try {
    await chrome.storage.local.set({ [COPIED_KEY]: true });
  } catch {
    // Non-fatal: the step re-checks on the next successful copy.
  }
}
