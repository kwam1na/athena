/// <reference types="vite/client" />
/**
 * Deployment state: the durable profile switch is
 * DEFAULT OFF and shrink-only; disabling blocks new turns and cancels active
 * runs of that profile; the one-command pre-deploy fence atomically disables
 * the profile and advances the durable epoch so old-epoch work is denied at
 * every checkpoint and terminalized by the bounded repair; deploy/smoke/
 * rollback failure leaves the profile disabled until the switch is flipped.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { baselineEnablement, evaluateEnablement, type AgentEnablementOverlay } from "./registry";
import {
  SHIFTS_MANIFEST,
  TEST_GRANT_CONFIG,
  TEST_MANIFESTS,
  TEST_NOW_BASE,
  TEST_PROFILE,
  TEST_PROFILE_ID,
  seedDelegatedOperator,
} from "./delegatedAdmission.testPorts";
import {
  cancelActiveRunsForProfileWithCtx,
  describeDeploymentStateWithCtx,
  fenceForDeployWithCtx,
  resolveDurableEnablementWithCtx,
  setProfileEnablementWithCtx,
  setCapabilityEnablementWithCtx,
} from "./deploymentState";
import { prepareDelegatedRunGrantWithCtx } from "./grants";
import {
  agentRunCapability,
  beginProgramAttemptWithCtx,
  getCurrentCompatibilityEpochWithCtx,
  markAgentRunRunningWithCtx,
  repairFencedRunsWithCtx,
} from "./lifecycle";
import { TEST_NOW, seedRun, seedTenant } from "./testSupport";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);
modules["./agentHarness/testPorts.ts"] = modules["./agentHarness/delegatedAdmission.testPorts.ts"];

const BASELINE: AgentEnablementOverlay = baselineEnablement(TEST_MANIFESTS, [TEST_PROFILE]);
const UNPUBLISHED_BASELINE: AgentEnablementOverlay = {
  capabilities: BASELINE.capabilities,
  profiles: { [TEST_PROFILE_ID]: "unpublished" },
};

async function seedProfileRun(ctx: MutationCtx, slug: string, profileKey: string, running = true) {
  const tenant = await seedTenant(ctx, slug);
  const created = await seedRun(ctx, tenant, { profileKey, runIdempotencyKey: `turn-${slug}` });
  if (running) await markAgentRunRunningWithCtx(ctx, { runId: created.runId, now: TEST_NOW });
  return { tenant, ...created };
}

describe("durable profile enablement (default off, shrink only)", () => {
  it("treats a profile without a switch row as disabled even when its published lifecycle is enabled", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const overlay = await resolveDurableEnablementWithCtx(ctx, BASELINE);
      expect(evaluateEnablement(overlay, { profileId: TEST_PROFILE_ID })).toEqual({ ok: false, code: "profile_disabled" });
      // Capabilities keep their published baseline; the profile switch is what gates operator turns.
      expect(overlay.capabilities[SHIFTS_MANIFEST.capabilityId]).toBe("enabled");
      expect(await describeDeploymentStateWithCtx(ctx, BASELINE)).toMatchObject({
        epoch: { epoch: 0, digest: "" },
        profiles: [{ profileId: TEST_PROFILE_ID, baseline: "enabled", switch: "absent", effective: "disabled" }],
      });
    });
  });

  it("enables through the switch, never widens beyond the published baseline, and refuses unknown subjects", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      expect(await setProfileEnablementWithCtx(ctx, BASELINE, { profileId: "ghost", state: "enabled", reason: "test", now: TEST_NOW })).toEqual({ outcome: "unknown_profile", profileId: "ghost" });
      expect(await setProfileEnablementWithCtx(ctx, BASELINE, { profileId: TEST_PROFILE_ID, state: "enabled", reason: "release", actorRef: "athenaUser:ops", now: TEST_NOW })).toMatchObject({ outcome: "updated", effective: "enabled", canceledRuns: 0 });
      expect(evaluateEnablement(await resolveDurableEnablementWithCtx(ctx, BASELINE), { profileId: TEST_PROFILE_ID })).toEqual({ ok: true });
      // The same switch row cannot publish an unpublished profile.
      expect(evaluateEnablement(await resolveDurableEnablementWithCtx(ctx, UNPUBLISHED_BASELINE), { profileId: TEST_PROFILE_ID })).toEqual({ ok: false, code: "profile_unpublished" });
      expect(await setProfileEnablementWithCtx(ctx, BASELINE, { profileId: TEST_PROFILE_ID, state: "enabled", reason: "again", now: TEST_NOW + 1 })).toMatchObject({ outcome: "unchanged", effective: "enabled" });
      // Capability kill switch: shrink only, unknown refused.
      expect(await setCapabilityEnablementWithCtx(ctx, BASELINE, { capabilityId: "cap_ghost", state: "disabled", reason: "x", now: TEST_NOW })).toEqual({ outcome: "unknown_capability", capabilityId: "cap_ghost" });
      expect(await setCapabilityEnablementWithCtx(ctx, BASELINE, { capabilityId: SHIFTS_MANIFEST.capabilityId, state: "disabled", reason: "incident", now: TEST_NOW })).toMatchObject({ outcome: "updated", effective: "disabled" });
      const overlay = await resolveDurableEnablementWithCtx(ctx, BASELINE);
      expect(evaluateEnablement(overlay, { profileId: TEST_PROFILE_ID, capabilityId: SHIFTS_MANIFEST.capabilityId })).toEqual({ ok: false, code: "capability_disabled" });
    });
  });

  it("is what delegated admission reads: a real operator is refused until the switch is on, then granted", async () => {
    const t = convexTest(schema, modules);
    const config = { ...TEST_GRANT_CONFIG, resolveEnablement: (ctx: Parameters<typeof resolveDurableEnablementWithCtx>[0]) => resolveDurableEnablementWithCtx(ctx, BASELINE) };
    await t.run(async (ctx) => {
      const operator = await seedDelegatedOperator(ctx, "switch", { role: "full_admin" });
      const request = { operator: { kind: "normal_user" as const, athenaUserId: operator.userId }, profileId: TEST_PROFILE_ID, organizationId: operator.organizationId, storeId: operator.storeId, now: TEST_NOW_BASE };
      expect(await prepareDelegatedRunGrantWithCtx(ctx, config, request)).toMatchObject({ kind: "refused", stage: "enablement", reason: "profile_disabled" });
      await setProfileEnablementWithCtx(ctx, BASELINE, { profileId: TEST_PROFILE_ID, state: "enabled", reason: "release", now: TEST_NOW_BASE });
      expect(await prepareDelegatedRunGrantWithCtx(ctx, config, request)).toMatchObject({ kind: "prepared" });
      await setProfileEnablementWithCtx(ctx, BASELINE, { profileId: TEST_PROFILE_ID, state: "disabled", reason: "incident", now: TEST_NOW_BASE + 1 });
      expect(await prepareDelegatedRunGrantWithCtx(ctx, config, request)).toMatchObject({ kind: "refused", stage: "enablement", reason: "profile_disabled" });
    });
  });

  it("disabling a profile cancels its active runs (bounded) and leaves other profiles alone", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => ({
      a: await seedProfileRun(ctx, "kill-a", TEST_PROFILE_ID),
      b: await seedProfileRun(ctx, "kill-b", TEST_PROFILE_ID),
      other: await seedProfileRun(ctx, "kill-other", "other_profile"),
      done: await seedProfileRun(ctx, "kill-done", TEST_PROFILE_ID, false),
    }));
    await t.run(async (ctx) => {
      await setProfileEnablementWithCtx(ctx, BASELINE, { profileId: TEST_PROFILE_ID, state: "enabled", reason: "release", now: TEST_NOW });
      const first = await cancelActiveRunsForProfileWithCtx(ctx, { profileId: TEST_PROFILE_ID, now: TEST_NOW + 1, limit: 1 });
      expect(first).toEqual({ canceled: 1, hasMore: true });
      const second = await cancelActiveRunsForProfileWithCtx(ctx, { profileId: TEST_PROFILE_ID, now: TEST_NOW + 1, limit: 10 });
      expect(second).toMatchObject({ canceled: 2, hasMore: false });
      const statuses = await Promise.all([seeded.a, seeded.b, seeded.other, seeded.done].map(async (run) => (await ctx.db.get("intelligenceRun", run.runId))?.status));
      expect(statuses).toEqual(["canceled", "canceled", "running", "canceled"]);
      const canceled = await ctx.db.get("intelligenceRun", seeded.a.runId);
      expect(canceled?.error).toMatchObject({ code: "canceled", diagnostic: "profile_disabled" });
      expect(canceled?.capability).toBe(agentRunCapability(TEST_PROFILE_ID));
    });
  });
});

describe("one-command compatibility fence (scenario 14)", () => {
  it("disables the profile and advances the epoch atomically; old-epoch work is denied and repaired; retry is idempotent", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run(async (ctx) => {
      await setProfileEnablementWithCtx(ctx, BASELINE, { profileId: TEST_PROFILE_ID, state: "enabled", reason: "release", now: TEST_NOW });
      return seedProfileRun(ctx, "fence", TEST_PROFILE_ID);
    });
    await t.run(async (ctx) => {
      // Epoch-only fence first (no profile named): the run stays active and meets the fence at dispatch.
      const fenced = await fenceForDeployWithCtx(ctx, BASELINE, { nextDigest: "compat:next", profileIds: [], reason: "deploy 2", now: TEST_NOW + 1 });
      expect(fenced).toMatchObject({ epoch: { outcome: "advanced", epoch: 1, digest: "compat:next" }, disabledProfiles: [], canceledRuns: 0 });
      expect(await getCurrentCompatibilityEpochWithCtx(ctx)).toEqual({ epoch: 1, digest: "compat:next" });
      expect(await ctx.db.get("intelligenceRun", run.runId)).toMatchObject({ status: "running" });
      // The still-running old-epoch run is denied at the dispatch checkpoint before the repair runs.
      expect(await beginProgramAttemptWithCtx(ctx, { runId: run.runId, attemptIdempotencyKey: "late", programSource: "return 1;", now: TEST_NOW + 2 })).toMatchObject({
        outcome: "denied",
        denial: { code: "compatibility_epoch_fenced" },
      });
      expect(await repairFencedRunsWithCtx(ctx, { now: TEST_NOW + 3 })).toEqual({ canceled: 1, hasMore: false });
      expect(await ctx.db.get("intelligenceRun", run.runId)).toMatchObject({ status: "canceled", error: { code: "compatibility_epoch_fenced" } });
      // A retried fence (now naming the profile) is idempotent on the epoch (same digest → no advance) and disables the profile.
      expect(await fenceForDeployWithCtx(ctx, BASELINE, { nextDigest: "compat:next", profileIds: [TEST_PROFILE_ID], reason: "deploy 2 retry", now: TEST_NOW + 4 })).toMatchObject({
        epoch: { outcome: "unchanged", epoch: 1, digest: "compat:next" },
        disabledProfiles: [TEST_PROFILE_ID],
      });
      expect(evaluateEnablement(await resolveDurableEnablementWithCtx(ctx, BASELINE), { profileId: TEST_PROFILE_ID })).toEqual({ ok: false, code: "profile_disabled" });
    });
  });

  it("does not advance the epoch when the digest is unchanged but still disables the named profiles", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await setProfileEnablementWithCtx(ctx, BASELINE, { profileId: TEST_PROFILE_ID, state: "enabled", reason: "release", now: TEST_NOW });
      const first = await fenceForDeployWithCtx(ctx, BASELINE, { nextDigest: "compat:a", profileIds: [TEST_PROFILE_ID], reason: "deploy a", now: TEST_NOW + 1 });
      expect(first.epoch).toMatchObject({ outcome: "advanced", epoch: 1 });
      await setProfileEnablementWithCtx(ctx, BASELINE, { profileId: TEST_PROFILE_ID, state: "enabled", reason: "smoke passed", now: TEST_NOW + 2 });
      const same = await fenceForDeployWithCtx(ctx, BASELINE, { nextDigest: "compat:a", profileIds: [TEST_PROFILE_ID], reason: "redeploy same", now: TEST_NOW + 3 });
      expect(same).toMatchObject({ epoch: { outcome: "unchanged", epoch: 1, digest: "compat:a" }, disabledProfiles: [TEST_PROFILE_ID] });
      expect(await describeDeploymentStateWithCtx(ctx, BASELINE)).toMatchObject({
        epoch: { epoch: 1, digest: "compat:a" },
        profiles: [{ profileId: TEST_PROFILE_ID, switch: "disabled", effective: "disabled" }],
      });
    });
  });

  it("refuses a fence that names a profile the registry does not know (a typo cannot silently skip the disable)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await expect(fenceForDeployWithCtx(ctx, BASELINE, { nextDigest: "compat:b", profileIds: ["daily_operations_typo"], reason: "deploy", now: TEST_NOW })).resolves.toMatchObject({
        epoch: { outcome: "rejected", reason: "unknown_profile" },
        disabledProfiles: [],
      });
      expect(await getCurrentCompatibilityEpochWithCtx(ctx)).toEqual({ epoch: 0, digest: "" });
    });
  });
});
