/**
 * Onboarding guide wiring: two buttons. The page itself is static — the
 * tutorial that *reacts* to what the user has actually done lives in the side
 * panel's getting-started checklist.
 */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('openPanel')?.addEventListener('click', () => {
    // sidePanel.open needs a user gesture and a tab — this click on this tab
    // is both. If the API refuses (very old Chrome), the pinned-icon
    // instructions in the lede remain the fallback.
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id != null) await chrome.sidePanel.open({ tabId: tab.id });
      } catch {
        // The lede's toolbar-icon instructions still apply.
      }
    })();
  });
  document.getElementById('openDashboard')?.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
  document.getElementById('openSiteAccess')?.addEventListener('click', () => {
    void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  });
  document.getElementById('closeGuide')?.addEventListener('click', () => {
    window.close();
  });
});
