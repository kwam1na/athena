const KEYS = {
  enabled: false,
  aggressive: false,
  blurMedia: false,
  hideDemoChrome: false,
};
const TEXT_KEYS = { extraHideSelectors: "" };

chrome.storage.sync.get({ ...KEYS, ...TEXT_KEYS }, (stored) => {
  for (const key of Object.keys(KEYS)) {
    const input = document.getElementById(key);
    input.checked = Boolean(stored[key]);
    input.addEventListener("change", () => {
      chrome.storage.sync.set({ [key]: input.checked });
    });
  }
  for (const key of Object.keys(TEXT_KEYS)) {
    const input = document.getElementById(key);
    input.value = stored[key] ?? "";
    // On change, not input — sync storage has a per-minute write quota.
    input.addEventListener("change", () => {
      chrome.storage.sync.set({ [key]: input.value });
    });
  }
});
