import type { Id } from "../_generated/dataModel";
import { isSharedDemoEnabled, readSharedDemoConfig } from "./config";
import { denySharedDemoAction } from "./policy";

type Environment = Record<string, string | undefined>;

export function requireNonDemoFoundationMutation(
  args: {
    athenaUserId?: Id<"athenaUser">;
    organizationId?: Id<"organization">;
    storeId?: Id<"store">;
  },
  environment: Environment = process.env,
) {
  if (!isSharedDemoEnabled(environment)) return;
  const demo = readSharedDemoConfig(environment);
  if (
    args.athenaUserId === demo.athenaUserId ||
    args.organizationId === demo.organizationId ||
    args.storeId === demo.storeId
  ) {
    denySharedDemoAction();
  }
}

export function requireNonDemoFoundationExternalRefs(
  refs: string[],
  environment: Environment = process.env,
) {
  if (!isSharedDemoEnabled(environment)) return;
  const demo = readSharedDemoConfig(environment);
  if (refs.some((ref) => ref.includes(`/stores/${demo.storeId}/`))) {
    denySharedDemoAction();
  }
}
