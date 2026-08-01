// Keyboard shortcut flips the shared setting; content scripts react via storage.
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-redaction") return;
  chrome.storage.sync.get({ enabled: false }, ({ enabled }) => {
    chrome.storage.sync.set({ enabled: !enabled });
  });
});
