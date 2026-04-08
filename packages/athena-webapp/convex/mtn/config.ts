import {
  MtnCollectionsConfig,
  MtnCollectionsConfigResult,
  MtnCollectionsTargetEnvironment,
} from "./types";

type StoreIdentity = {
  storeId: string;
  storeSlug?: string | null;
};

type EnvSource = Record<string, string | undefined>;

const DEFAULT_CALLBACK_PATH = "/webhooks/mtn-momo/collections";

const DEFAULT_BASE_URLS: Record<MtnCollectionsTargetEnvironment, string> = {
  sandbox: "https://sandbox.momodeveloper.mtn.com",
  production: "https://momodeveloper.mtn.com",
};

const REQUIRED_SUFFIXES = [
  "SUBSCRIPTION_KEY",
  "API_USER",
  "API_KEY",
  "TARGET_ENVIRONMENT",
  "CALLBACK_HOST",
] as const;

const toEnvSegment = (value: string | null | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  return normalized.length > 0 ? normalized : undefined;
};

export const buildMtnCollectionsLookupPrefixes = (
  store: StoreIdentity,
): string[] => {
  const segments = [
    toEnvSegment(store.storeSlug),
    toEnvSegment(store.storeId),
  ].filter((segment): segment is string => Boolean(segment));

  return [...new Set(segments)].map(
    (segment) => `MTN_MOMO_COLLECTIONS_${segment}`,
  );
};

const readScopedValue = (
  env: EnvSource,
  prefix: string,
  suffix: string,
): string | undefined => {
  const value = env[`${prefix}_${suffix}`];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const isTargetEnvironment = (
  value: string | undefined,
): value is MtnCollectionsTargetEnvironment => {
  return value === "sandbox" || value === "production";
};

const resolveConfigForPrefix = (
  env: EnvSource,
  prefix: string,
): MtnCollectionsConfig | null => {
  const subscriptionKey = readScopedValue(env, prefix, "SUBSCRIPTION_KEY");
  const apiUser = readScopedValue(env, prefix, "API_USER");
  const apiKey = readScopedValue(env, prefix, "API_KEY");
  const targetEnvironment = readScopedValue(env, prefix, "TARGET_ENVIRONMENT");
  const callbackHost = readScopedValue(env, prefix, "CALLBACK_HOST");

  if (
    !subscriptionKey ||
    !apiUser ||
    !apiKey ||
    !targetEnvironment ||
    !callbackHost ||
    !isTargetEnvironment(targetEnvironment)
  ) {
    return null;
  }

  return {
    subscriptionKey,
    apiUser,
    apiKey,
    targetEnvironment,
    baseUrl:
      readScopedValue(env, prefix, "BASE_URL") ??
      DEFAULT_BASE_URLS[targetEnvironment],
    callbackHost,
    callbackPath:
      readScopedValue(env, prefix, "CALLBACK_PATH") ?? DEFAULT_CALLBACK_PATH,
  };
};

export const resolveMtnCollectionsConfigFromEnv = (
  store: StoreIdentity,
  env: EnvSource = process.env,
): MtnCollectionsConfigResult => {
  const lookupPrefixes = buildMtnCollectionsLookupPrefixes(store);

  for (const prefix of lookupPrefixes) {
    const config = resolveConfigForPrefix(env, prefix);
    if (config) {
      return {
        kind: "configured",
        config,
        lookupPrefixes,
      };
    }
  }

  const primaryPrefix =
    lookupPrefixes[0] ?? "MTN_MOMO_COLLECTIONS_UNCONFIGURED_STORE";

  return {
    kind: "not_configured",
    lookupPrefixes,
    missing: REQUIRED_SUFFIXES.map((suffix) => `${primaryPrefix}_${suffix}`),
  };
};

export const buildMtnCollectionsCallbackUrl = (
  config: Pick<MtnCollectionsConfig, "callbackHost" | "callbackPath">,
  params: {
    storeId: string;
    providerReference: string;
  },
): string => {
  const base = new URL(config.callbackPath, config.callbackHost);
  base.searchParams.set("storeId", params.storeId);
  base.searchParams.set("providerReference", params.providerReference);
  return base.toString();
};
