const LOCAL_STOREFRONT_URL = "http://localhost:5174";

type StoreFrontUrlOptions = {
  configuredUrl?: string;
  origin?: string;
};

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

function getRuntimeOrigin() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.location.origin;
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

// Hosts whose storefront hostname is a mechanical transform of the admin
// hostname. `athena-os.app` is deliberately absent: the admin app is no longer
// named after the storefront it administers, so there is nothing to derive.
// Builds served from it rely on VITE_STOREFRONT_URL, which every deploy path
// sets.
function deriveStoreFrontFromAdminHost(adminUrl: URL) {
  const { hostname, protocol } = adminUrl;

  if (hostname === "athena-qa.wigclub.store") {
    return `${protocol}//qa.wigclub.store`;
  }

  if (hostname === "athena.wigclub.store") {
    return `${protocol}//wigclub.store`;
  }

  if (hostname.startsWith("athena-qa.")) {
    return `${protocol}//${hostname.replace(/^athena-qa\./, "qa.")}`;
  }

  if (hostname.startsWith("athena.")) {
    return `${protocol}//${hostname.replace(/^athena\./, "")}`;
  }

  return undefined;
}

export function resolveStoreFrontUrl({
  configuredUrl,
  origin,
}: StoreFrontUrlOptions = {}) {
  const explicitUrl = configuredUrl?.trim();
  if (explicitUrl) {
    return trimTrailingSlash(explicitUrl);
  }

  const runtimeOrigin = origin ?? getRuntimeOrigin();
  if (!runtimeOrigin) {
    return LOCAL_STOREFRONT_URL;
  }

  let adminUrl: URL;
  try {
    adminUrl = new URL(runtimeOrigin);
  } catch {
    return LOCAL_STOREFRONT_URL;
  }

  if (isLocalHost(adminUrl.hostname)) {
    return `${adminUrl.protocol}//${adminUrl.hostname}:5174`;
  }

  const derived = deriveStoreFrontFromAdminHost(adminUrl);
  if (derived) {
    return derived;
  }

  // Reaching here on a deployed host means the build is missing
  // VITE_STOREFRONT_URL. Say so, rather than silently pointing every storefront
  // link in the admin app at a dev server nobody is running.
  console.warn(
    `[config] No storefront URL configured for ${adminUrl.hostname}. ` +
      `Set VITE_STOREFRONT_URL at build time. Falling back to ${LOCAL_STOREFRONT_URL}.`,
  );

  return LOCAL_STOREFRONT_URL;
}

const config = {
  storeFrontUrl: resolveStoreFrontUrl({
    configuredUrl: import.meta.env.VITE_STOREFRONT_URL,
  }),
  hlsURL:
    import.meta.env.VITE_HLS_URL || "https://d1sjmzps5tlpbc.cloudfront.net",
};

export default config;
