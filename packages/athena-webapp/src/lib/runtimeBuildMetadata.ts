export type AthenaWebappRuntimeBuildMetadata = {
  appVersion?: string;
  buildSha?: string;
};

type DeployMetadata = {
  fun_name?: unknown;
  git_sha?: unknown;
  version?: unknown;
};
type RuntimeBuildMetadataFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function getInitialRuntimeBuildMetadata(): AthenaWebappRuntimeBuildMetadata {
  const env = import.meta.env as Record<string, unknown>;
  const appVersion =
    normalizeMetadataValue(env.VITE_ATHENA_WEBAPP_VERSION) ??
    normalizeMetadataValue(env.VITE_APP_VERSION) ??
    (env.DEV === true ? "dev" : undefined);
  const buildSha =
    normalizeMetadataValue(env.VITE_ATHENA_WEBAPP_BUILD_SHA) ??
    normalizeMetadataValue(env.VITE_GIT_SHA);

  return {
    ...(appVersion ? { appVersion } : {}),
    ...(buildSha ? { buildSha } : {}),
  };
}

export async function readRuntimeBuildMetadata(
  fetchImpl: RuntimeBuildMetadataFetch = fetch,
): Promise<AthenaWebappRuntimeBuildMetadata> {
  try {
    const response = await fetchImpl("/deploy.json", {
      cache: "no-store",
    });
    if (!response.ok) {
      return {};
    }

    return normalizeDeployMetadata((await response.json()) as DeployMetadata);
  } catch {
    return {};
  }
}

export function normalizeDeployMetadata(
  metadata: DeployMetadata,
): AthenaWebappRuntimeBuildMetadata {
  const funName = normalizeMetadataValue(metadata.fun_name);
  const version = normalizeMetadataValue(metadata.version);
  const buildSha = normalizeMetadataValue(metadata.git_sha);
  const appVersion = funName && version ? `${funName} (${version})` : funName ?? version;

  return {
    ...(appVersion ? { appVersion } : {}),
    ...(buildSha ? { buildSha } : {}),
  };
}

function normalizeMetadataValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
