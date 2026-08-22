/**
 * Agent harness retention, evidence access, scope removal, and sweeps.
 *
 * Authority boundary: this module owns the two retention classes
 * (`short_lived` 30 days, `standard` 365 days) for harness content, the
 * bounded cursor-free batch pattern Athena already uses for marketing
 * retention (index range + `take(limit)` + self-continuation), the narrow
 * store/organization removal hooks, the retryable runtime-adapter cleanup
 * hook keyed by the turn binding, and audited evidence access. It deletes
 * content rows; it never rewrites audit metadata (grant hashes, citation
 * provenance) — those only gain lifecycle markers. Runtime-native cleanup is
 * delegated to a registered adapter hook; a missing hook fails closed and
 * retries rather than pretending the runtime was cleaned.
 */
import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import {
  computeContentDigest,
  denial,
  evaluateEvidencePayloadSize,
  isTerminalRunStatus,
  measureJsonByteLength,
  resolveEvidenceState,
  retentionExpiresAt,
  type AgentEvidenceState,
  type AgentHarnessDenial,
} from "../../shared/agentHarness/execution";
import { intelligencePrincipalKindValidator } from "../schemas/intelligence";
import {
  cancelAgentRunWithCtx,
  recoverStaleAttemptsWithCtx,
  repairFencedRunsWithCtx,
} from "./lifecycle";
import { ensureConvexAgentRuntimeCleanupRegistered } from "./runtimeRetention";
import { sweepStaleTurnBindingsWithCtx } from "./turnBindings";

export const AGENT_RUNTIME_CLEANUP_BACKOFF_MS = [
  60_000,
  10 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const;
export const AGENT_NOOP_ADAPTER_KIND = "athena_noop";
/** Rows per table per scope-removal pass; a full batch schedules another. */
export const AGENT_SCOPE_DELETE_BATCH_SIZE = 50;
const DEFAULT_SWEEP_LIMIT = 100;
const MAX_SWEEP_LIMIT = 200;

// ---------------------------------------------------------------------------
// Runtime adapter cleanup hook (implemented by the Convex Agent adapter later)
// ---------------------------------------------------------------------------

export type AgentRuntimeCleanupDescriptor = {
  bindingId: Id<"agentTurnBinding">;
  runId: Id<"intelligenceRun">;
  storeId: Id<"store">;
  organizationId: Id<"organization">;
  adapterKind: string;
  adapterVersion: string;
  runtimeThreadRef?: string;
  runtimeInputRef?: string;
  runtimeProjectionRef?: string;
  attempt: number;
};

export type AgentRuntimeCleanupResult =
  | { ok: true }
  | { ok: false; retryable: boolean; error: string };

export type AgentRuntimeCleanupHook = (
  ctx: MutationCtx,
  descriptor: AgentRuntimeCleanupDescriptor,
) => Promise<AgentRuntimeCleanupResult>;

const noopHook: AgentRuntimeCleanupHook = async () => ({ ok: true });
const cleanupHooks = new Map<string, AgentRuntimeCleanupHook>([[AGENT_NOOP_ADAPTER_KIND, noopHook]]);

/** Register the cleanup hook for an adapter kind. Returns an unregister fn. */
export function registerAgentRuntimeCleanupHook(
  adapterKind: string,
  hook: AgentRuntimeCleanupHook,
): () => void {
  cleanupHooks.set(adapterKind, hook);
  return () => {
    if (cleanupHooks.get(adapterKind) === hook) cleanupHooks.delete(adapterKind);
  };
}

export function resetAgentRuntimeCleanupHooksForTests() {
  cleanupHooks.clear();
  cleanupHooks.set(AGENT_NOOP_ADAPTER_KIND, noopHook);
}

export function hasAgentRuntimeCleanupHook(adapterKind: string): boolean {
  return cleanupHooks.has(adapterKind);
}

function backoffForAttempt(attempt: number): number {
  const index = Math.min(Math.max(attempt - 1, 0), AGENT_RUNTIME_CLEANUP_BACKOFF_MS.length - 1);
  return AGENT_RUNTIME_CLEANUP_BACKOFF_MS[index];
}

async function attemptRuntimeCleanupWithCtx(
  ctx: MutationCtx,
  binding: Doc<"agentTurnBinding">,
  now: number,
): Promise<"succeeded" | "failed"> {
  const attempt = binding.runtimeCleanupAttempts + 1;
  // Production adapter hooks register lazily (V26-1265): the Convex Agent hook
  // is bound here, in the same isolate the sweep runs in, before the lookup.
  ensureConvexAgentRuntimeCleanupRegistered();
  const hook = cleanupHooks.get(binding.adapterKind);
  let result: AgentRuntimeCleanupResult;
  if (!hook) {
    result = { ok: false, retryable: true, error: "no_cleanup_hook_registered" };
  } else {
    try {
      result = await hook(ctx, {
        bindingId: binding._id,
        runId: binding.runId,
        storeId: binding.storeId,
        organizationId: binding.organizationId,
        adapterKind: binding.adapterKind,
        adapterVersion: binding.adapterVersion,
        runtimeThreadRef: binding.runtimeThreadRef,
        runtimeInputRef: binding.runtimeInputRef,
        runtimeProjectionRef: binding.runtimeProjectionRef,
        attempt,
      });
    } catch (error) {
      result = {
        ok: false,
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (result.ok) {
    await ctx.db.patch("agentTurnBinding", binding._id, {
      runtimeCleanupStatus: "succeeded",
      runtimeCleanupAttempts: attempt,
      runtimeCleanupCompletedAt: now,
      runtimeCleanupNextAttemptAt: undefined,
      runtimeCleanupLastError: undefined,
      updatedAt: now,
    });
    return "succeeded";
  }
  await ctx.db.patch("agentTurnBinding", binding._id, {
    runtimeCleanupStatus: "failed",
    runtimeCleanupAttempts: attempt,
    runtimeCleanupLastError: result.error,
    runtimeCleanupNextAttemptAt: result.retryable ? now + backoffForAttempt(attempt) : undefined,
    updatedAt: now,
  });
  return "failed";
}

/** Ask the adapter to clean a turn now; failures are retried by the sweep. */
export async function requestRuntimeCleanupWithCtx(
  ctx: MutationCtx,
  bindingId: Id<"agentTurnBinding">,
  now: number,
): Promise<"succeeded" | "failed" | "already_succeeded" | "missing"> {
  const binding = await ctx.db.get("agentTurnBinding", bindingId);
  if (!binding) return "missing";
  if (binding.runtimeCleanupStatus === "succeeded") return "already_succeeded";
  return attemptRuntimeCleanupWithCtx(ctx, binding, now);
}

/** Retry every due cleanup (first request at short-lived expiry, then backoff). */
export async function runRuntimeCleanupBatchWithCtx(
  ctx: MutationCtx,
  input: { now: number; limit?: number },
): Promise<{ attempted: number; succeeded: number; failed: number; hasMore: boolean }> {
  const limit = Math.min(MAX_SWEEP_LIMIT, Math.max(1, input.limit ?? DEFAULT_SWEEP_LIMIT));
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let hasMore = false;
  for (const status of ["not_requested", "pending", "failed"] as const) {
    const remaining = limit - attempted;
    if (remaining <= 0) {
      hasMore = true;
      break;
    }
    // `gte(0)` excludes bindings with no scheduled attempt (non-retryable).
    const bindings = await ctx.db
      .query("agentTurnBinding")
      .withIndex("by_runtimeCleanupStatus_runtimeCleanupNextAttemptAt", (q) =>
        q.eq("runtimeCleanupStatus", status).gte("runtimeCleanupNextAttemptAt", 0).lte("runtimeCleanupNextAttemptAt", input.now),
      )
      .take(remaining);
    for (const binding of bindings) {
      attempted += 1;
      const outcome = await attemptRuntimeCleanupWithCtx(ctx, binding, input.now);
      if (outcome === "succeeded") succeeded += 1;
      else failed += 1;
    }
    if (bindings.length === remaining) hasMore = true;
  }
  return { attempted, succeeded, failed, hasMore };
}

// ---------------------------------------------------------------------------
// Scratch descriptors (short-lived, bounded)
// ---------------------------------------------------------------------------

export async function recordScratchDescriptorWithCtx(
  ctx: MutationCtx,
  input: {
    runId: Id<"intelligenceRun">;
    attemptId?: Id<"agentProgramAttempt">;
    scratchKey: string;
    content: unknown;
    now: number;
  },
): Promise<
  | { outcome: "recorded"; descriptorId: Id<"agentScratchDescriptor">; contentHash: string }
  | { outcome: "rejected"; denial: AgentHarnessDenial }
> {
  const run = await ctx.db.get("intelligenceRun", input.runId);
  if (!run || !run.storeId || !run.organizationId) {
    return { outcome: "rejected", denial: denial("run_not_found", "The run does not exist.") };
  }
  if (isTerminalRunStatus(run.status)) {
    return { outcome: "rejected", denial: denial("run_terminal", "The run has already ended.") };
  }
  const byteLength = measureJsonByteLength(input.content);
  if (!evaluateEvidencePayloadSize(byteLength).withinCeiling) {
    return { outcome: "rejected", denial: denial("evidence_payload_exceeds_ceiling", "Scratch content is too large.", { detail: { byteLength } }) };
  }
  const contentHash = computeContentDigest(input.content);
  const existing = await ctx.db
    .query("agentScratchDescriptor")
    .withIndex("by_runId_scratchKey", (q) => q.eq("runId", run._id).eq("scratchKey", input.scratchKey))
    .unique();
  if (existing) {
    await ctx.db.patch("agentScratchDescriptor", existing._id, {
      attemptId: input.attemptId ?? existing.attemptId,
      contentHash,
      byteLength,
      content: input.content,
      updatedAt: input.now,
    });
    return { outcome: "recorded", descriptorId: existing._id, contentHash };
  }
  const descriptorId = await ctx.db.insert("agentScratchDescriptor", {
    runId: run._id,
    attemptId: input.attemptId,
    storeId: run.storeId,
    organizationId: run.organizationId,
    scratchKey: input.scratchKey,
    contentHash,
    byteLength,
    content: input.content,
    retentionClass: "short_lived",
    expiresAt: retentionExpiresAt("short_lived", input.now),
    createdAt: input.now,
    updatedAt: input.now,
  });
  return { outcome: "recorded", descriptorId, contentHash };
}

// ---------------------------------------------------------------------------
// Audited evidence access (AE6)
// ---------------------------------------------------------------------------

export type CitationEvidenceView = {
  state: AgentEvidenceState;
  auditId: Id<"agentEvidenceAccessAudit">;
  citation: {
    citationBindingId: Id<"agentCitationBinding">;
    citationKey: string;
    runId: Id<"intelligenceRun">;
    attemptId: Id<"agentProgramAttempt">;
    callId: Id<"agentCapabilityCall">;
    artifactId: Id<"intelligenceArtifact">;
    resultHash: string;
    claimDigest?: string;
    sourceRef: Doc<"agentCitationBinding">["sourceRef"];
    capabilityId?: string;
    normalizedArgsHash?: string;
    normalizedArgs?: Record<string, unknown>;
    observedAt?: number;
    capturedAt?: number;
    freshness?: string;
    completeness?: string;
    sourceRefCount?: number;
    claimSupport?: { extractorKey: string; extractorVersion: string; slice: Record<string, unknown> };
    immutableRevisionRef?: string;
  };
};

/**
 * Resolve one citation's evidence for an already-authorized viewer and write
 * the access audit in the same transaction. The caller reauthorizes the
 * viewer (store/role/visibility) before calling; this records who looked and
 * what state they saw.
 */
export async function readCitationEvidenceWithCtx(
  ctx: MutationCtx,
  input: {
    citationBindingId: Id<"agentCitationBinding">;
    viewer: { principalKind: Doc<"agentEvidenceAccessAudit">["viewerPrincipalKind"]; actorRef: string };
    purpose: string;
    now: number;
  },
): Promise<CitationEvidenceView | null> {
  const binding = await ctx.db.get("agentCitationBinding", input.citationBindingId);
  if (!binding) return null;
  const claimSupport = binding.claimSupportId ? await ctx.db.get("agentClaimSupport", binding.claimSupportId) : null;
  const replay = binding.replayPayloadId ? await ctx.db.get("agentReplayPayload", binding.replayPayloadId) : null;
  const state = resolveEvidenceState({
    lifecycle: binding.evidenceLifecycle,
    claimSupportAvailable: claimSupport !== null && claimSupport.expiresAt > input.now,
    replayPayloadAvailable: replay !== null && replay.expiresAt > input.now,
    immutableRevisionAvailable: binding.immutableRevisionRef !== undefined,
  });
  const call = await ctx.db.get("agentCapabilityCall", binding.callId);
  const auditId = await ctx.db.insert("agentEvidenceAccessAudit", {
    runId: binding.runId,
    citationBindingId: binding._id,
    storeId: binding.storeId,
    organizationId: binding.organizationId,
    viewerPrincipalKind: input.viewer.principalKind,
    viewerActorRef: input.viewer.actorRef,
    purpose: input.purpose,
    evidenceState: state,
    accessedAt: input.now,
  });
  return {
    state,
    auditId,
    citation: {
      citationBindingId: binding._id,
      citationKey: binding.citationKey,
      runId: binding.runId,
      attemptId: binding.attemptId,
      callId: binding.callId,
      artifactId: binding.artifactId,
      resultHash: binding.resultHash,
      claimDigest: binding.claimDigest,
      sourceRef: binding.sourceRef,
      capabilityId: call?.capabilityId,
      normalizedArgsHash: call?.normalizedArgsHash,
      normalizedArgs: call?.normalizedArgs,
      observedAt: call?.observedAt,
      capturedAt: call?.capturedAt,
      freshness: call?.freshness,
      completeness: call?.completeness,
      sourceRefCount: call?.sourceRefCount,
      immutableRevisionRef: binding.immutableRevisionRef,
      ...(state === "reconstructible" && claimSupport
        ? { claimSupport: { extractorKey: claimSupport.extractorKey, extractorVersion: claimSupport.extractorVersion, slice: claimSupport.slice } }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Expiry sweep (cron-registered)
// ---------------------------------------------------------------------------

export type ExpirySweepResult = {
  deletedPromptPayloads: number;
  deletedReplayPayloads: number;
  deletedScratchDescriptors: number;
  deletedClaimSupport: number;
  expiredCitations: number;
  runtimeCleanupAttempted: number;
  runtimeCleanupSucceeded: number;
  runtimeCleanupFailed: number;
  hasMore: boolean;
};

/**
 * Bounded expiry pass. Each phase has its own `limit` so a backlog in one
 * table cannot starve the others; any full phase reports `hasMore` and the
 * caller schedules another pass. Deletions are idempotent and index-driven,
 * so a pass that fails midway simply leaves its rows for the next one.
 */
export async function sweepExpiredAgentContentWithCtx(
  ctx: MutationCtx,
  input: { now: number; limit?: number },
): Promise<ExpirySweepResult> {
  const limit = Math.min(MAX_SWEEP_LIMIT, Math.max(1, input.limit ?? DEFAULT_SWEEP_LIMIT));
  const now = input.now;
  let hasMore = false;

  const prompts = await ctx.db
    .query("agentPromptPayload")
    .withIndex("by_retentionClass_expiresAt", (q) => q.eq("retentionClass", "short_lived").lte("expiresAt", now))
    .take(limit);
  for (const payload of prompts) {
    const grant = await ctx.db
      .query("agentRunGrant")
      .withIndex("by_runId", (q) => q.eq("runId", payload.runId))
      .unique();
    if (grant && grant.promptPayloadState === "stored") {
      await ctx.db.patch("agentRunGrant", grant._id, { promptPayloadState: "expired", promptPayloadId: undefined });
    }
    await ctx.db.delete("agentPromptPayload", payload._id);
  }
  hasMore ||= prompts.length === limit;

  let deletedReplayPayloads = 0;
  for (const retentionClass of ["short_lived", "standard"] as const) {
    const replays = await ctx.db
      .query("agentReplayPayload")
      .withIndex("by_retentionClass_expiresAt", (q) => q.eq("retentionClass", retentionClass).lte("expiresAt", now))
      .take(limit);
    for (const replay of replays) await ctx.db.delete("agentReplayPayload", replay._id);
    deletedReplayPayloads += replays.length;
    hasMore ||= replays.length === limit;
  }

  const scratch = await ctx.db
    .query("agentScratchDescriptor")
    .withIndex("by_retentionClass_expiresAt", (q) => q.eq("retentionClass", "short_lived").lte("expiresAt", now))
    .take(limit);
  for (const descriptor of scratch) await ctx.db.delete("agentScratchDescriptor", descriptor._id);
  hasMore ||= scratch.length === limit;

  const claims = await ctx.db
    .query("agentClaimSupport")
    .withIndex("by_retentionClass_expiresAt", (q) => q.eq("retentionClass", "standard").lte("expiresAt", now))
    .take(limit);
  for (const claim of claims) await ctx.db.delete("agentClaimSupport", claim._id);
  hasMore ||= claims.length === limit;

  const citations = await ctx.db
    .query("agentCitationBinding")
    .withIndex("by_evidenceLifecycle_expiresAt", (q) => q.eq("evidenceLifecycle", "retained").lte("expiresAt", now))
    .take(limit);
  for (const citation of citations) {
    await ctx.db.patch("agentCitationBinding", citation._id, {
      evidenceLifecycle: "expired",
      lifecycleUpdatedAt: now,
    });
  }
  hasMore ||= citations.length === limit;

  const cleanup = await runRuntimeCleanupBatchWithCtx(ctx, { now, limit });
  hasMore ||= cleanup.hasMore;

  return {
    deletedPromptPayloads: prompts.length,
    deletedReplayPayloads,
    deletedScratchDescriptors: scratch.length,
    deletedClaimSupport: claims.length,
    expiredCitations: citations.length,
    runtimeCleanupAttempted: cleanup.attempted,
    runtimeCleanupSucceeded: cleanup.succeeded,
    runtimeCleanupFailed: cleanup.failed,
    hasMore,
  };
}

export const sweepExpiredAgentContent = internalMutation({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const result = await sweepExpiredAgentContentWithCtx(ctx, { now, limit: args.limit });
    if (result.hasMore) {
      await ctx.scheduler.runAfter(0, internal.agentHarness.retention.sweepExpiredAgentContent, {
        now,
        limit: args.limit,
      });
    }
    return result;
  },
});

/** Bounded repair safety net: stale attempts, stalled turns, fenced runs. */
export const repairSweep = internalMutation({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const attempts = await recoverStaleAttemptsWithCtx(ctx, { now, limit: args.limit });
    const bindings = await sweepStaleTurnBindingsWithCtx(ctx, { now, limit: args.limit });
    const fenced = await repairFencedRunsWithCtx(ctx, { now, limit: args.limit });
    const hasMore = attempts.hasMore || bindings.hasMore || fenced.hasMore;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.agentHarness.retention.repairSweep, { limit: args.limit });
    }
    return {
      recoveredAttempts: attempts.recovered,
      failedTurns: bindings.failed,
      canceledFencedRuns: fenced.canceled,
      hasMore,
    };
  },
});

// ---------------------------------------------------------------------------
// Store / organization removal hooks
// ---------------------------------------------------------------------------

export type ScopeRemovalResult = {
  deletedRows: number;
  markedRows: number;
  cleanupRequested: number;
  hasMore: boolean;
};

type RemovalScope = { storeId: Id<"store"> } | { organizationId: Id<"organization"> };

/**
 * Narrow, idempotent cleanup of agent content in one store or organization.
 * Content rows are deleted; audit rows (grants, citations) gain the
 * `deleted_by_lifecycle` marker so evidence lookups answer honestly; active
 * runs are canceled; every turn binding asks its adapter to clean runtime
 * payloads (retried by the sweep on failure). Each table is processed in one
 * bounded batch; `hasMore` asks the caller to schedule another pass.
 */
export async function deleteAgentHarnessContentWithCtx(
  ctx: MutationCtx,
  scope: RemovalScope,
  now: number,
): Promise<ScopeRemovalResult> {
  const batch = AGENT_SCOPE_DELETE_BATCH_SIZE;
  let deletedRows = 0;
  let markedRows = 0;
  let cleanupRequested = 0;
  let hasMore = false;
  const countDeleted = (deleted: number) => {
    deletedRows += deleted;
    hasMore ||= deleted === batch;
  };

  const prompts =
    "storeId" in scope
      ? await ctx.db.query("agentPromptPayload").withIndex("by_storeId", (q) => q.eq("storeId", scope.storeId)).take(batch)
      : await ctx.db.query("agentPromptPayload").withIndex("by_organizationId", (q) => q.eq("organizationId", scope.organizationId)).take(batch);
  for (const row of prompts) await ctx.db.delete("agentPromptPayload", row._id);
  countDeleted(prompts.length);

  const replays =
    "storeId" in scope
      ? await ctx.db.query("agentReplayPayload").withIndex("by_storeId", (q) => q.eq("storeId", scope.storeId)).take(batch)
      : await ctx.db.query("agentReplayPayload").withIndex("by_organizationId", (q) => q.eq("organizationId", scope.organizationId)).take(batch);
  for (const row of replays) await ctx.db.delete("agentReplayPayload", row._id);
  countDeleted(replays.length);

  const scratch =
    "storeId" in scope
      ? await ctx.db.query("agentScratchDescriptor").withIndex("by_storeId", (q) => q.eq("storeId", scope.storeId)).take(batch)
      : await ctx.db.query("agentScratchDescriptor").withIndex("by_organizationId", (q) => q.eq("organizationId", scope.organizationId)).take(batch);
  for (const row of scratch) await ctx.db.delete("agentScratchDescriptor", row._id);
  countDeleted(scratch.length);

  const claims =
    "storeId" in scope
      ? await ctx.db.query("agentClaimSupport").withIndex("by_storeId", (q) => q.eq("storeId", scope.storeId)).take(batch)
      : await ctx.db.query("agentClaimSupport").withIndex("by_organizationId", (q) => q.eq("organizationId", scope.organizationId)).take(batch);
  for (const row of claims) await ctx.db.delete("agentClaimSupport", row._id);
  countDeleted(claims.length);

  const citations =
    "storeId" in scope
      ? await ctx.db.query("agentCitationBinding").withIndex("by_storeId_evidenceLifecycle", (q) => q.eq("storeId", scope.storeId).eq("evidenceLifecycle", "retained")).take(batch)
      : await ctx.db.query("agentCitationBinding").withIndex("by_organizationId_evidenceLifecycle", (q) => q.eq("organizationId", scope.organizationId).eq("evidenceLifecycle", "retained")).take(batch);
  for (const citation of citations) {
    await ctx.db.patch("agentCitationBinding", citation._id, {
      evidenceLifecycle: "deleted_by_lifecycle",
      lifecycleUpdatedAt: now,
    });
  }
  markedRows += citations.length;
  hasMore ||= citations.length === batch;

  const grants =
    "storeId" in scope
      ? await ctx.db.query("agentRunGrant").withIndex("by_storeId_lifecycle", (q) => q.eq("storeId", scope.storeId).eq("lifecycle", "retained")).take(batch)
      : await ctx.db.query("agentRunGrant").withIndex("by_organizationId_lifecycle", (q) => q.eq("organizationId", scope.organizationId).eq("lifecycle", "retained")).take(batch);
  for (const grant of grants) {
    await ctx.db.patch("agentRunGrant", grant._id, {
      lifecycle: "deleted_by_lifecycle",
      promptPayloadState: "deleted_by_lifecycle",
      promptPayloadId: undefined,
      deletedByLifecycleAt: now,
    });
  }
  markedRows += grants.length;
  hasMore ||= grants.length === batch;

  const bindings =
    "storeId" in scope
      ? await ctx.db.query("agentTurnBinding").withIndex("by_storeId_runtimeCleanupStatus", (q) => q.eq("storeId", scope.storeId).eq("runtimeCleanupStatus", "not_requested")).take(batch)
      : await ctx.db.query("agentTurnBinding").withIndex("by_organizationId_runtimeCleanupStatus", (q) => q.eq("organizationId", scope.organizationId).eq("runtimeCleanupStatus", "not_requested")).take(batch);
  for (const binding of bindings) {
    const run = await ctx.db.get("intelligenceRun", binding.runId);
    if (run && !isTerminalRunStatus(run.status)) {
      await cancelAgentRunWithCtx(ctx, {
        runId: run._id,
        idempotencyKey: `scope_removed:${binding._id}`,
        reason: "storeId" in scope ? "store_removed" : "organization_removed",
        now,
      });
    }
    await ctx.db.patch("agentTurnBinding", binding._id, {
      runtimeCleanupStatus: "pending",
      runtimeCleanupNextAttemptAt: now,
      updatedAt: now,
    });
    const refreshed = await ctx.db.get("agentTurnBinding", binding._id);
    if (refreshed) await attemptRuntimeCleanupWithCtx(ctx, refreshed, now);
    cleanupRequested += 1;
  }
  hasMore ||= bindings.length === batch;

  return { deletedRows, markedRows, cleanupRequested, hasMore };
}

export async function deleteAgentHarnessContentForStoreWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
  now: number,
): Promise<ScopeRemovalResult> {
  return deleteAgentHarnessContentWithCtx(ctx, { storeId }, now);
}

export async function deleteAgentHarnessContentForOrganizationWithCtx(
  ctx: MutationCtx,
  organizationId: Id<"organization">,
  now: number,
): Promise<ScopeRemovalResult> {
  return deleteAgentHarnessContentWithCtx(ctx, { organizationId }, now);
}

export const readCitationEvidence = internalMutation({
  args: {
    citationBindingId: v.id("agentCitationBinding"),
    viewerPrincipalKind: intelligencePrincipalKindValidator,
    viewerActorRef: v.string(),
    purpose: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    readCitationEvidenceWithCtx(ctx, {
      citationBindingId: args.citationBindingId,
      viewer: { principalKind: args.viewerPrincipalKind, actorRef: args.viewerActorRef },
      purpose: args.purpose,
      now: args.now ?? Date.now(),
    }),
});
