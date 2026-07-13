import type { Id } from "../_generated/dataModel";

export const SHARED_DEMO_TICKET_DURATION_MS = 60_000;
export const SHARED_DEMO_ADMISSION_DURATION_MS = 60 * 60_000;
export const SHARED_DEMO_ADMISSION_RATE_WINDOW_MS = 60_000;
export const SHARED_DEMO_MINT_RATE_LIMIT = 60;
export const SHARED_DEMO_EXCHANGE_RATE_LIMIT = 60;
export const SHARED_DEMO_BASELINE_VERSION = 2;

type SharedDemoEnvironment = Record<string, string | undefined>;

export function isSharedDemoEnabled(env: SharedDemoEnvironment) {
  const deploymentId = env.ATHENA_DEPLOYMENT_ID;
  const allowedDeployments = (env.ATHENA_SHARED_DEMO_DEPLOYMENT_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    env.ATHENA_SHARED_DEMO_ENABLED === "true" &&
    (env.ATHENA_DEPLOYMENT_ENVIRONMENT === "development" ||
      env.ATHENA_DEPLOYMENT_ENVIRONMENT === "qa") &&
    deploymentId !== undefined &&
    allowedDeployments.includes(deploymentId)
  );
}

export function readSharedDemoConfig(env: SharedDemoEnvironment) {
  if (!isSharedDemoEnabled(env)) {
    throw new Error("The shared demo is unavailable in this environment.");
  }

  const athenaUserId = env.ATHENA_SHARED_DEMO_ATHENA_USER_ID;
  const organizationId = env.ATHENA_SHARED_DEMO_ORGANIZATION_ID;
  const storeId = env.ATHENA_SHARED_DEMO_STORE_ID;
  if (!athenaUserId || !organizationId || !storeId) {
    throw new Error("Shared demo configuration is incomplete.");
  }

  return {
    athenaUserId: athenaUserId as Id<"athenaUser">,
    organizationId: organizationId as Id<"organization">,
    storeId: storeId as Id<"store">,
  };
}

export function readRuntimeSharedDemoConfig() {
  return readSharedDemoConfig(process.env);
}
