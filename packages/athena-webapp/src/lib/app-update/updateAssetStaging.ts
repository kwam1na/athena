import { isPosAppShellStaticAssetRequest } from "../../offline/posAppShellRoutes";

const STAGE_STATIC_ASSETS_MESSAGE = "athena-pos-app-shell:stage-static-assets";
const STAGE_STATIC_ASSETS_COMPLETE_MESSAGE =
  "athena-pos-app-shell:stage-static-assets-complete";
const STAGE_STATIC_ASSETS_ERROR_MESSAGE =
  "athena-pos-app-shell:stage-static-assets-error";

export type UpdateAssetStagingReason =
  | "asset-staging-failed"
  | "no-entry-html"
  | "no-static-assets"
  | "cache-storage-unavailable"
  | "service-worker-unavailable"
  | "service-worker-timeout"
  | "service-worker-error";

export type UpdateAssetStagingResult =
  | {
      status: "staged";
      assetUrls: string[];
      cacheName: string;
      cachedRequests: number;
      failedAssetUrls: string[];
      rejectedAssetUrls: string[];
      stagedAssetUrls: string[];
    }
  | {
      status: "unstaged";
      assetUrls: string[];
      reason: UpdateAssetStagingReason;
      failedAssetUrls?: string[];
      rejectedAssetUrls?: string[];
    };

type StageStaticAssetsServiceWorkerResult = {
  cacheName: string;
  cachedRequests: number;
  failedAssetUrls: string[];
  rejectedAssetUrls: string[];
  stagedAssetUrls: string[];
};

export async function stageUpdateStaticAssets(input: {
  entryHtml?: string | null;
  entryUrl: string;
  timeoutMs?: number;
  win?: Window;
}): Promise<UpdateAssetStagingResult> {
  if (!input.entryHtml?.trim()) {
    return {
      assetUrls: [],
      reason: "no-entry-html",
      status: "unstaged",
    };
  }

  const targetWindow =
    input.win ?? (typeof window === "undefined" ? undefined : window);
  const origin = targetWindow?.location.origin ?? new URL(input.entryUrl).origin;
  const assetUrls = collectUpdateStaticAssetUrls({
    entryHtml: input.entryHtml,
    entryUrl: input.entryUrl,
    origin,
  });

  if (assetUrls.length === 0) {
    return {
      assetUrls,
      reason: "no-static-assets",
      status: "unstaged",
    };
  }

  if (!targetWindow?.caches) {
    return {
      assetUrls,
      reason: "cache-storage-unavailable",
      status: "unstaged",
    };
  }

  const serviceWorker = targetWindow.navigator?.serviceWorker;
  if (!serviceWorker) {
    return {
      assetUrls,
      reason: "service-worker-unavailable",
      status: "unstaged",
    };
  }
  const messagingWindow = targetWindow;

  const messageTarget =
    serviceWorker.controller ??
    (await waitForActiveServiceWorker(serviceWorker, messagingWindow));
  if (!messageTarget) {
    return {
      assetUrls,
      reason: "service-worker-unavailable",
      status: "unstaged",
    };
  }

  const id = `stage-assets-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise<UpdateAssetStagingResult>((resolve) => {
    const MessageChannelConstructor =
      (messagingWindow as Window & { MessageChannel?: typeof MessageChannel })
        .MessageChannel ?? globalThis.MessageChannel;
    const channel =
      typeof MessageChannelConstructor === "function"
        ? new MessageChannelConstructor()
        : null;

    const timeout = messagingWindow.setTimeout(() => {
      channel?.port1.close();
      serviceWorker.removeEventListener("message", handleMessage);
      resolve({
        assetUrls,
        reason: "service-worker-timeout",
        status: "unstaged",
      });
    }, input.timeoutMs ?? 5_000);

    function finish(result: UpdateAssetStagingResult) {
      messagingWindow.clearTimeout(timeout);
      channel?.port1.close();
      serviceWorker.removeEventListener("message", handleMessage);
      resolve(result);
    }

    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || data.id !== id) return;

      if (data.type === STAGE_STATIC_ASSETS_COMPLETE_MESSAGE) {
        const result = toServiceWorkerResult(data.result);
        if (!result) {
          finish({
            assetUrls,
            reason: "service-worker-error",
            status: "unstaged",
          });
          return;
        }

        if (
          result.failedAssetUrls.length > 0 ||
          result.rejectedAssetUrls.length > 0 ||
          result.stagedAssetUrls.length < assetUrls.length
        ) {
          finish({
            assetUrls,
            failedAssetUrls: result.failedAssetUrls,
            reason: "asset-staging-failed",
            rejectedAssetUrls: result.rejectedAssetUrls,
            status: "unstaged",
          });
          return;
        }

        finish({
          assetUrls,
          cacheName: result.cacheName,
          cachedRequests: result.cachedRequests,
          failedAssetUrls: result.failedAssetUrls,
          rejectedAssetUrls: result.rejectedAssetUrls,
          stagedAssetUrls: result.stagedAssetUrls,
          status: "staged",
        });
        return;
      }

      if (data.type === STAGE_STATIC_ASSETS_ERROR_MESSAGE) {
        finish({
          assetUrls,
          reason: "service-worker-error",
          status: "unstaged",
        });
      }
    }

    serviceWorker.addEventListener("message", handleMessage);
    if (channel) {
      channel.port1.onmessage = handleMessage;
      channel.port1.start();
    }
    const message = {
      assetUrls,
      id,
      type: STAGE_STATIC_ASSETS_MESSAGE,
    };
    if (channel) {
      messageTarget.postMessage(message, [channel.port2]);
    } else {
      messageTarget.postMessage(message);
    }
  });
}

export function collectUpdateStaticAssetUrls(input: {
  entryHtml: string;
  entryUrl: string;
  origin: string;
}): string[] {
  const urls = new Set<string>();

  for (const url of extractScriptSrcUrls(input.entryHtml, input.entryUrl)) {
    maybeAddShellAssetUrl(urls, url, input.origin);
  }

  for (const url of extractLinkHrefUrls(input.entryHtml, input.entryUrl)) {
    maybeAddShellAssetUrl(urls, url, input.origin);
  }

  return Array.from(urls);
}

function extractScriptSrcUrls(html: string, baseUrl: string): string[] {
  const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  return Array.from(html.matchAll(scriptPattern), (match) =>
    new URL(match[1], baseUrl).toString(),
  );
}

function extractLinkHrefUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const linkPattern = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;

  for (const match of html.matchAll(linkPattern)) {
    const tag = match[0];
    if (!isStaticShellLinkTag(tag)) continue;
    urls.push(new URL(match[1], baseUrl).toString());
  }

  return urls;
}

function isStaticShellLinkTag(tag: string): boolean {
  const rel = readTagAttribute(tag, "rel")?.toLowerCase();
  const as = readTagAttribute(tag, "as")?.toLowerCase();

  if (rel === "stylesheet" || rel === "modulepreload") return true;
  if (rel !== "preload") return false;

  return as === "script" || as === "style" || as === "font" || as === "image";
}

function readTagAttribute(tag: string, attribute: string): string | null {
  const pattern = new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i");
  return pattern.exec(tag)?.[1] ?? null;
}

function maybeAddShellAssetUrl(urls: Set<string>, url: string, origin: string) {
  const parsedUrl = new URL(url, origin);
  if (
    isPosAppShellStaticAssetRequest(
      {
        url: parsedUrl.toString(),
      },
      origin,
    )
  ) {
    urls.add(parsedUrl.toString());
  }
}

async function waitForActiveServiceWorker(
  serviceWorker: ServiceWorkerContainer,
  win: Window,
): Promise<ServiceWorker | null> {
  if (!serviceWorker.ready) return null;

  return new Promise<ServiceWorker | null>((resolve) => {
    const timeout = win.setTimeout(() => resolve(null), 1_000);

    serviceWorker.ready
      .then((registration) => {
        win.clearTimeout(timeout);
        resolve(registration.active ?? null);
      })
      .catch(() => {
        win.clearTimeout(timeout);
        resolve(null);
      });
  });
}

function toServiceWorkerResult(
  result: unknown,
): StageStaticAssetsServiceWorkerResult | null {
  if (!result || typeof result !== "object") return null;
  const value = result as Partial<StageStaticAssetsServiceWorkerResult>;

  if (
    typeof value.cacheName !== "string" ||
    typeof value.cachedRequests !== "number"
  ) {
    return null;
  }

  return {
    cacheName: value.cacheName,
    cachedRequests: value.cachedRequests,
    failedAssetUrls: Array.isArray(value.failedAssetUrls)
      ? value.failedAssetUrls.filter((url): url is string => typeof url === "string")
      : [],
    rejectedAssetUrls: Array.isArray(value.rejectedAssetUrls)
      ? value.rejectedAssetUrls.filter(
          (url): url is string => typeof url === "string",
        )
      : [],
    stagedAssetUrls: Array.isArray(value.stagedAssetUrls)
      ? value.stagedAssetUrls.filter((url): url is string => typeof url === "string")
      : [],
  };
}
