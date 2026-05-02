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

  if (adminUrl.hostname === "athena-qa.wigclub.store") {
    return `${adminUrl.protocol}//qa.wigclub.store`;
  }

  if (adminUrl.hostname === "athena.wigclub.store") {
    return `${adminUrl.protocol}//wigclub.store`;
  }

  if (adminUrl.hostname.startsWith("athena-qa.")) {
    return `${adminUrl.protocol}//${adminUrl.hostname.replace(
      /^athena-qa\./,
      "qa.",
    )}`;
  }

  if (adminUrl.hostname.startsWith("athena.")) {
    return `${adminUrl.protocol}//${adminUrl.hostname.replace(/^athena\./, "")}`;
  }

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
