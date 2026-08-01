const KEYS = { enabled: false, aggressive: false, blurMedia: false };

chrome.storage.sync.get(KEYS, (stored) => {
  for (const key of Object.keys(KEYS)) {
    const input = document.getElementById(key);
    input.checked = Boolean(stored[key]);
    input.addEventListener("change", () => {
      chrome.storage.sync.set({ [key]: input.checked });
    });
  }
});
