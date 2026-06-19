// Detects new deployed webapp builds and reports them to the app-update coordinator.

import {
  getInitialRuntimeBuildMetadata,
  normalizeDeployMetadata,
} from "@/lib/runtimeBuildMetadata";

export type VersionCheckerDetectionSource = "deploy-metadata" | "html";

export type VersionCheckerUpdateDetectedEvent = {
  currentBuildId?: string;
  pendingBuildId: string;
  detectionSource: VersionCheckerDetectionSource;
  staging?: {
    entryHtml?: string;
    entryUrl?: string;
  };
};

type VersionCheckerFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type EntryHtmlScripts = {
  entryUrl: string;
  html: string;
  scripts: string[];
};

const initialScripts = readDocumentScriptSources();
const initialHtmlBuildId = buildIdFromScripts(initialScripts);

export function createVersionChecker({
  currentBuildId,
  currentDeployBuildId,
  pollingIntervalMs = 1 * 60 * 1000,
  fetchImpl = fetch,
  onUpdateDetected,
  onDetectorFailed,
  shouldReportDuplicateUpdate,
}: {
  currentBuildId?: string;
  currentDeployBuildId?: string;
  pollingIntervalMs?: number;
  fetchImpl?: VersionCheckerFetch;
  onUpdateDetected: (event: VersionCheckerUpdateDetectedEvent) => void;
  onDetectorFailed?: (error: Error) => void;
  onApplyUpdate?: () => void;
  shouldReportDuplicateUpdate?: (
    event: VersionCheckerUpdateDetectedEvent,
  ) => boolean;
}) {
  const initialDeployBuildId =
    currentDeployBuildId ?? getInitialDeployBuildId();
  const loadedBuildId = currentBuildId ?? initialDeployBuildId ?? initialHtmlBuildId;
  let observedDeployBuildId = initialDeployBuildId;
  let lastReportedBuildId: string | undefined;

  async function checkForNewVersion() {
    try {
      const deployBuildId = await readDeployBuildId(fetchImpl);
      let entryHtmlScripts: EntryHtmlScripts | null = null;
      if (deployBuildId && observedDeployBuildId === undefined) {
        observedDeployBuildId = deployBuildId;
      } else if (
        deployBuildId &&
        observedDeployBuildId &&
        deployBuildId !== observedDeployBuildId
      ) {
        entryHtmlScripts = await readEntryHtmlScripts(fetchImpl);
        reportOnce({
          currentBuildId: observedDeployBuildId,
          pendingBuildId: deployBuildId,
          detectionSource: "deploy-metadata",
          staging: {
            entryHtml: entryHtmlScripts.html,
            entryUrl: entryHtmlScripts.entryUrl,
          },
        });
        return;
      }

      if (deployBuildId && !currentDeployBuildId) {
        entryHtmlScripts = await readEntryHtmlScripts(fetchImpl);
      }

      const { entryUrl, html, scripts } =
        entryHtmlScripts ?? (await readEntryHtmlScripts(fetchImpl));
      const htmlBuildId = buildIdFromScripts(scripts);
      if (htmlBuildId && htmlBuildId !== initialHtmlBuildId) {
        reportOnce({
          currentBuildId: loadedBuildId,
          pendingBuildId: htmlBuildId,
          detectionSource: "html",
          staging: {
            entryHtml: html,
            entryUrl,
          },
        });
      }
    } catch (error) {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error("Failed to check for new version");
      console.error("Failed to check for new version:", normalizedError);
      onDetectorFailed?.(normalizedError);
    }
  }

  function reportOnce(event: VersionCheckerUpdateDetectedEvent) {
    if (lastReportedBuildId === event.pendingBuildId) {
      if (!shouldReportDuplicateUpdate?.(event)) {
        return;
      }
    } else {
      lastReportedBuildId = event.pendingBuildId;
    }
    console.log("New version detected");
    onUpdateDetected(event);
  }

  const intervalId = setInterval(checkForNewVersion, pollingIntervalMs);
  const startupTimeoutId = setTimeout(checkForNewVersion, 10_000);

  return {
    stop: () => {
      clearInterval(intervalId);
      clearTimeout(startupTimeoutId);
    },
  };
}

function getInitialDeployBuildId() {
  const metadata = getInitialRuntimeBuildMetadata();
  const appVersion = metadata.appVersion === "dev" ? undefined : metadata.appVersion;
  return metadata.buildSha ?? appVersion;
}

async function readDeployBuildId(fetchImpl: VersionCheckerFetch) {
  const response = await fetchImpl("/deploy.json", { cache: "no-store" });
  if (!response.ok) {
    return undefined;
  }

  const metadata = normalizeDeployMetadata(await response.json());
  return metadata.buildSha ?? metadata.appVersion;
}

async function readEntryHtmlScripts(
  fetchImpl: VersionCheckerFetch,
): Promise<EntryHtmlScripts> {
  const entryUrl = `/?_=${Date.now()}`;
  const response = await fetchImpl(entryUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch HTML: ${response.status}`);
  }

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  return {
    entryUrl,
    html,
    scripts: readScriptSources(doc),
  };
}

function readDocumentScriptSources() {
  if (typeof document === "undefined") {
    return [];
  }

  return readScriptSources(document);
}

function readScriptSources(root: Document) {
  return Array.from(root.querySelectorAll("script"))
    .filter(
      (script) =>
        script.src &&
        (script.src.includes("/assets/") || script.src.includes("index")),
    )
    .map((script) => script.src);
}

function buildIdFromScripts(scripts: string[]) {
  const paths = scripts
    .map((scriptSrc) => new URL(scriptSrc, window.location.origin).pathname)
    .sort();

  return paths.length > 0 ? paths.join("|") : undefined;
}
