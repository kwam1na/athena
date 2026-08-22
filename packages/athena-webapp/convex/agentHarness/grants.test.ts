/// <reference types="vite/client" />

/**
 * Run grants: materialization with delegated provenance, reauthorization
 * against current authority plus the live shrink overlay, and the
 * grant-filtered discovery input (ticket V26-1262).
 */
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import { advanceCompatibilityEpochWithCtx, markAgentRunRunningWithCtx } from "./lifecycle";
import {
  AUDIT_TRAIL_MANIFEST,
  SHIFTS_MANIFEST,
  STORE_DAY_MANIFEST,
  TEST_CLOCK,
  TEST_ENABLEMENT,
  TEST_GRANT_CONFIG,
  TEST_NOW_BASE,
  TEST_PROFILE_ID,
  TEST_REGISTRY,
  seedDelegatedOperator,
} from "./delegatedAdmission.testPorts";
import {
  deriveAuthorityTier,
  describeGrantForModel,
  encodeDelegatedActorRef,
  materializeRunGrantWithCtx,
  parseDelegatedActorRef,
  reauthorizeGrantWithCtx,
  type DelegatedAuthorityVerdict,
} from "./grants";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);
modules["./agentHarness/testPorts.ts"] = modules["./agentHarness/delegatedAdmission.testPorts.ts"];

type Operator = Awaited<ReturnType<typeof seedDelegatedOperator>>;

function materializeFor(operator: Operator, overrides: { now?: number; key?: string } = {}) {
  return {
    operator: { kind: "normal_user" as const, athenaUserId: operator.userId },
    profileId: TEST_PROFILE_ID,
    organizationId: operator.organizationId,
    storeId: operator.storeId,
    promptPayloadHash: "sha256:prompt",
    runIdempotencyKey: overrides.key ?? "turn-1",
    now: overrides.now ?? TEST_NOW_BASE,
  };
}

function authorized(verdict: DelegatedAuthorityVerdict) {
  if (verdict.kind !== "authorized") {
    throw new Error(`expected authorized, got ${verdict.kind}: ${JSON.stringify(verdict)}`);
  }
  return verdict;
}

function refused(verdict: DelegatedAuthorityVerdict) {
  if (verdict.kind !== "refused") throw new Error(`expected refused, got ${verdict.kind}`);
  return verdict;
}

beforeEach(() => {
  TEST_ENABLEMENT.reset();
  TEST_CLOCK.now = TEST_NOW_BASE;
});

describe("role to authority tier", () => {
  it("maps Athena membership onto the SDK tiers without inventing roles", () => {
    expect(deriveAuthorityTier({ membershipRole: "full_admin", operationalRoles: [] })).toBe("full_admin");
    expect(deriveAuthorityTier({ membershipRole: "pos_only", operationalRoles: ["manager"] })).toBe("manager");
    expect(deriveAuthorityTier({ membershipRole: "pos_only", operationalRoles: ["cashier"] })).toBe("member");
    expect(deriveAuthorityTier({ membershipRole: "pos_only", operationalRoles: [] })).toBe("member");
  });

  it("round-trips the delegated actor ref and never embeds a bare document id", () => {
    const ref = encodeDelegatedActorRef({ kind: "shared_demo", athenaUserId: "abc" as never });
    expect(ref).toBe("sharedDemo:abc");
    expect(parseDelegatedActorRef(ref)).toEqual({ kind: "shared_demo", athenaUserId: "abc" });
    expect(parseDelegatedActorRef("athenaUser:xyz")).toEqual({ kind: "normal_user", athenaUserId: "xyz" });
    expect(parseDelegatedActorRef("system:nobody")).toBeNull();
  });
});

describe("run grant materialization", () => {
  it("pins delegated provenance, the projected capability and field set, digests, and the epoch", async () => {
    const t = convexTest(schema, modules);
    const { grant, run, outcome } = await t.run(async (ctx) => {
      const admin = await seedDelegatedOperator(ctx, "alpha", { role: "full_admin" });
      const outcome = await materializeRunGrantWithCtx(ctx, TEST_GRANT_CONFIG, materializeFor(admin));
      if (outcome.kind !== "materialized") throw new Error(JSON.stringify(outcome));
      return {
        outcome,
        grant: (await ctx.db.get("agentRunGrant", outcome.grantId)) as Doc<"agentRunGrant">,
        run: (await ctx.db.get("intelligenceRun", outcome.runId)) as Doc<"intelligenceRun">,
      };
    });

    expect(grant.grantKind).toBe("agent_delegation");
    expect(grant.registryDigest).toBe(TEST_REGISTRY.registryDigest);
    expect(grant.compatibilityDigest).toBe(TEST_REGISTRY.compatibilityDigest);
    expect(grant.grantDigest).toBe(outcome.projection.grantDigest);
    expect(grant.profileKey).toBe(TEST_PROFILE_ID);
    expect(grant.packageKeys).toEqual(["ops"]);
    expect(grant.compatibilityEpoch).toBe(0);
    expect(grant.adapterKind).toBe("athena_contract_fake");
    expect(grant.budgetPolicy.runLimits.calls).toBe(8);
    expect(grant.egressClass).toBe("sensitive");
    expect(run.actorRef).toBe(encodeDelegatedActorRef({ kind: "normal_user", athenaUserId: grant.delegation!.athenaUserId }));
    expect(run.visibilityMode).toBe("store_admin");

    const delegation = grant.delegation!;
    expect(delegation.operatorKind).toBe("normal_user");
    expect(delegation.membershipRole).toBe("full_admin");
    expect(delegation.authorityTier).toBe("full_admin");
    expect(delegation.heldReadIntents).toContain("daily_operations.view");
    expect(delegation.heldReadIntents).toContain("reports.view");
    expect(delegation.capabilityIds).toEqual(
      [SHIFTS_MANIFEST.capabilityId, STORE_DAY_MANIFEST.capabilityId, AUDIT_TRAIL_MANIFEST.capabilityId].sort(),
    );
    expect(delegation.grantedProjectionsByCapability[SHIFTS_MANIFEST.capabilityId]).toEqual(["financials", "managerNotes"]);
    expect(delegation.authorizationEpoch).toBe(0);
    expect(delegation.authorizedAt).toBe(TEST_NOW_BASE);
    expect(delegation.admissionPolicyVersion).toBe(TEST_REGISTRY.protocolVersions.admissionPolicy);
  });

  it("projects a POS-only operator to a narrower grant: member tier, no reports intent, no financial projections", async () => {
    const t = convexTest(schema, modules);
    const grant = await t.run(async (ctx) => {
      const cashier = await seedDelegatedOperator(ctx, "beta", { role: "pos_only", operationalRoles: ["cashier"] });
      const outcome = await materializeRunGrantWithCtx(ctx, TEST_GRANT_CONFIG, materializeFor(cashier));
      if (outcome.kind !== "materialized") throw new Error(JSON.stringify(outcome));
      return (await ctx.db.get("agentRunGrant", outcome.grantId)) as Doc<"agentRunGrant">;
    });
    const delegation = grant.delegation!;
    expect(delegation.authorityTier).toBe("member");
    expect(delegation.heldReadIntents).not.toContain("reports.view");
    expect(delegation.capabilityIds).toEqual([SHIFTS_MANIFEST.capabilityId, STORE_DAY_MANIFEST.capabilityId].sort());
    expect(delegation.grantedProjectionsByCapability[SHIFTS_MANIFEST.capabilityId]).toEqual([]);
    expect(grant.egressClass).toBe("operational");
  });

  it("refuses an operator with no membership, a store outside the organization, and an unknown profile — typed, no run created", async () => {
    const t = convexTest(schema, modules);
    const outcomes = await t.run(async (ctx) => {
      const stranger = await seedDelegatedOperator(ctx, "gamma", null);
      const other = await seedDelegatedOperator(ctx, "delta", { role: "full_admin" });
      const noMembership = await materializeRunGrantWithCtx(ctx, TEST_GRANT_CONFIG, materializeFor(stranger));
      const foreignStore = await materializeRunGrantWithCtx(ctx, TEST_GRANT_CONFIG, {
        ...materializeFor(other),
        storeId: stranger.storeId,
      });
      const unknownProfile = await materializeRunGrantWithCtx(ctx, TEST_GRANT_CONFIG, {
        ...materializeFor(other),
        profileId: "does_not_exist",
      });
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test assertion over a tiny table
      const runs = await ctx.db.query("intelligenceRun").collect();
      return { noMembership, foreignStore, unknownProfile, runs: runs.length };
    });
    expect(outcomes.noMembership).toMatchObject({ kind: "refused", stage: "operator", reason: "membership_revoked" });
    expect(outcomes.foreignStore).toMatchObject({ kind: "refused", stage: "operator", reason: "store_out_of_scope" });
    expect(outcomes.unknownProfile).toMatchObject({ kind: "refused", stage: "enablement", reason: "profile_unknown" });
    expect(outcomes.runs).toBe(0);
  });

  it("refuses a disabled profile through the live overlay before any run is created", async () => {
    const t = convexTest(schema, modules);
    TEST_ENABLEMENT.narrow({ profiles: { [TEST_PROFILE_ID]: "disabled" } });
    const outcome = await t.run(async (ctx) => {
      const admin = await seedDelegatedOperator(ctx, "alpha", { role: "full_admin" });
      return materializeRunGrantWithCtx(ctx, TEST_GRANT_CONFIG, materializeFor(admin));
    });
    expect(outcome).toMatchObject({ kind: "refused", stage: "enablement", reason: "profile_disabled" });
  });

  it("materializes a shared-demo operator clamped to the demo scope and the demo read-intent grant", async () => {
    const t = convexTest(schema, modules);
    const { grant, expired } = await t.run(async (ctx) => {
      const demo = await seedDelegatedOperator(ctx, "demo", { role: "full_admin", operationalRoles: ["manager"] });
      const authUserId = await ctx.db.insert("users", { email: "demo@test" });
      await ctx.db.insert("sharedDemoPrincipal", {
        authUserId,
        athenaUserId: demo.userId,
        organizationId: demo.organizationId,
        storeId: demo.storeId,
        admissionExpiresAt: TEST_NOW_BASE + 60_000,
        updatedAt: TEST_NOW_BASE,
      });
      const outcome = await materializeRunGrantWithCtx(ctx, TEST_GRANT_CONFIG, {
        ...materializeFor(demo),
        operator: { kind: "shared_demo", athenaUserId: demo.userId, authUserId },
      });
      if (outcome.kind !== "materialized") throw new Error(JSON.stringify(outcome));
      const grant = (await ctx.db.get("agentRunGrant", outcome.grantId)) as Doc<"agentRunGrant">;
      const expired = await materializeRunGrantWithCtx(ctx, TEST_GRANT_CONFIG, {
        ...materializeFor(demo, { key: "turn-2", now: TEST_NOW_BASE + 120_000 }),
        operator: { kind: "shared_demo", athenaUserId: demo.userId, authUserId },
      });
      return { grant, expired };
    });
    const delegation = grant.delegation!;
    expect(delegation.operatorKind).toBe("shared_demo");
    expect(delegation.heldReadIntents).toContain("daily_operations.view");
    // `reports.view` is demo-granted; `platform.health.view` is not and a demo never holds it.
    expect(delegation.heldReadIntents).toContain("reports.view");
    expect(delegation.heldReadIntents).not.toContain("platform.health.view");
    expect(delegation.authorityTier).toBe("full_admin");
    expect(expired).toMatchObject({ kind: "refused", stage: "operator", reason: "session_expired" });
  });
});

describe("grant reauthorization", () => {
  async function seedRunningGrant(
    t: ReturnType<typeof convexTest>,
    membership: { role: "full_admin" | "pos_only"; operationalRoles?: ("manager" | "cashier")[] } = { role: "full_admin" },
  ) {
    return t.run(async (ctx) => {
      const operator = await seedDelegatedOperator(ctx, "alpha", membership);
      const outcome = await materializeRunGrantWithCtx(ctx, TEST_GRANT_CONFIG, materializeFor(operator));
      if (outcome.kind !== "materialized") throw new Error(JSON.stringify(outcome));
      await markAgentRunRunningWithCtx(ctx, { runId: outcome.runId, now: TEST_NOW_BASE });
      return { operator, runId: outcome.runId, grantId: outcome.grantId };
    });
  }

  it("authorizes a live run for dispatch with the pinned grant and the current authority", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seedRunningGrant(t);
    const verdict = await t.run((ctx) =>
      reauthorizeGrantWithCtx(ctx, TEST_GRANT_CONFIG, {
        runId,
        purpose: "dispatch",
        capabilityId: SHIFTS_MANIFEST.capabilityId,
        requestedProjections: ["financials"],
        now: TEST_NOW_BASE + 1,
      }),
    );
    const ok = authorized(verdict);
    expect(ok.grantedProjections).toEqual(["financials", "managerNotes"]);
    expect(ok.scope).toMatchObject({ kind: "store" });
    expect(ok.authorityShrunk).toBe(false);
    expect(ok.authorizationEpoch).toBe(0);
    expect(describeGrantForModel(ok)).toMatchObject({
      profileId: TEST_PROFILE_ID,
      capabilityIds: [AUDIT_TRAIL_MANIFEST.capabilityId, SHIFTS_MANIFEST.capabilityId, STORE_DAY_MANIFEST.capabilityId].sort(),
      grantDigest: expect.any(String),
    });
  });

  it("denies immediately after membership revocation, store re-scoping, capability disable, and run cancellation", async () => {
    const t = convexTest(schema, modules);
    const { operator, runId } = await seedRunningGrant(t);
    const reauth = (now: number) =>
      t.run((ctx) =>
        reauthorizeGrantWithCtx(ctx, TEST_GRANT_CONFIG, {
          runId,
          purpose: "dispatch",
          capabilityId: SHIFTS_MANIFEST.capabilityId,
          now,
        }),
      );

    // 1. Disabled capability: the overlay denies even though the grant pins it.
    TEST_ENABLEMENT.narrow({ capabilities: { [SHIFTS_MANIFEST.capabilityId]: "disabled" } });
    expect(refused(await reauth(TEST_NOW_BASE + 1))).toMatchObject({
      stage: "enablement",
      result: { kind: "unauthorized", code: "capability_disabled" },
    });
    TEST_ENABLEMENT.reset();
    expect((await reauth(TEST_NOW_BASE + 2)).kind).toBe("authorized");

    // 2. Narrowed store scope: the store now belongs to another organization.
    const otherOrganizationId = await t.run(async (ctx) => {
      const other = await seedDelegatedOperator(ctx, "other", { role: "full_admin" });
      await ctx.db.patch("store", operator.storeId, { organizationId: other.organizationId });
      return other.organizationId;
    });
    expect(refused(await reauth(TEST_NOW_BASE + 3))).toMatchObject({
      stage: "operator",
      reason: "store_out_of_scope",
      result: { kind: "unauthorized", code: "unauthorized_scope" },
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("store", operator.storeId, { organizationId: operator.organizationId });
    });
    expect(otherOrganizationId).not.toBe(operator.organizationId);
    expect((await reauth(TEST_NOW_BASE + 4)).kind).toBe("authorized");

    // 3. Revoked membership.
    await t.run(async (ctx) => {
      await ctx.db.delete("organizationMember", operator.membershipId!);
    });
    expect(refused(await reauth(TEST_NOW_BASE + 5))).toMatchObject({
      stage: "operator",
      reason: "membership_revoked",
      result: { kind: "unauthorized", code: "unauthorized_scope" },
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("organizationMember", { organizationId: operator.organizationId, userId: operator.userId, role: "full_admin" });
    });
    expect((await reauth(TEST_NOW_BASE + 6)).kind).toBe("authorized");

    // 4. Canceled run.
    await t.run(async (ctx) => {
      const { cancelAgentRunWithCtx } = await import("./lifecycle");
      await cancelAgentRunWithCtx(ctx, { runId, idempotencyKey: "cancel-1", reason: "operator", now: TEST_NOW_BASE + 7 });
    });
    expect(refused(await reauth(TEST_NOW_BASE + 8))).toMatchObject({
      stage: "run",
      result: { kind: "denied", code: "run_not_running" },
    });
  });

  it("shrinks but never widens: a demotion narrows projections, a promotion does not add them", async () => {
    const t = convexTest(schema, modules);
    const { operator, runId } = await seedRunningGrant(t, { role: "full_admin" });
    // Demotion to POS-only after the grant was pinned with financials.
    await t.run(async (ctx) => {
      await ctx.db.patch("organizationMember", operator.membershipId!, { role: "pos_only", operationalRoles: ["cashier"] });
    });
    const demoted = authorized(
      await t.run((ctx) =>
        reauthorizeGrantWithCtx(ctx, TEST_GRANT_CONFIG, {
          runId,
          purpose: "release",
          capabilityId: SHIFTS_MANIFEST.capabilityId,
          now: TEST_NOW_BASE + 1,
        }),
      ),
    );
    expect(demoted.grantedProjections).toEqual([]);
    expect(demoted.authorityShrunk).toBe(true);
    expect(describeGrantForModel(demoted).capabilityIds).not.toContain(AUDIT_TRAIL_MANIFEST.capabilityId);
    // Requesting the pinned projection after the shrink is unauthorized, not zeroed.
    expect(
      refused(
        await t.run((ctx) =>
          reauthorizeGrantWithCtx(ctx, TEST_GRANT_CONFIG, {
            runId,
            purpose: "dispatch",
            capabilityId: SHIFTS_MANIFEST.capabilityId,
            requestedProjections: ["financials"],
            now: TEST_NOW_BASE + 2,
          }),
        ),
      ),
    ).toMatchObject({ stage: "projection", result: { kind: "unauthorized", code: "unauthorized_projection" } });

    // Promotion: a POS-only grant does not gain financials when the member becomes a full admin mid-run.
    const cashierRun = await t.run(async (ctx) => {
      const cashier = await seedDelegatedOperator(ctx, "cashier", { role: "pos_only" });
      const outcome = await materializeRunGrantWithCtx(ctx, TEST_GRANT_CONFIG, materializeFor(cashier, { key: "turn-c" }));
      if (outcome.kind !== "materialized") throw new Error(JSON.stringify(outcome));
      await markAgentRunRunningWithCtx(ctx, { runId: outcome.runId, now: TEST_NOW_BASE });
      await ctx.db.patch("organizationMember", cashier.membershipId!, { role: "full_admin" });
      return outcome.runId;
    });
    const promoted = authorized(
      await t.run((ctx) =>
        reauthorizeGrantWithCtx(ctx, TEST_GRANT_CONFIG, {
          runId: cashierRun,
          purpose: "dispatch",
          capabilityId: SHIFTS_MANIFEST.capabilityId,
          now: TEST_NOW_BASE + 3,
        }),
      ),
    );
    expect(promoted.grantedProjections).toEqual([]);
    expect(describeGrantForModel(promoted).capabilityIds).not.toContain(AUDIT_TRAIL_MANIFEST.capabilityId);
    expect(promoted.authorityShrunk).toBe(false);
  });

  it("fences a run pinned to an older compatibility epoch and a grant whose digests no longer match the registry", async () => {
    const t = convexTest(schema, modules);
    const { runId, grantId } = await seedRunningGrant(t);
    await t.run((ctx) =>
      advanceCompatibilityEpochWithCtx(ctx, { epoch: 1, digest: "fnv1a64:next", idempotencyKey: "advance-1", now: TEST_NOW_BASE }),
    );
    expect(
      refused(await t.run((ctx) => reauthorizeGrantWithCtx(ctx, TEST_GRANT_CONFIG, { runId, purpose: "completion", now: TEST_NOW_BASE + 1 }))),
    ).toMatchObject({ stage: "fence", result: { kind: "denied", code: "compatibility_epoch_fenced" } });

    const t2 = convexTest(schema, modules);
    const second = await seedRunningGrant(t2);
    await t2.run(async (ctx) => {
      await ctx.db.patch("agentRunGrant", second.grantId, { registryDigest: "fnv1a64:stale" });
    });
    expect(
      refused(
        await t2.run((ctx) => reauthorizeGrantWithCtx(ctx, TEST_GRANT_CONFIG, { runId: second.runId, purpose: "dispatch", now: TEST_NOW_BASE + 1 })),
      ),
    ).toMatchObject({ stage: "registry", result: { kind: "denied", code: "compatibility_epoch_fenced" } });
    expect(grantId).toBeDefined();
  });

  it("fails closed on a grant with no delegation record or a tampered pinned projection", async () => {
    const t = convexTest(schema, modules);
    const { runId, grantId } = await seedRunningGrant(t);
    await t.run(async (ctx) => {
      const grant = (await ctx.db.get("agentRunGrant", grantId)) as Doc<"agentRunGrant">;
      await ctx.db.patch("agentRunGrant", grantId, {
        delegation: { ...grant.delegation!, capabilityIds: [...grant.delegation!.capabilityIds, "cap_forged"] },
      });
    });
    expect(
      refused(await t.run((ctx) => reauthorizeGrantWithCtx(ctx, TEST_GRANT_CONFIG, { runId, purpose: "dispatch", now: TEST_NOW_BASE + 1 }))),
    ).toMatchObject({ stage: "integrity" });

    await t.run(async (ctx) => {
      await ctx.db.patch("agentRunGrant", grantId, { delegation: undefined });
    });
    expect(
      refused(await t.run((ctx) => reauthorizeGrantWithCtx(ctx, TEST_GRANT_CONFIG, { runId, purpose: "dispatch", now: TEST_NOW_BASE + 2 }))),
    ).toMatchObject({ stage: "run", reason: "delegation_missing" });
  });
});
