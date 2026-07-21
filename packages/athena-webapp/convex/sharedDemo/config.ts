import type { Id } from "../_generated/dataModel";

export const SHARED_DEMO_TICKET_DURATION_MS = 60_000;
export const SHARED_DEMO_ADMISSION_DURATION_MS = 3 * 60 * 60_000;
export const SHARED_DEMO_ADMISSION_RATE_WINDOW_MS = 60_000;
export const SHARED_DEMO_MINT_RATE_LIMIT = 60;
export const SHARED_DEMO_EXCHANGE_RATE_LIMIT = 60;
export const SHARED_DEMO_BASELINE_VERSION = 19;
export const SHARED_DEMO_CASHIER_STAFF_CODE = "DEMO-001";
export const SHARED_DEMO_MANAGER_STAFF_CODE = "DEMO-002";
export const SHARED_DEMO_REGISTER_NUMBER = "01";
export const SHARED_DEMO_TIME_ZONE = "America/New_York";
export const SHARED_DEMO_CASH_SEED = {
  openingFloat: 5000,
} as const;

export function calculateSharedDemoExpectedCash({
  openingFloat,
}: {
  openingFloat: number;
}) {
  return openingFloat;
}

type SharedDemoEnvironment = Record<string, string | undefined>;

export function isSharedDemoEnabled(env: SharedDemoEnvironment) {
  return (
    env.ATHENA_SHARED_DEMO_ENABLED === "true" &&
    (env.STAGE === "dev" || env.STAGE === "qa" || env.STAGE === "prod")
  );
}

export function readSharedDemoConfig(env: SharedDemoEnvironment) {
  if (!isSharedDemoEnabled(env)) {
    throw new Error("The demo is unavailable in this environment.");
  }

  const athenaUserId = env.ATHENA_SHARED_DEMO_ATHENA_USER_ID;
  const organizationId = env.ATHENA_SHARED_DEMO_ORGANIZATION_ID;
  const storeId = env.ATHENA_SHARED_DEMO_STORE_ID;
  if (!athenaUserId || !organizationId || !storeId) {
    throw new Error("Demo configuration is incomplete.");
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
