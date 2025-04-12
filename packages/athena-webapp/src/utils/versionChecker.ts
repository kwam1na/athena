// This service will check for new versions of the app by detecting changes in bundled assets

// Store the scripts that were loaded when the app started
const initialScripts = Array.from(document.querySelectorAll("script"))
  .filter(
    (script) =>
      script.src &&
      (script.src.includes("/assets/") || script.src.includes("index"))
  )
  .map((script) => script.src);

/**
 * Creates a version checker that detects when the app has been updated by checking
 * if the HTML entry point references different script files than when the app was loaded.
 */
export function createVersionChecker({
  pollingIntervalMs = 5 * 60 * 1000, // 5 minutes
  onNewVersionAvailable,
}: {
  pollingIntervalMs?: number;
  onNewVersionAvailable: () => void;
}) {
  // Function to check for a new version
  async function checkForNewVersion() {
    try {
      // Fetch the HTML entry point with cache busting
      const response = await fetch(`/?_=${Date.now()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch HTML: ${response.status}`);
      }

      const html = await response.text();

      // Create a DOM parser to extract scripts from the fetched HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // Extract script sources from the fetched HTML
      const newScripts = Array.from(doc.querySelectorAll("script"))
        .filter(
          (script) =>
            script.src &&
            (script.src.includes("/assets/") || script.src.includes("index"))
        )
        .map((script) => script.src);

      // Check if any of the script sources have changed
      const hasNewVersion = initialScripts.some((oldSrc) => {
        // Extract the base path without query params
        const oldPath = new URL(oldSrc).pathname;
        // Check if this path is missing from new scripts or has been changed
        return !newScripts.some(
          (newSrc) => new URL(newSrc).pathname === oldPath
        );
      });

      if (hasNewVersion) {
        console.log("New version detected - script references have changed");
        onNewVersionAvailable();
      }
    } catch (error) {
      console.error("Failed to check for new version:", error);
    }
  }

  // Start polling for new versions
  const intervalId = setInterval(checkForNewVersion, pollingIntervalMs);

  // Also check immediately on startup (after a short delay)
  setTimeout(checkForNewVersion, 10000);

  // Provide a way to stop checking
  return {
    stop: () => clearInterval(intervalId),
  };
}
