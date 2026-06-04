import { expect, test, type Page } from "@playwright/test";

const POS_REGISTER_PATH = "/wigclub/store/wigclub/pos/register";

async function waitForPosAppShellServiceWorkerReady(page: Page) {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator) || !("caches" in window)) {
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) return false;

    const cacheNames = await caches.keys();
    const hasPosShellCache = cacheNames.some((name) =>
      name.startsWith("athena-pos-app-shell-"),
    );
    if (!hasPosShellCache) return false;

    if (navigator.serviceWorker.controller) return true;

    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
        once: true,
      });
    });

    return Boolean(navigator.serviceWorker.controller);
  });
}

async function waitForPosAppShellCache(page: Page) {
  await page.waitForFunction(async () => {
    const cacheNames = await caches.keys();
    const posShellCacheName = cacheNames.find((name) =>
      name.startsWith("athena-pos-app-shell-"),
    );
    if (!posShellCacheName) return false;

    const cache = await caches.open(posShellCacheName);
    const cachedRoute = await cache.match(window.location.href);

    return Boolean(cachedRoute);
  });
}

async function waitForLoadedShellAssetsCached(page: Page) {
  await page.waitForFunction(async () => {
    const cacheNames = await caches.keys();
    const posShellCacheName = cacheNames.find((name) =>
      name.startsWith("athena-pos-app-shell-"),
    );
    if (!posShellCacheName) return false;

    const cache = await caches.open(posShellCacheName);
    const loadedShellAssetUrls = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => {
        const parsedUrl = new URL(url, window.location.href);
        return (
          parsedUrl.origin === window.location.origin &&
          parsedUrl.pathname.startsWith("/assets/")
        );
      });

    if (loadedShellAssetUrls.length === 0) return false;

    const cachedAssets = await Promise.all(
      loadedShellAssetUrls.map((url) => cache.match(url)),
    );

    return cachedAssets.every(Boolean);
  });
}

async function warmCurrentPosAppShell(page: Page) {
  const result = await page.evaluate(async () => {
    const controller = navigator.serviceWorker.controller;
    if (!controller) {
      throw new Error("POS app-shell service worker is not controlling the page");
    }

    const id = `warm-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return await new Promise<{ cacheName: string; cachedRequests: number }>(
      (resolve, reject) => {
        const timeout = window.setTimeout(() => {
          navigator.serviceWorker.removeEventListener("message", handleMessage);
          reject(new Error("Timed out warming the POS app shell"));
        }, 20_000);

        function handleMessage(event: MessageEvent) {
          const data = event.data;
          if (!data || data.id !== id) return;

          window.clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener("message", handleMessage);

          if (data.type === "athena-pos-app-shell:warm-complete") {
            resolve(data.result);
            return;
          }

          reject(new Error(data.error ?? "Failed to warm the POS app shell"));
        }

        navigator.serviceWorker.addEventListener("message", handleMessage);
        controller.postMessage({
          type: "athena-pos-app-shell:warm",
          id,
          url: window.location.href,
        });
      },
    );
  });

  expect(result.cacheName).toMatch(/^athena-pos-app-shell-/);
  expect(result.cachedRequests).toBeGreaterThan(0);
}

async function expectNoBusinessPayloadsCached(page: Page) {
  const cachedUrls = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const urls: string[] = [];

    for (const cacheName of cacheNames) {
      if (!cacheName.startsWith("athena-pos-app-shell-")) continue;
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      urls.push(...keys.map((request) => request.url));
    }

    return urls;
  });

  expect(cachedUrls).not.toContainEqual(expect.stringMatching(/\/api(?:\/|$)/));
  expect(cachedUrls).not.toContainEqual(
    expect.stringMatching(/\/convex\/(?!_generated\/)/),
  );
  expect(cachedUrls).not.toContainEqual(expect.stringMatching(/\.json(?:\?|$)/));
}

async function expectPosRegisterRouteChunksCached(page: Page) {
  const cachedUrls = await getPosAppShellCachedUrls(page);

  expect(cachedUrls).toContainEqual(expect.stringMatching(/\/assets\/register\.index-/));
  expect(cachedUrls).toContainEqual(expect.stringMatching(/\/assets\/POSRegisterView-/));
}

async function getPosAppShellCachedUrls(page: Page) {
  return await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const urls: string[] = [];

    for (const cacheName of cacheNames) {
      if (!cacheName.startsWith("athena-pos-app-shell-")) continue;
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      urls.push(...keys.map((request) => request.url));
    }

    return urls;
  });
}

async function collectOfflineAppShellDiagnostics(page: Page) {
  return await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const cachedUrls: string[] = [];

    for (const cacheName of cacheNames) {
      if (!cacheName.startsWith("athena-pos-app-shell-")) continue;
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      cachedUrls.push(...keys.map((request) => request.url));
    }

    return {
      appHtml: document.querySelector("#app")?.innerHTML.slice(0, 500) ?? null,
      cachedAssetCount: cachedUrls.filter((url) => new URL(url).pathname.startsWith("/assets/"))
        .length,
      cachedRouteCount: cachedUrls.filter((url) => !new URL(url).pathname.startsWith("/assets/"))
        .length,
      readyState: document.readyState,
    };
  });
}

function formatRuntimeSignals(runtimeSignals: string[]) {
  return runtimeSignals.slice(-20).join(" | ") || "none";
}

async function waitForRenderedAppShell(page: Page, runtimeSignals: string[] = []) {
  try {
    await expect(page.locator("#app")).not.toBeEmpty({ timeout: 30_000 });
  } catch (error) {
    const diagnostics = await collectOfflineAppShellDiagnostics(page);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nPOS app-shell diagnostics: ${JSON.stringify(diagnostics)}\nPOS app-shell runtime signals: ${formatRuntimeSignals(runtimeSignals)}`,
    );
  }
  await expect(page.locator("body")).toContainText(/POS|Athena|checkout|sign in/i, {
    timeout: 30_000,
  });
}

test.describe("POS offline route access", () => {
  test("serves the POS register app shell after a no-network hard reload", async ({
    context,
    page,
  }) => {
    const runtimeSignals: string[] = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        runtimeSignals.push(`console:${message.type()}:${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      runtimeSignals.push(`pageerror:${error.message}`);
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (url.origin === new URL(page.url()).origin && url.pathname.startsWith("/assets/")) {
        runtimeSignals.push(
          `requestfailed:${url.pathname}:${request.failure()?.errorText ?? "unknown"}`,
        );
      }
    });

    await page.goto(POS_REGISTER_PATH, { waitUntil: "load" });
    await waitForRenderedAppShell(page, runtimeSignals);
    await waitForPosAppShellServiceWorkerReady(page);
    await page.reload({ waitUntil: "load" });
    await waitForRenderedAppShell(page, runtimeSignals);
    await waitForPosAppShellCache(page);
    await waitForLoadedShellAssetsCached(page);
    await warmCurrentPosAppShell(page);
    await expectPosRegisterRouteChunksCached(page);
    await expectNoBusinessPayloadsCached(page);

    await context.setOffline(true);

    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      try {
        await waitForRenderedAppShell(page, runtimeSignals);
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nPOS app-shell runtime signals: ${formatRuntimeSignals(runtimeSignals)}`,
        );
      }
      await expect(page).toHaveURL(new RegExp(`${POS_REGISTER_PATH}/?$`));
    } finally {
      await context.setOffline(false);
    }
  });
});
