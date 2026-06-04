const POS_SEGMENT = "pos";

const excludedPathPrefixes = [
  "/api",
  "/convex",
  "/_convex",
  "/auth",
  "/.well-known",
];

const excludedStaticExtensions = [
  ".json",
  ".map",
  ".txt",
  ".xml",
];

const shellAssetExtensions = [
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

const shellAssetPrefixes = [
  "/assets/",
  "/src/",
  "/@vite/",
  "/node_modules/",
];

export type PosAppShellRequestLike = {
  url: string;
  method?: string;
  mode?: string;
  destination?: string;
  headers?: Pick<Headers, "get"> | PosAppShellHeaderRecord;
};

type PosAppShellHeaderRecord = Record<string, string | undefined>;

export function isPosAppShellRoutePath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  return segments.includes(POS_SEGMENT);
}

export function isExcludedFromPosAppShellCache(url: URL): boolean {
  const pathname = url.pathname.toLowerCase();

  if (pathname.startsWith("/convex/_generated/")) {
    return false;
  }

  if (excludedPathPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  if (excludedStaticExtensions.some((extension) => pathname.endsWith(extension))) {
    return true;
  }

  return pathname.includes("/api/") || pathname.includes("/convex/");
}

export function isPosAppShellNavigationRequest(
  request: PosAppShellRequestLike,
  origin: string,
): boolean {
  const url = new URL(request.url, origin);

  if (url.origin !== origin) return false;
  if ((request.method ?? "GET").toUpperCase() !== "GET") return false;
  if (isExcludedFromPosAppShellCache(url)) return false;
  if (!isPosAppShellRoutePath(url.pathname)) return false;

  if (request.mode === "navigate") return true;

  const accept = readHeader(request.headers, "accept");
  return Boolean(accept?.includes("text/html"));
}

export function isPosAppShellStaticAssetRequest(
  request: PosAppShellRequestLike,
  origin: string,
): boolean {
  const url = new URL(request.url, origin);

  if (url.origin !== origin) return false;
  if ((request.method ?? "GET").toUpperCase() !== "GET") return false;
  if (isExcludedFromPosAppShellCache(url)) return false;

  return (
    ["script", "style", "font", "image"].includes(request.destination ?? "") ||
    shellAssetExtensions.some((extension) =>
      url.pathname.toLowerCase().endsWith(extension),
    ) ||
    shellAssetPrefixes.some((prefix) => url.pathname.startsWith(prefix))
  );
}

function readHeader(
  headers: PosAppShellRequestLike["headers"],
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if ("get" in headers && typeof headers.get === "function") {
    return headers.get(name) ?? undefined;
  }

  const headerRecord = headers as PosAppShellHeaderRecord;
  const direct = headerRecord[name];
  if (direct) return direct;

  return headerRecord[name.toLowerCase()];
}
