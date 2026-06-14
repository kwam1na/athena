import { POS_APP_SHELL_CACHE_PREFIX } from "./registerPosAppShellServiceWorker";

export type PosAppShellReadiness = {
  ready: boolean;
};

type PosAppShellWarmResult = {
  cacheName: string;
  cachedRequests: number;
};

export async function readPosAppShellReadiness(
  input: {
    orgUrlSlug?: string;
    storeUrlSlug?: string;
    warmIfMissing?: boolean;
    win?: Window;
  } = {},
): Promise<PosAppShellReadiness> {
  const targetWindow =
    input.win ?? (typeof window === "undefined" ? undefined : window);
  if (isLocalDevAppShellDisabled(targetWindow)) {
    return { ready: true };
  }

  const warmIfMissing = input.warmIfMissing ?? true;
  const readiness = await readCachedPosAppShellReadiness(input);

  if (readiness.ready || !warmIfMissing) {
    return readiness;
  }

  await warmPosAppShellReadiness(input);

  return readCachedPosAppShellReadiness(input);
}

async function readCachedPosAppShellReadiness(
  input: {
    orgUrlSlug?: string;
    storeUrlSlug?: string;
    win?: Window;
  } = {},
): Promise<PosAppShellReadiness> {
  const targetWindow =
    input.win ?? (typeof window === "undefined" ? undefined : window);
  const cacheStorage =
    targetWindow?.caches ??
    (typeof caches === "undefined" ? undefined : caches);

  if (!cacheStorage) {
    return { ready: false };
  }

  try {
    const cacheNames = await cacheStorage.keys();
    const shellCacheName = cacheNames.find((name) =>
      name.startsWith(POS_APP_SHELL_CACHE_PREFIX),
    );

    if (!shellCacheName) {
      return { ready: false };
    }

    const cache = await cacheStorage.open(shellCacheName);
    const registerPath = resolveRegisterPath(input, targetWindow);
    const cachedRegister =
      registerPath && targetWindow
        ? await cache.match(
            new URL(registerPath, targetWindow.location.origin).toString(),
            {
              ignoreVary: true,
            },
          )
        : null;
    const cachedRoot = await cache.match("/", { ignoreVary: true });

    return { ready: Boolean(cachedRegister || cachedRoot) };
  } catch {
    return { ready: false };
  }
}

export async function warmPosAppShellReadiness(
  input: {
    orgUrlSlug?: string;
    storeUrlSlug?: string;
    timeoutMs?: number;
    win?: Window;
  } = {},
): Promise<PosAppShellWarmResult | null> {
  const targetWindow =
    input.win ?? (typeof window === "undefined" ? undefined : window);
  const serviceWorker = targetWindow?.navigator?.serviceWorker;
  const registerPath = resolveRegisterPath(input, targetWindow);

  if (!targetWindow || !serviceWorker || !registerPath) {
    return null;
  }

  const win = targetWindow;
  const sw = serviceWorker;
  const messageTarget =
    sw.controller ?? (await waitForActiveServiceWorker(sw, win));
  if (!messageTarget) {
    return null;
  }

  const id = `warm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const url = new URL(registerPath, win.location.origin).toString();

  try {
    return await new Promise<PosAppShellWarmResult | null>((resolve) => {
      const timeout = win.setTimeout(() => {
        sw.removeEventListener("message", handleMessage);
        resolve(null);
      }, input.timeoutMs ?? 5_000);

      function handleMessage(event: MessageEvent) {
        const data = event.data;
        if (!data || data.id !== id) return;

        win.clearTimeout(timeout);
        sw.removeEventListener("message", handleMessage);

        if (data.type === "athena-pos-app-shell:warm-complete") {
          resolve(toWarmResult(data.result));
          return;
        }

        resolve(null);
      }

      sw.addEventListener("message", handleMessage);
      messageTarget.postMessage({
        type: "athena-pos-app-shell:warm",
        id,
        url,
      });
    });
  } catch {
    return null;
  }
}

async function waitForActiveServiceWorker(
  serviceWorker: ServiceWorkerContainer,
  win: Window,
): Promise<ServiceWorker | null> {
  if (!serviceWorker.ready) {
    return null;
  }

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

function isLocalDevAppShellDisabled(win?: Window) {
  const hostname = win?.location.hostname;
  return (
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") &&
    win?.location.port === "5173"
  );
}

function toWarmResult(result: unknown): PosAppShellWarmResult | null {
  if (!result || typeof result !== "object") return null;
  const value = result as Partial<PosAppShellWarmResult>;

  return typeof value.cacheName === "string" &&
    typeof value.cachedRequests === "number"
    ? {
        cacheName: value.cacheName,
        cachedRequests: value.cachedRequests,
      }
    : null;
}

function resolveRegisterPath(
  input: {
    orgUrlSlug?: string;
    storeUrlSlug?: string;
  },
  win?: Window,
) {
  if (input.orgUrlSlug && input.storeUrlSlug) {
    return `/${input.orgUrlSlug}/store/${input.storeUrlSlug}/pos/register`;
  }

  const segments = win?.location.pathname.split("/").filter(Boolean) ?? [];
  const storeSegmentIndex = segments.indexOf("store");
  const orgUrlSlug =
    storeSegmentIndex > 0 ? segments[storeSegmentIndex - 1] : undefined;
  const storeUrlSlug =
    storeSegmentIndex >= 0 ? segments[storeSegmentIndex + 1] : undefined;

  return orgUrlSlug && storeUrlSlug
    ? `/${orgUrlSlug}/store/${storeUrlSlug}/pos/register`
    : null;
}
