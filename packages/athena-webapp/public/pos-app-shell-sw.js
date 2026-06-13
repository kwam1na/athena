const POS_APP_SHELL_CACHE = "athena-pos-app-shell-v6";
const POS_APP_SHELL_CACHE_PREFIX = "athena-pos-app-shell-";
const LOCAL_DEV_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOCAL_DEV_PORTS = new Set(["5173"]);
const IS_LOCAL_DEV =
  LOCAL_DEV_HOSTNAMES.has(self.location.hostname) &&
  LOCAL_DEV_PORTS.has(self.location.port);
const STATIC_DESTINATIONS = new Set(["script", "style", "font", "image"]);
const PRODUCTION_ASSET_PREFIX = "/assets/";
const EXCLUDED_PREFIXES = ["/api", "/convex", "/_convex", "/auth", "/.well-known"];
const EXCLUDED_EXTENSIONS = [".json", ".map", ".txt", ".xml"];
const SHELL_ASSET_EXTENSIONS = [
  ".css",
  ".js",
  ".mjs",
  ".woff",
  ".woff2",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".webp",
];
const SHELL_ASSET_PREFIXES = ["/assets/", "/src/", "/@vite/", "/node_modules/"];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  if (IS_LOCAL_DEV) {
    event.waitUntil(unregisterLocalDevAppShell());
    return;
  }

  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("athena-pos-app-shell-") && key !== POS_APP_SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (IS_LOCAL_DEV) return;

  const request = event.request;
  const url = new URL(request.url);

  if (isPosNavigation(request, url)) {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (isStaticShellAsset(request, url)) {
    event.respondWith(cacheFirstAsset(request));
  }
});

async function unregisterLocalDevAppShell() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(POS_APP_SHELL_CACHE_PREFIX))
      .map((key) => caches.delete(key)),
  );
  await self.registration.unregister();
  await self.clients.claim();
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.type !== "athena-pos-app-shell:warm") return;

  event.waitUntil(
    warmPosAppShell(message.url)
      .then((result) => {
        event.source?.postMessage({
          type: "athena-pos-app-shell:warm-complete",
          id: message.id,
          result,
        });
      })
      .catch((error) => {
        event.source?.postMessage({
          type: "athena-pos-app-shell:warm-error",
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
  );
});

function isPosNavigation(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (request.method !== "GET") return false;
  if (request.mode !== "navigate") return false;
  if (isExcluded(url)) return false;

  return url.pathname.split("/").filter(Boolean).includes("pos");
}

function isStaticShellAsset(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (request.method !== "GET") return false;
  if (isExcluded(url)) return false;

  return (
    STATIC_DESTINATIONS.has(request.destination) ||
    SHELL_ASSET_EXTENSIONS.some((extension) =>
      url.pathname.toLowerCase().endsWith(extension),
    ) ||
    SHELL_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  );
}

function isExcluded(url) {
  const pathname = url.pathname.toLowerCase();
  if (pathname.startsWith("/convex/_generated/")) return false;

  return (
    EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    EXCLUDED_EXTENSIONS.some((extension) => pathname.endsWith(extension)) ||
    pathname.includes("/api/") ||
    pathname.includes("/convex/")
  );
}

async function networkFirstShell(request) {
  const cache = await caches.open(POS_APP_SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok && isHtmlResponse(response)) {
      await cache.put(request, response.clone());
      await cache.put("/", response.clone());
      await cacheLinkedShellAssets(response.clone(), request.url, cache);
    }
    return response;
  } catch (error) {
    const cachedRoute = await matchCached(cache, request);
    if (cachedRoute) return cachedRoute;

    const cachedRoot = await matchCached(cache, "/");
    if (cachedRoot) return cachedRoot;

    throw error;
  }
}

async function warmPosAppShell(url) {
  const routeUrl = new URL(url, self.location.origin);
  const request = new Request(routeUrl.toString(), {
    headers: { accept: "text/html" },
  });

  const isPosRoute = routeUrl.pathname.split("/").filter(Boolean).includes("pos");
  if (!isPosRoute) {
    throw new Error(`Refusing to warm non-POS shell route: ${routeUrl.pathname}`);
  }

  const cache = await caches.open(POS_APP_SHELL_CACHE);
  const response = await fetch(request);
  if (!response.ok || !isHtmlResponse(response)) {
    throw new Error(`Unable to warm POS shell route: ${response.status}`);
  }

  await cache.put(routeUrl.toString(), response.clone());
  await cache.put("/", response.clone());
  await cacheLinkedShellAssets(response.clone(), routeUrl.toString(), cache);

  const keys = await cache.keys();
  return { cacheName: POS_APP_SHELL_CACHE, cachedRequests: keys.length };
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(POS_APP_SHELL_CACHE);
  const cached = await matchCached(cache, request);
  if (cached) return cached;

  return cacheAssetRequest(request, cache);
}

async function cacheAssetRequest(request, cache, visited = new Set()) {
  if (visited.has(request.url)) {
    const cached = await matchCached(cache, request);
    if (cached) return cached;
  }
  visited.add(request.url);

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await cacheModuleDependencies(response.clone(), request.url, cache, visited);
  }
  return response;
}

function isHtmlResponse(response) {
  return response.headers.get("content-type")?.includes("text/html");
}

async function cacheLinkedShellAssets(response, baseUrl, cache) {
  const html = await response.text();
  const linkedUrls = new Set();
  const scriptPattern = /<script[^>]+src=["']([^"']+)["']/g;
  const linkPattern = /<link[^>]+href=["']([^"']+)["'][^>]*>/g;

  for (const match of html.matchAll(scriptPattern)) {
    linkedUrls.add(new URL(match[1], baseUrl).toString());
  }

  for (const match of html.matchAll(linkPattern)) {
    const tag = match[0];
    if (!/\b(rel=["'](?:modulepreload|preload|stylesheet)["']|as=["'](?:script|style)["'])/.test(tag)) {
      continue;
    }
    linkedUrls.add(new URL(match[1], baseUrl).toString());
  }

  await Promise.all(
    Array.from(linkedUrls).map(async (url) => {
      const request = new Request(url);
      const parsedUrl = new URL(url);
      if (!isStaticShellAsset(request, parsedUrl)) return;
      if (await matchCached(cache, request)) return;
      await cacheAssetRequest(request, cache);
    }),
  );
}

async function cacheModuleDependencies(response, baseUrl, cache, visited) {
  if (!isJavaScriptLikeResponse(response, baseUrl)) return;
  if (!shouldScanModuleImports(new URL(baseUrl))) return;

  const source = await response.text();
  const dependencyUrls = new Set();
  const importPatterns = [
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /["']([^"']*assets\/[^"']+)["']/g,
  ];

  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      const resolvedUrl = resolveShellAssetReference(specifier, baseUrl);
      if (!resolvedUrl) continue;
      dependencyUrls.add(resolvedUrl);
    }
  }

  await Promise.all(
    Array.from(dependencyUrls).map(async (url) => {
      const request = new Request(url);
      const parsedUrl = new URL(url);
      if (!isStaticShellAsset(request, parsedUrl)) return;
      if (visited.has(request.url)) return;
      if (await matchCached(cache, request)) return;
      try {
        await cacheAssetRequest(request, cache, visited);
      } catch (_error) {
        // Dev-optimized dependencies can contain example import strings. Ignore
        // those misses; real module requests still fail visibly at runtime.
      }
    }),
  );
}

async function matchCached(cache, request) {
  const cached = await cache.match(request);
  if (cached) return cached;

  const url = typeof request === "string" ? request : request.url;
  return await cache.match(url, { ignoreVary: true });
}

function resolveShellAssetReference(specifier, baseUrl) {
  if (specifier.startsWith("/")) {
    return new URL(specifier, self.location.origin).toString();
  }

  if (specifier.startsWith("assets/")) {
    return new URL(`/${specifier}`, self.location.origin).toString();
  }

  if (specifier.startsWith(".")) {
    return new URL(specifier, baseUrl).toString();
  }

  return null;
}

function shouldScanModuleImports(url) {
  return (
    url.pathname.startsWith(PRODUCTION_ASSET_PREFIX) ||
    url.pathname.startsWith("/src/") ||
    url.pathname.startsWith("/shared/") ||
    url.pathname.startsWith("/convex/_generated/") ||
    url.pathname.startsWith("/@fs/") ||
    url.pathname === "/@vite/client" ||
    url.pathname === "/@react-refresh"
  );
}

function isJavaScriptLikeResponse(response, baseUrl) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("javascript")) return true;
  if (contentType.includes("typescript")) return true;

  const pathname = new URL(baseUrl).pathname.toLowerCase();
  return (
    pathname.endsWith(".js") ||
    pathname.endsWith(".mjs") ||
    pathname.endsWith(".ts") ||
    pathname.endsWith(".tsx")
  );
}
