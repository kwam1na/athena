import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { requireStoreFullAdminAccess } from "../stockOps/access";
import {
  intelligenceArtifactKindValidator,
  intelligenceArtifactStatusValidator,
  intelligenceErrorValidator,
  intelligencePrincipalKindValidator,
  intelligenceProviderStatusValidator,
  intelligenceRunStatusValidator,
  intelligenceSourceRefValidator,
  intelligenceVisibilityModeValidator,
} from "../schemas/intelligence";
import { assertArtifactTransition, assertRunTransition } from "./lifecycle";

const payloadValidator = v.record(v.string(), v.any());
export const INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS = 2 * 60 * 1000;
export const INTELLIGENCE_RUNNING_RUN_STALE_AFTER_MS =
  INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS + 30 * 1000;
const DEBUG_RUN_STATUSES: Array<Doc<"intelligenceRun">["status"]> = [
  "running",
  "context_captured",
  "queued",
  "failed",
  "completed",
  "canceled",
];
const DEBUG_RUN_FALLBACK_TAKE_PER_STATUS = 25;

async function transitionRun(
  ctx: MutationCtx,
  runId: Id<"intelligenceRun">,
  status: Doc<"intelligenceRun">["status"],
  patch: Partial<Doc<"intelligenceRun">> = {},
) {
  const run = await ctx.db.get("intelligenceRun", runId);
  if (!run) throw new Error("Intelligence run not found");

  if (run.status !== status) {
    assertRunTransition(run.status, status);
  }

  await ctx.db.patch("intelligenceRun", runId, {
    ...patch,
    status,
    updatedAt: Date.now(),
    ...(status === "completed" || status === "failed" || status === "canceled"
      ? { completedAt: Date.now() }
      : {}),
  });
}

async function markSiblingArtifactsStale(
  ctx: MutationCtx,
  artifact: Doc<"intelligenceArtifact">,
) {
  if (!artifact.storeId) return;

  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Marking current capability siblings stale is bounded by store/capability/status index and required for clear review state.
  const readyArtifacts = await ctx.db
    .query("intelligenceArtifact")
    .withIndex("by_storeId_capability_status", (q) =>
      q
        .eq("storeId", artifact.storeId)
        .eq("capability", artifact.capability)
        .eq("status", "ready"),
    )
    .collect();

  await Promise.all(
    readyArtifacts
      .filter((existing) => existing._id !== artifact._id)
      .filter((existing) => shouldSupersedeArtifact(existing, artifact))
      .map((existing) => {
        assertArtifactTransition(existing.status, "superseded");
        return ctx.db.patch("intelligenceArtifact", existing._id, {
          status: "superseded",
          supersededByArtifactId: artifact._id,
          updatedAt: Date.now(),
        });
      }),
  );
}

export function shouldSupersedeArtifact(
  existing: Pick<
    Doc<"intelligenceArtifact">,
    "kind" | "subjectTable" | "subjectId"
  >,
  next: Pick<
    Doc<"intelligenceArtifact">,
    "kind" | "subjectTable" | "subjectId"
  >,
) {
  if (!next.subjectTable || !next.subjectId) return true;

  return (
    existing.kind === next.kind &&
    existing.subjectTable === next.subjectTable &&
    existing.subjectId === next.subjectId
  );
}

function isActiveRunStatus(status: Doc<"intelligenceRun">["status"]) {
  return status !== "completed" && status !== "failed" && status !== "canceled";
}

export function isActiveRunStale(
  run: Pick<Doc<"intelligenceRun">, "createdAt" | "status" | "updatedAt">,
  now = Date.now(),
) {
  if (!isActiveRunStatus(run.status)) return false;

  const staleAfter =
    run.status === "running"
      ? INTELLIGENCE_RUNNING_RUN_STALE_AFTER_MS
      : INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS;

  return now - run.updatedAt >= staleAfter;
}

export function selectActiveRunForIdempotency<
  T extends Pick<Doc<"intelligenceRun">, "createdAt" | "status">,
>(runs: T[]) {
  return (
    runs
      .filter((run) => isActiveRunStatus(run.status))
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  );
}

export function shouldRecoverActiveRun(
  run: Pick<Doc<"intelligenceRun">, "createdAt" | "status" | "updatedAt"> | null,
  now = Date.now(),
) {
  return run ? isActiveRunStale(run, now) : false;
}

export function selectLatestDebugRunFromCandidates<
  T extends Pick<Doc<"intelligenceRun">, "createdAt" | "sourceRefs"> & {
    debugSubjectTable?: string;
    debugSubjectId?: string;
  },
>(
  runs: T[],
  args: { sourceRefTable?: string; sourceRefId?: string } = {},
) {
  const matchesSubject = (candidate: T) => {
    if (!args.sourceRefTable || !args.sourceRefId) return true;
    if (candidate.debugSubjectTable || candidate.debugSubjectId) {
      return (
        candidate.debugSubjectTable === args.sourceRefTable &&
        candidate.debugSubjectId === args.sourceRefId
      );
    }

    return candidate.sourceRefs.some(
      (sourceRef) =>
        sourceRef.table === args.sourceRefTable &&
        sourceRef.id === args.sourceRefId,
    );
  };

  return runs.filter(matchesSubject).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export const ensureRun = internalMutation({
  args: {
    storeId: v.optional(v.id("store")),
    organizationId: v.optional(v.id("organization")),
    capability: v.string(),
    providerKey: v.string(),
    providerModel: v.optional(v.string()),
    idempotencyKey: v.string(),
    trigger: v.union(
      v.literal("operator"),
      v.literal("automation"),
      v.literal("system"),
      v.literal("compatibility"),
    ),
    principalKind: intelligencePrincipalKindValidator,
    actorRef: v.optional(v.string()),
    policyRef: v.optional(v.string()),
    visibilityMode: intelligenceVisibilityModeValidator,
    debugSubjectTable: v.optional(v.string()),
    debugSubjectId: v.optional(v.string()),
    sourceRefs: v.array(intelligenceSourceRefValidator),
    dataWindowStartAt: v.optional(v.number()),
    dataWindowEndAt: v.optional(v.number()),
    retryOfRunId: v.optional(v.id("intelligenceRun")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    if (args.storeId) {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- Idempotency lookup is indexed and scoped to one store/key; terminal runs are historical and should not block explicit reruns.
      const existingRuns = await ctx.db
        .query("intelligenceRun")
        .withIndex("by_storeId_idempotencyKey", (q) =>
          q.eq("storeId", args.storeId).eq("idempotencyKey", args.idempotencyKey),
        )
        .collect();
      const activeRun = selectActiveRunForIdempotency(existingRuns);

      if (activeRun) {
        if (shouldRecoverActiveRun(activeRun, now)) {
          assertRunTransition(activeRun.status, "failed");
          await ctx.db.patch("intelligenceRun", activeRun._id, {
            status: "failed",
            updatedAt: now,
            completedAt: now,
            error: {
              code: "stale_active_run",
              message: "The previous intelligence run did not finish.",
              retryable: true,
            },
          });
        } else {
          throw new Error(
            "An Athena insight is already being generated for this context.",
          );
        }
      }
    }

    return ctx.db.insert("intelligenceRun", {
      ...args,
      status: "queued",
      attemptCount: args.retryOfRunId ? 2 : 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const recordContextSnapshot = internalMutation({
  args: {
    runId: v.id("intelligenceRun"),
    snapshotHash: v.string(),
    payloadSummary: payloadValidator,
    payloadRedaction: v.optional(v.string()),
    bundleKind: v.optional(v.string()),
    bundleVersion: v.optional(v.number()),
    freshness: v.optional(
      v.union(
        v.literal("current"),
        v.literal("stale"),
        v.literal("partial"),
        v.literal("failed"),
      ),
    ),
    hiddenSourceCount: v.optional(v.number()),
    omittedEvidenceCount: v.optional(v.number()),
    redactionMode: v.optional(v.string()),
    qualityFlags: v.optional(v.array(v.string())),
    limitedEvidence: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("intelligenceRun", args.runId);
    if (!run) throw new Error("Intelligence run not found");

    const now = Date.now();
    const snapshotId = await ctx.db.insert("intelligenceContextSnapshot", {
      storeId: run.storeId,
      organizationId: run.organizationId,
      runId: run._id,
      capability: run.capability,
      principalKind: run.principalKind,
      actorRef: run.actorRef,
      policyRef: run.policyRef,
      visibilityMode: run.visibilityMode,
      sourceRefs: run.sourceRefs,
      dataWindowStartAt: run.dataWindowStartAt,
      dataWindowEndAt: run.dataWindowEndAt,
      snapshotHash: args.snapshotHash,
      payloadSummary: args.payloadSummary,
      payloadRedaction: args.payloadRedaction,
      bundleKind: args.bundleKind,
      bundleVersion: args.bundleVersion,
      freshness: args.freshness,
      hiddenSourceCount: args.hiddenSourceCount,
      omittedEvidenceCount: args.omittedEvidenceCount,
      redactionMode: args.redactionMode,
      qualityFlags: args.qualityFlags,
      limitedEvidence: args.limitedEvidence,
      createdAt: now,
    });

    await transitionRun(ctx, run._id, "context_captured", {
      contextSnapshotId: snapshotId,
      snapshotHash: args.snapshotHash,
    });

    return snapshotId;
  },
});

export const recordProviderInvocation = internalMutation({
  args: {
    runId: v.id("intelligenceRun"),
    contextSnapshotId: v.optional(v.id("intelligenceContextSnapshot")),
    providerKey: v.string(),
    providerModel: v.optional(v.string()),
    status: intelligenceProviderStatusValidator,
    requestSummary: payloadValidator,
    responseSummary: v.optional(payloadValidator),
    rawPayloadStored: v.boolean(),
    error: v.optional(intelligenceErrorValidator),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("intelligenceRun", args.runId);
    if (!run) throw new Error("Intelligence run not found");

    const now = Date.now();
    return ctx.db.insert("intelligenceProviderInvocation", {
      storeId: run.storeId,
      organizationId: run.organizationId,
      runId: run._id,
      contextSnapshotId: args.contextSnapshotId,
      providerKey: args.providerKey,
      providerModel: args.providerModel,
      capability: run.capability,
      status: args.status,
      requestSummary: args.requestSummary,
      responseSummary: args.responseSummary,
      rawPayloadStored: args.rawPayloadStored,
      error: args.error,
      startedAt: now,
      completedAt: args.status === "started" ? undefined : now,
    });
  },
});

export const updateProviderInvocation = internalMutation({
  args: {
    invocationId: v.id("intelligenceProviderInvocation"),
    providerModel: v.optional(v.string()),
    status: intelligenceProviderStatusValidator,
    responseSummary: v.optional(payloadValidator),
    rawPayloadStored: v.boolean(),
    error: v.optional(intelligenceErrorValidator),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("intelligenceProviderInvocation", args.invocationId, {
      providerModel: args.providerModel,
      status: args.status,
      responseSummary: args.responseSummary,
      rawPayloadStored: args.rawPayloadStored,
      error: args.error,
      completedAt: Date.now(),
    });
  },
});

export const markRunRunning = internalMutation({
  args: { runId: v.id("intelligenceRun") },
  handler: async (ctx, args) => {
    await transitionRun(ctx, args.runId, "running");
  },
});

export const failRun = internalMutation({
  args: {
    runId: v.id("intelligenceRun"),
    error: intelligenceErrorValidator,
  },
  handler: async (ctx, args) => {
    await transitionRun(ctx, args.runId, "failed", { error: args.error });
  },
});

export const completeRunWithArtifact = internalMutation({
  args: {
    runId: v.id("intelligenceRun"),
    contextSnapshotId: v.id("intelligenceContextSnapshot"),
    kind: intelligenceArtifactKindValidator,
    subjectTable: v.optional(v.string()),
    subjectId: v.optional(v.string()),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    payload: payloadValidator,
    evidenceRefs: v.array(intelligenceSourceRefValidator),
    confidence: v.optional(v.number()),
    limitedEvidence: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("intelligenceRun", args.runId);
    if (!run) throw new Error("Intelligence run not found");
    if (!run.snapshotHash) {
      throw new Error("Intelligence run has no captured context");
    }
    if (!isActiveRunStatus(run.status)) {
      throw new Error("Intelligence run is no longer active.");
    }

    const now = Date.now();
    const artifactId = await ctx.db.insert("intelligenceArtifact", {
      storeId: run.storeId,
      organizationId: run.organizationId,
      runId: run._id,
      contextSnapshotId: args.contextSnapshotId,
      capability: run.capability,
      kind: args.kind,
      subjectTable: args.subjectTable,
      subjectId: args.subjectId,
      status: "ready",
      visibilityMode: run.visibilityMode,
      sourceRefs: run.sourceRefs,
      dataWindowStartAt: run.dataWindowStartAt,
      dataWindowEndAt: run.dataWindowEndAt,
      snapshotHash: run.snapshotHash,
      title: args.title,
      summary: args.summary,
      payload: args.payload,
      evidenceRefs: args.evidenceRefs,
      confidence: args.confidence,
      limitedEvidence: args.limitedEvidence,
      createdAt: now,
      updatedAt: now,
    });

    const artifact = await ctx.db.get("intelligenceArtifact", artifactId);
    if (artifact) await markSiblingArtifactsStale(ctx, artifact);

    await transitionRun(ctx, run._id, "completed", { artifactId });

    return artifactId;
  },
});

export const getLatestArtifactInternal = internalQuery({
  args: {
    storeId: v.id("store"),
    capability: v.string(),
    kind: intelligenceArtifactKindValidator,
  },
  handler: async (ctx, args) => {
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- Store/capability/status set is small for latest panel artifacts.
    const artifacts = await ctx.db
      .query("intelligenceArtifact")
      .withIndex("by_storeId_capability_status", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("capability", args.capability)
          .eq("status", "ready"),
      )
      .collect();

    return (
      artifacts
        .filter((artifact) => artifact.kind === args.kind)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    );
  },
});

export const latestArtifact = query({
  args: {
    storeId: v.id("store"),
    capability: v.string(),
    kind: intelligenceArtifactKindValidator,
    includeDismissed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireStoreFullAdminAccess(ctx, args.storeId);

    const statuses: Array<Doc<"intelligenceArtifact">["status"]> =
      args.includeDismissed === true ? ["ready", "stale", "dismissed"] : ["ready", "stale"];

    // eslint-disable-next-line @convex-dev/no-collect-in-query -- Panel query returns latest artifact for one store/capability.
    const artifacts = await ctx.db
      .query("intelligenceArtifact")
      .withIndex("by_storeId_capability_status", (q) =>
        q.eq("storeId", args.storeId).eq("capability", args.capability),
      )
      .collect();

    return (
      artifacts
        .filter(
          (artifact) =>
            artifact.kind === args.kind && statuses.includes(artifact.status),
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    );
  },
});

export const latestArtifactBySubject = query({
  args: {
    storeId: v.id("store"),
    kind: intelligenceArtifactKindValidator,
    subjectTable: v.string(),
    subjectId: v.string(),
    includeDismissed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireStoreFullAdminAccess(ctx, args.storeId);

    const statuses: Array<Doc<"intelligenceArtifact">["status"]> =
      args.includeDismissed === true ? ["ready", "stale", "dismissed"] : ["ready", "stale"];

    const artifacts = await Promise.all(
      statuses.map((status) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- Subject/status lookup is indexed and bounded to one artifact stream for one insight panel.
        ctx.db
          .query("intelligenceArtifact")
          .withIndex("by_storeId_kind_subject_status", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("kind", args.kind)
              .eq("subjectTable", args.subjectTable)
              .eq("subjectId", args.subjectId)
              .eq("status", status),
          )
          .collect(),
      ),
    );

    return (
      artifacts
        .flat()
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    );
  },
});

export async function getLatestDebugRunBySubject(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    capability: string;
    sourceRefTable?: string;
    sourceRefId?: string;
  },
) {
  if (!args.sourceRefTable || !args.sourceRefId) return null;

  const indexedRun = await ctx.db
    .query("intelligenceRun")
    .withIndex("by_storeId_capability_debugSubject_createdAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("capability", args.capability)
        .eq("debugSubjectTable", args.sourceRefTable)
        .eq("debugSubjectId", args.sourceRefId),
    )
    .order("desc")
    .first();

  if (indexedRun) return indexedRun;

  const fallbackRuns = await getBoundedDebugRunsByCapability(ctx, args);
  return selectLatestDebugRunFromCandidates(fallbackRuns, args);
}

export async function getLatestDebugRunByCapability(
  ctx: QueryCtx,
  args: { storeId: Id<"store">; capability: string },
) {
  return selectLatestDebugRunFromCandidates(
    await getBoundedDebugRunsByCapability(ctx, args),
  );
}

async function getBoundedDebugRunsByCapability(
  ctx: QueryCtx,
  args: { storeId: Id<"store">; capability: string },
) {
  const runs = await Promise.all(
    DEBUG_RUN_STATUSES.map((status) =>
      ctx.db
        .query("intelligenceRun")
        .withIndex("by_storeId_capability_status", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("capability", args.capability)
            .eq("status", status),
        )
        .order("desc")
        .take(DEBUG_RUN_FALLBACK_TAKE_PER_STATUS),
    ),
  );

  return runs.flat();
}

function summarizeError(error: Doc<"intelligenceRun">["error"] | undefined) {
  if (!error) return undefined;

  return {
    code: error.code,
    diagnostic: error.diagnostic,
    message: error.message,
    retryable: error.retryable,
  };
}

function summarizePayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, summarizePayloadValue(value)]),
  );
}

function summarizePayloadValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      type: "array",
      count: value.length,
    };
  }

  if (value && typeof value === "object") {
    return {
      type: "object",
      keys: Object.keys(value).sort(),
    };
  }

  return value;
}

export function buildLatestRunDebugPayload({
  artifact,
  providerInvocations,
  run,
  snapshot,
}: {
  run: Doc<"intelligenceRun">;
  snapshot: Doc<"intelligenceContextSnapshot"> | null;
  artifact: Doc<"intelligenceArtifact"> | null;
  providerInvocations: Doc<"intelligenceProviderInvocation">[];
}) {
  return {
    run: {
      _id: run._id,
      artifactId: run.artifactId,
      attemptCount: run.attemptCount,
      capability: run.capability,
      completedAt: run.completedAt,
      contextSnapshotId: run.contextSnapshotId,
      createdAt: run.createdAt,
      dataWindowEndAt: run.dataWindowEndAt,
      dataWindowStartAt: run.dataWindowStartAt,
      error: summarizeError(run.error),
      idempotencyKey: run.idempotencyKey,
      providerKey: run.providerKey,
      providerModel: run.providerModel,
      snapshotHash: run.snapshotHash,
      status: run.status,
      trigger: run.trigger,
      updatedAt: run.updatedAt,
      visibilityMode: run.visibilityMode,
    },
    snapshot: snapshot
      ? {
          _id: snapshot._id,
          createdAt: snapshot.createdAt,
          payloadRedaction: snapshot.payloadRedaction,
          payloadSummary: summarizePayload(snapshot.payloadSummary),
          snapshotHash: snapshot.snapshotHash,
          sourceRefCount: snapshot.sourceRefs.length,
        }
      : null,
    artifact: artifact
      ? {
          _id: artifact._id,
          confidence: artifact.confidence,
          createdAt: artifact.createdAt,
          evidenceCount: artifact.evidenceRefs.length,
          limitedEvidence: artifact.limitedEvidence,
          status: artifact.status,
          summary: artifact.summary,
          title: artifact.title,
          updatedAt: artifact.updatedAt,
        }
      : null,
    providerInvocations: providerInvocations
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((invocation) => ({
        _id: invocation._id,
        completedAt: invocation.completedAt,
        error: summarizeError(invocation.error),
        providerKey: invocation.providerKey,
        providerModel: invocation.providerModel,
        rawPayloadStored: invocation.rawPayloadStored,
        requestSummary: summarizePayload(invocation.requestSummary),
        responseSummary: invocation.responseSummary
          ? summarizePayload(invocation.responseSummary)
          : undefined,
        startedAt: invocation.startedAt,
        status: invocation.status,
      })),
  };
}

export const latestRunDebug = query({
  args: {
    storeId: v.id("store"),
    capability: v.string(),
    sourceRefTable: v.optional(v.string()),
    sourceRefId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireStoreFullAdminAccess(ctx, args.storeId);

    const run =
      args.sourceRefTable && args.sourceRefId
        ? await getLatestDebugRunBySubject(ctx, args)
        : await getLatestDebugRunByCapability(ctx, args);
    if (!run) return null;

    const [snapshot, artifact, providerInvocations] = await Promise.all([
      run.contextSnapshotId
        ? ctx.db.get("intelligenceContextSnapshot", run.contextSnapshotId)
        : null,
      run.artifactId ? ctx.db.get("intelligenceArtifact", run.artifactId) : null,
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- Provider attempts are bounded to one run for the debug drawer.
      ctx.db
        .query("intelligenceProviderInvocation")
        .withIndex("by_runId", (q) => q.eq("runId", run._id))
        .collect(),
    ]);

    return buildLatestRunDebugPayload({
      artifact,
      providerInvocations,
      run,
      snapshot,
    });
  },
});

export const markArtifactStatus = internalMutation({
  args: {
    artifactId: v.id("intelligenceArtifact"),
    status: intelligenceArtifactStatusValidator,
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get("intelligenceArtifact", args.artifactId);
    if (!artifact) throw new Error("Intelligence artifact not found");
    if (artifact.status !== args.status) {
      assertArtifactTransition(artifact.status, args.status);
    }
    await ctx.db.patch("intelligenceArtifact", args.artifactId, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const dismissArtifact = mutation({
  args: {
    artifactId: v.id("intelligenceArtifact"),
    actorRef: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get("intelligenceArtifact", args.artifactId);
    if (!artifact) throw new Error("Intelligence artifact not found");
    if (!artifact.storeId) throw new Error("Store-scoped artifact required");
    const { athenaUser } = await requireStoreFullAdminAccess(ctx, artifact.storeId);
    if (artifact.status !== "dismissed") {
      assertArtifactTransition(artifact.status, "dismissed");
    }

    const now = Date.now();
    await ctx.db.patch("intelligenceArtifact", args.artifactId, {
      status: "dismissed",
      dismissedAt: now,
      dismissedByActorRef: args.actorRef,
      updatedAt: now,
    });

    await recordOperationalEventWithCtx(ctx, {
      storeId: artifact.storeId,
      organizationId: artifact.organizationId,
      eventType: "intelligence_artifact.dismissed",
      subjectType: "intelligenceArtifact",
      subjectId: String(artifact._id),
      subjectLabel: artifact.title ?? artifact.capability,
      reason: args.reason,
      message: "Athena insight dismissed.",
      metadata: {
        capability: artifact.capability,
        kind: artifact.kind,
        runId: String(artifact.runId),
      },
      actorUserId: athenaUser._id,
      actorType: "human",
    });

    return { artifactId: args.artifactId, status: "dismissed" as const };
  },
});
