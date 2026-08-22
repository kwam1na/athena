/**
 * Deployment state (kernel; V8): the durable profile switch and the
 * one-command compatibility fence.
 *
 * Authority boundary (plan decision 4, R17):
 * - Profiles are DEFAULT OFF. The published baseline (generated registry)
 *   says what MAY be enabled; a durable `agentEnablementSwitch` row says what
 *   IS enabled. The effective state is the narrower of the two, so the switch
 *   can never widen beyond the baseline and an absent row means disabled.
 *   Delegated admission reads this overlay on every check, so flipping
 *   the switch blocks new turns immediately and denies in-flight dispatch,
 *   release, citation, and completion; the bounded cancel sweep then
 *   terminalizes active runs of that profile.
 * - The pre-deploy fence is ONE mutation: disable the named profiles and
 *   advance the durable compatibility epoch from the registry's compatibility
 *   advance plan for the digest the new code carries. Every dispatch/release/completion checkpoint already
 *   compares pinned vs current epoch; the existing repair sweep terminalizes
 *   idle old-epoch runs. Nothing here re-enables: deploy, smoke, or rollback
 *   failure leaves the profile disabled until the switch is flipped on
 *   explicitly (`bun run agent-harness:switch`).
 *
 * This module imports the privileged generated registry for the published
 * baseline (allowlisted in `discovery.test.ts`); nothing model-visible reaches
 * it.
 */
import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { AGENT_RUN_ACTIVE_STATUSES } from "../../shared/agentHarness/execution";
import type { AgentLifecycleState } from "../../shared/agentHarness/values";
import { AGENT_GENERATED_COMPATIBILITY_DIGEST, AGENT_GENERATED_REGISTRY } from "./_generated/registry";
import {
  advanceCompatibilityEpochWithCtx,
  agentRunCapability,
  cancelAgentRunWithCtx,
  getCurrentCompatibilityEpochWithCtx,
  type EpochAdvanceResult,
} from "./lifecycle";
import { planCompatibilityAdvance, type AgentEnablementOverlay } from "./registry";

type ReadCtx = QueryCtx | MutationCtx;
type SwitchState = Doc<"agentEnablementSwitch">["state"];

/** Strictly decreasing access, mirrored from the registry overlay. */
const RANK: { readonly [state in AgentLifecycleState]: number } = { enabled: 2, unpublished: 1, disabled: 0 };

function narrower(baseline: AgentLifecycleState, durable: AgentLifecycleState): AgentLifecycleState {
  return RANK[durable] < RANK[baseline] ? durable : baseline;
}

/** What a profile with no switch row is: off. */
export const AGENT_PROFILE_DEFAULT_SWITCH: SwitchState = "disabled";

const DEFAULT_CANCEL_LIMIT = 50;
const MAX_CANCEL_LIMIT = 200;

// ---------------------------------------------------------------------------
// Switch rows
// ---------------------------------------------------------------------------

async function loadSwitch(ctx: ReadCtx, subjectKind: "profile" | "capability", subjectKey: string) {
  return ctx.db
    .query("agentEnablementSwitch")
    .withIndex("by_subjectKind_subjectKey", (q) => q.eq("subjectKind", subjectKind).eq("subjectKey", subjectKey))
    .unique();
}

/**
 * The live overlay delegated admission's `resolveEnablement` serves: baseline narrowed by the
 * durable switches, with every profile defaulting to disabled.
 */
export async function resolveDurableEnablementWithCtx(ctx: ReadCtx, baseline: AgentEnablementOverlay): Promise<AgentEnablementOverlay> {
  const profiles: Record<string, AgentLifecycleState> = {};
  for (const [profileId, published] of Object.entries(baseline.profiles)) {
    // A published-but-unpublished or published-disabled profile keeps its more
    // specific baseline reason; only an `enabled` baseline consults the switch.
    if (published !== "enabled") {
      profiles[profileId] = published;
      continue;
    }
    const row = await loadSwitch(ctx, "profile", profileId);
    profiles[profileId] = narrower(published, row?.state ?? AGENT_PROFILE_DEFAULT_SWITCH);
  }
  const capabilities: Record<string, AgentLifecycleState> = {};
  for (const [capabilityId, published] of Object.entries(baseline.capabilities)) {
    const row = await loadSwitch(ctx, "capability", capabilityId);
    capabilities[capabilityId] = row ? narrower(published, row.state) : published;
  }
  return { capabilities, profiles };
}

export type AgentProfileSwitchResult =
  | { outcome: "updated" | "unchanged"; profileId: string; effective: AgentLifecycleState; canceledRuns: number }
  | { outcome: "unknown_profile"; profileId: string };

async function writeSwitch(
  ctx: MutationCtx,
  input: { subjectKind: "profile" | "capability"; subjectKey: string; state: SwitchState; reason: string; actorRef?: string; now: number },
): Promise<"updated" | "unchanged"> {
  const row = await loadSwitch(ctx, input.subjectKind, input.subjectKey);
  if (row?.state === input.state) return "unchanged";
  if (row) {
    await ctx.db.patch("agentEnablementSwitch", row._id, { state: input.state, reason: input.reason, updatedByActorRef: input.actorRef, updatedAt: input.now });
  } else {
    await ctx.db.insert("agentEnablementSwitch", {
      subjectKind: input.subjectKind,
      subjectKey: input.subjectKey,
      state: input.state,
      reason: input.reason,
      updatedByActorRef: input.actorRef,
      updatedAt: input.now,
    });
  }
  return "updated";
}

/**
 * Flip one profile. Enabling cannot publish an unpublished profile (the
 * effective state stays the narrower of baseline and switch); disabling also
 * runs one bounded cancel pass over the profile's active runs (the internal
 * mutation continues the sweep).
 */
export async function setProfileEnablementWithCtx(
  ctx: MutationCtx,
  baseline: AgentEnablementOverlay,
  input: { profileId: string; state: SwitchState; reason: string; actorRef?: string; now: number; cancelLimit?: number },
): Promise<AgentProfileSwitchResult> {
  const published = baseline.profiles[input.profileId];
  if (published === undefined) return { outcome: "unknown_profile", profileId: input.profileId };
  const outcome = await writeSwitch(ctx, { subjectKind: "profile", subjectKey: input.profileId, ...input });
  let canceledRuns = 0;
  if (input.state === "disabled") {
    const swept = await cancelActiveRunsForProfileWithCtx(ctx, { profileId: input.profileId, now: input.now, limit: input.cancelLimit });
    canceledRuns = swept.canceled;
  }
  return { outcome, profileId: input.profileId, effective: narrower(published, input.state), canceledRuns };
}

export type AgentCapabilitySwitchResult =
  | { outcome: "updated" | "unchanged"; capabilityId: string; effective: AgentLifecycleState }
  | { outcome: "unknown_capability"; capabilityId: string };

export async function setCapabilityEnablementWithCtx(
  ctx: MutationCtx,
  baseline: AgentEnablementOverlay,
  input: { capabilityId: string; state: SwitchState; reason: string; actorRef?: string; now: number },
): Promise<AgentCapabilitySwitchResult> {
  const published = baseline.capabilities[input.capabilityId];
  if (published === undefined) return { outcome: "unknown_capability", capabilityId: input.capabilityId };
  const outcome = await writeSwitch(ctx, { subjectKind: "capability", subjectKey: input.capabilityId, ...input });
  return { outcome, capabilityId: input.capabilityId, effective: narrower(published, input.state) };
}

// ---------------------------------------------------------------------------
// Kill-switch cancellation (bounded, self-continuing)
// ---------------------------------------------------------------------------

/**
 * Cancel active runs of one profile. Reads a bounded slice of the active-status
 * index (the only global index over active runs) and filters by the run
 * capability; every cancellation removes the run from that index, so repeated
 * passes make progress. Convex allows one `.paginate()` per function, so the
 * scan is a plain bounded `take` of ten times the cancel limit per status.
 */
export async function cancelActiveRunsForProfileWithCtx(
  ctx: MutationCtx,
  input: { profileId: string; now: number; limit?: number },
): Promise<{ canceled: number; hasMore: boolean }> {
  const limit = Math.min(MAX_CANCEL_LIMIT, Math.max(1, input.limit ?? DEFAULT_CANCEL_LIMIT));
  const scanCap = limit * 10;
  const capability = agentRunCapability(input.profileId);
  let canceled = 0;
  for (const status of AGENT_RUN_ACTIVE_STATUSES) {
    const rows = await ctx.db
      .query("intelligenceRun")
      .withIndex("by_status_compatibilityEpoch", (q) => q.eq("status", status).gte("compatibilityEpoch", 0))
      .take(scanCap);
    for (const run of rows) {
      if (run.capability !== capability || run.harnessKind !== "agent") continue;
      const result = await cancelAgentRunWithCtx(ctx, {
        runId: run._id,
        idempotencyKey: `profile-disabled:${input.profileId}:${run._id}`,
        reason: "profile_disabled",
        now: input.now,
      });
      if (result.outcome === "advanced") canceled += 1;
      if (canceled >= limit) return { canceled, hasMore: true };
    }
    if (rows.length === scanCap) return { canceled, hasMore: true };
  }
  return { canceled, hasMore: false };
}

// ---------------------------------------------------------------------------
// The fence
// ---------------------------------------------------------------------------

export type AgentFenceResult = {
  epoch: EpochAdvanceResult | { outcome: "unchanged"; epoch: number; digest: string } | { outcome: "rejected"; reason: "unknown_profile"; epoch: number; digest: string };
  disabledProfiles: string[];
  canceledRuns: number;
};

/**
 * One transaction: disable every named profile (cancelling a bounded batch
 * of its active runs), then advance the durable epoch when the digest of the
 * code about to deploy differs from the digest the current epoch pinned. A
 * retry with the same digest is idempotent (`already_applied`); an unknown
 * profile id rejects the whole fence so a typo cannot leave a profile live.
 */
export async function fenceForDeployWithCtx(
  ctx: MutationCtx,
  baseline: AgentEnablementOverlay,
  input: { nextDigest: string; profileIds?: readonly string[]; reason: string; actorRef?: string; now: number },
): Promise<AgentFenceResult> {
  const current = await getCurrentCompatibilityEpochWithCtx(ctx);
  const profileIds = input.profileIds ?? Object.keys(baseline.profiles);
  const unknown = profileIds.filter((profileId) => baseline.profiles[profileId] === undefined);
  if (unknown.length > 0) {
    return { epoch: { outcome: "rejected", reason: "unknown_profile", epoch: current.epoch, digest: current.digest }, disabledProfiles: [], canceledRuns: 0 };
  }
  const disabledProfiles: string[] = [];
  let canceledRuns = 0;
  for (const profileId of profileIds) {
    const result = await setProfileEnablementWithCtx(ctx, baseline, { profileId, state: "disabled", reason: input.reason, actorRef: input.actorRef, now: input.now });
    if (result.outcome === "unknown_profile") continue;
    disabledProfiles.push(profileId);
    canceledRuns += result.canceledRuns;
  }
  const plan = planCompatibilityAdvance({
    currentEpoch: current.epoch,
    currentDigest: current.digest === "" ? undefined : current.digest,
    nextDigest: input.nextDigest,
  });
  if (!plan.advance) {
    return { epoch: { outcome: "unchanged", epoch: plan.epoch, digest: plan.digest }, disabledProfiles, canceledRuns };
  }
  const epoch = await advanceCompatibilityEpochWithCtx(ctx, {
    epoch: plan.epoch,
    digest: plan.digest,
    idempotencyKey: plan.idempotencyKey,
    reason: input.reason,
    now: input.now,
  });
  return { epoch, disabledProfiles, canceledRuns };
}

// ---------------------------------------------------------------------------
// Description (smoke, investigation)
// ---------------------------------------------------------------------------

export async function describeDeploymentStateWithCtx(ctx: ReadCtx, baseline: AgentEnablementOverlay) {
  const epoch = await getCurrentCompatibilityEpochWithCtx(ctx);
  const overlay = await resolveDurableEnablementWithCtx(ctx, baseline);
  const profiles = [];
  for (const [profileId, published] of Object.entries(baseline.profiles).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const row = await loadSwitch(ctx, "profile", profileId);
    profiles.push({
      profileId,
      baseline: published,
      switch: row ? row.state : ("absent" as const),
      effective: overlay.profiles[profileId],
      ...(row ? { reason: row.reason, updatedAt: row.updatedAt } : {}),
    });
  }
  const capabilities = [];
  for (const [capabilityId, published] of Object.entries(baseline.capabilities).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const row = await loadSwitch(ctx, "capability", capabilityId);
    if (!row) continue;
    capabilities.push({ capabilityId, baseline: published, switch: row.state, effective: overlay.capabilities[capabilityId], reason: row.reason, updatedAt: row.updatedAt });
  }
  return { epoch, profiles, capabilities };
}

// ---------------------------------------------------------------------------
// Internal functions (production baseline = generated registry)
// ---------------------------------------------------------------------------

const PRODUCTION_BASELINE: AgentEnablementOverlay = AGENT_GENERATED_REGISTRY.enablement;

/** `bun run agent-harness:fence` → this, on the deployment about to be replaced. */
export const fenceForDeploy = internalMutation({
  args: {
    nextDigest: v.string(),
    profileIds: v.optional(v.array(v.string())),
    reason: v.string(),
    actorRef: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const result = await fenceForDeployWithCtx(ctx, PRODUCTION_BASELINE, { ...args, now });
    if (result.epoch.outcome === "advanced") {
      await ctx.scheduler.runAfter(0, internal.agentHarness.lifecycle.repairFencedRuns, {});
    }
    for (const profileId of result.disabledProfiles) {
      await ctx.scheduler.runAfter(0, internal.agentHarness.deploymentState.cancelActiveRunsForProfile, { profileId, now });
    }
    return result;
  },
});

/** `bun run agent-harness:switch` → this. */
export const setProfileEnablement = internalMutation({
  args: {
    profileId: v.string(),
    state: v.union(v.literal("enabled"), v.literal("disabled")),
    reason: v.string(),
    actorRef: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const result = await setProfileEnablementWithCtx(ctx, PRODUCTION_BASELINE, { ...args, now });
    if (result.outcome !== "unknown_profile" && args.state === "disabled") {
      await ctx.scheduler.runAfter(0, internal.agentHarness.deploymentState.cancelActiveRunsForProfile, { profileId: args.profileId, now });
    }
    return result;
  },
});

export const setCapabilityEnablement = internalMutation({
  args: {
    capabilityId: v.string(),
    state: v.union(v.literal("enabled"), v.literal("disabled")),
    reason: v.string(),
    actorRef: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => setCapabilityEnablementWithCtx(ctx, PRODUCTION_BASELINE, { ...args, now: args.now ?? Date.now() }),
});

/** Bounded, self-continuing kill-switch sweep. */
export const cancelActiveRunsForProfile = internalMutation({
  args: { profileId: v.string(), now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const result = await cancelActiveRunsForProfileWithCtx(ctx, { profileId: args.profileId, now, limit: args.limit });
    if (result.hasMore) {
      await ctx.scheduler.runAfter(0, internal.agentHarness.deploymentState.cancelActiveRunsForProfile, { profileId: args.profileId, limit: args.limit });
    }
    return result;
  },
});

/** Epoch, digest, switches, and whether the deployed artifact matches the pinned digest (smoke/rollback check). */
export const describeDeploymentState = internalQuery({
  args: {},
  handler: async (ctx) => {
    const described = await describeDeploymentStateWithCtx(ctx, PRODUCTION_BASELINE);
    return {
      ...described,
      deployedDigest: AGENT_GENERATED_COMPATIBILITY_DIGEST,
      deployedMatchesEpoch: described.epoch.digest === AGENT_GENERATED_COMPATIBILITY_DIGEST,
    };
  },
});
