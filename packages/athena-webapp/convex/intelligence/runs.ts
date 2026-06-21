import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
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
    sourceRefs: v.array(intelligenceSourceRefValidator),
    dataWindowStartAt: v.optional(v.number()),
    dataWindowEndAt: v.optional(v.number()),
    retryOfRunId: v.optional(v.id("intelligenceRun")),
  },
  handler: async (ctx, args) => {
    if (args.storeId) {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- Idempotency lookup is indexed and scoped to one store/key; terminal runs are historical and should not block explicit reruns.
      const existingRuns = await ctx.db
        .query("intelligenceRun")
        .withIndex("by_storeId_idempotencyKey", (q) =>
          q.eq("storeId", args.storeId).eq("idempotencyKey", args.idempotencyKey),
        )
        .collect();
      const activeRun = existingRuns
        .filter(
          (run) =>
            run.status !== "completed" &&
            run.status !== "failed" &&
            run.status !== "canceled",
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      if (activeRun) {
        throw new Error("An Athena insight is already being generated for this context.");
      }
    }

    const now = Date.now();
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
