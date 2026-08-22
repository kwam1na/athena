/**
 * Shared seeding helpers for agent-harness tests. Not a Convex function module:
 * it exports plain helpers only, so convex-test loads it without registering
 * anything.
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { budgetVector } from "../../shared/agentHarness/execution";
import {
  createAgentRunWithCtx,
  type CreateAgentRunInput,
} from "./lifecycle";

export const TEST_NOW = 1_700_000_000_000;

export async function seedTenant(ctx: MutationCtx, slug: string) {
  const userId = await ctx.db.insert("athenaUser", { email: `${slug}@test` });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: slug,
    slug,
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    currency: "GHS",
    name: slug,
    organizationId,
    slug,
  });
  return { organizationId, storeId, userId };
}

export function buildRunInput(
  tenant: { storeId: Id<"store">; organizationId: Id<"organization"> },
  overrides: Partial<CreateAgentRunInput> = {},
): CreateAgentRunInput {
  return {
    storeId: tenant.storeId,
    organizationId: tenant.organizationId,
    principalKind: "athenaUser",
    actorRef: "athenaUser:operator-1",
    visibilityMode: "store_admin",
    profileKey: "daily_operations",
    profileVersion: "1",
    packageKeys: ["store_day", "sales"],
    grantDigest: "grant:abc",
    registryDigest: "registry:abc",
    compatibilityDigest: "compat:abc",
    adapterKind: "fake_runtime",
    adapterVersion: "0",
    budgetPolicy: {
      runLimits: budgetVector({
        calls: 5,
        rows: 1_000,
        bytes: 100_000,
        costUnits: 50,
        elapsedMs: 60_000,
      }),
      maxAttempts: 3,
    },
    egressClass: "internal",
    promptPayloadHash: "sha256:prompt",
    runIdempotencyKey: "turn-1",
    now: TEST_NOW,
    ...overrides,
  };
}

export async function seedRun(
  ctx: MutationCtx,
  tenant: { storeId: Id<"store">; organizationId: Id<"organization"> },
  overrides: Partial<CreateAgentRunInput> = {},
) {
  return createAgentRunWithCtx(ctx, buildRunInput(tenant, overrides));
}
