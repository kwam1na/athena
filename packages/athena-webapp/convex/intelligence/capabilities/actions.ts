import { v } from "convex/values";

import { action, type ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import {
  ATHENA_STRUCTURED_TEXT_V1,
  type AthenaStructuredTextResult,
  type AthenaStructuredTextSchema,
} from "../types";
import {
  createAthenaProviderRegistry,
  createProviderFailureResult,
  invokeStructuredTextProvider,
} from "../registry";
import {
  createFakeStructuredTextProvider,
  createTanStackStructuredTextProvider,
} from "../providers";
import {
  buildStoreInsightsPromptFromContextBundle,
  buildUserInsightsPromptFromContextBundle,
  hasEvidenceBackedRecommendations,
  type IntelligenceSourceRef,
  type InsightContextBundle,
  normalizeStoreInsightsOutput,
  normalizeUserInsightsOutput,
} from "./insights";

const STORE_INSIGHTS_CAPABILITY = "storeInsights";
const USER_INSIGHTS_CAPABILITY = "userInsights";
const PROVIDER_TIMEOUT_MS = 90 * 1000;

type StoreInsightsActionResult =
  | {
      kind: "ok";
      artifactId: Id<"intelligenceArtifact">;
      payload: ReturnType<typeof normalizeStoreInsightsOutput>;
    }
  | {
      kind: "error";
      message: string;
    };

type UserInsightsActionResult =
  | {
      kind: "ok";
      artifactId: Id<"intelligenceArtifact">;
      payload: ReturnType<typeof normalizeUserInsightsOutput>;
    }
  | {
      kind: "error";
      message: string;
    };

type CreateIntelligenceRunArgs = {
  storeId?: Id<"store">;
  organizationId?: Id<"organization">;
  capability: string;
  providerKey: string;
  providerModel?: string;
  idempotencyKey: string;
  trigger: "operator" | "automation" | "system" | "compatibility";
  principalKind: "athenaUser" | "staffProfile" | "system";
  actorRef?: string;
  policyRef?: string;
  visibilityMode: "store_admin" | "store_staff" | "support";
  sourceRefs: IntelligenceSourceRef[];
  debugSubjectTable?: string;
  debugSubjectId?: string;
  dataWindowStartAt?: number;
  dataWindowEndAt?: number;
  retryOfRunId?: Id<"intelligenceRun">;
};

type PersistedIntelligenceError = {
  code: string;
  message: string;
  diagnostic?: string;
  retryable?: boolean;
};

const insightGenerationInProgressMessage =
  "A readout was just requested. Wait a moment, then try again.";

const storeInsightsSchema: AthenaStructuredTextSchema = {
  name: "StoreInsights",
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      peak_activity_times: { type: "string" },
      popular_actions: { type: "array", items: { type: "string" } },
      recommendations: { type: "array", items: { type: "string" } },
      rationale: { type: "string" },
    },
    required: [
      "summary",
      "peak_activity_times",
      "popular_actions",
      "recommendations",
    ],
  },
};

const userInsightsSchema: AthenaStructuredTextSchema = {
  name: "UserInsights",
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      engagement_level: {
        type: "string",
        enum: ["high", "medium", "low", "unknown"],
      },
      device_preference: {
        type: "string",
        enum: ["desktop", "mobile", "unknown"],
      },
      likely_intent: { type: "string" },
      activity_status: {
        type: "string",
        enum: ["active", "inactive", "new", "unknown"],
      },
      recommendations: { type: "array", items: { type: "string" } },
      rationale: { type: "string" },
    },
    required: [
      "summary",
      "engagement_level",
      "device_preference",
      "likely_intent",
      "activity_status",
      "recommendations",
    ],
  },
};

export const generateStoreInsights = action({
  args: {
    storeId: v.id("store"),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<StoreInsightsActionResult> => {
    const access = await ctx.runQuery(
      internal.intelligence.access.requireStoreFullAdmin,
      { storeId: args.storeId },
    );
    const bundle: InsightContextBundle = await ctx.runQuery(
      internal.contextTracking.contextBundles.compileStoreInsightsContextBundle,
      { storeId: args.storeId },
    );
    const built = buildStoreInsightsPromptFromContextBundle(bundle);
    const snapshotHash = bundle.snapshotHash;
    const sourceRefs = bundle.sourceRefs;

    const runIdResult = await createIntelligenceRun(ctx, {
      storeId: args.storeId,
      organizationId: access.organizationId,
      capability: STORE_INSIGHTS_CAPABILITY,
      providerKey: resolveProviderId(args.provider),
      providerModel: resolveProviderModel(),
      idempotencyKey: `${STORE_INSIGHTS_CAPABILITY}:${args.storeId}:${snapshotHash}`,
      trigger: "compatibility",
      principalKind: "athenaUser",
      actorRef: String(access.athenaUserId),
      visibilityMode: "store_admin",
      debugSubjectTable: "store",
      debugSubjectId: String(args.storeId),
      sourceRefs,
      dataWindowStartAt: bundle.dataWindowStartAt,
      dataWindowEndAt: bundle.dataWindowEndAt,
    });
    if (runIdResult.kind === "error") return runIdResult;
    const runId = runIdResult.runId;

    try {
    const contextSnapshotId: Id<"intelligenceContextSnapshot"> = await ctx.runMutation(
      internal.intelligence.runs.recordContextSnapshot,
      {
        runId,
        snapshotHash,
        payloadSummary: built.snapshot,
        payloadRedaction: bundle.payloadRedaction,
        ...getBundleSnapshotFields(bundle),
      },
    );

    await ctx.runMutation(internal.intelligence.runs.markRunRunning, { runId });
    const providerInvocationId = await recordProviderStarted(ctx, {
      runId,
      contextSnapshotId,
      providerKey: resolveProviderId(args.provider),
      providerModel: resolveProviderModel(),
      requestSummary: {
        schema: storeInsightsSchema.name,
        promptCharacters: built.prompt.length,
      },
    });

    const providerResult = await runStructuredProvider({
      provider: args.provider,
      prompt: built.prompt,
      schema: storeInsightsSchema,
      metadata: {
        capability: STORE_INSIGHTS_CAPABILITY,
        storeId: String(args.storeId),
        snapshotHash,
      },
    });

    if (providerResult.status !== "succeeded") {
      await recordProviderFailure(ctx, {
        runId,
        invocationId: providerInvocationId,
        error: providerResult.error,
      });
      return failedGenerationResult(providerResult.error.message);
    }

    const payload = normalizeStoreInsightsOutput(
      providerResult.output,
      getStoreInsightsSnapshotFallback(built.snapshot),
    );
    const limitedEvidence =
      bundle.limitedEvidence || !hasEvidenceBackedRecommendations(payload, sourceRefs);

    await recordProviderSucceeded(ctx, {
      invocationId: providerInvocationId,
      providerModel: providerResult.metadata.modelId,
      responseSummary: {
        outputKeys: Object.keys(providerResult.output),
        limitedEvidence,
      },
    });

    const artifactId: Id<"intelligenceArtifact"> = await ctx.runMutation(internal.intelligence.runs.completeRunWithArtifact, {
      runId,
      contextSnapshotId,
      kind: "store_insights",
      subjectTable: "store",
      subjectId: String(args.storeId),
      title: "Store insights",
      summary: payload.summary,
      payload,
      evidenceRefs: sourceRefs,
      confidence: limitedEvidence ? 0.35 : 0.75,
      limitedEvidence,
    });

    return { kind: "ok" as const, artifactId, payload };
    } catch (error) {
      await failRunBestEffort(ctx, runId, error);
      throw error;
    }
  },
});

export const generateUserInsights = action({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<UserInsightsActionResult> => {
    const access = await ctx.runQuery(
      internal.intelligence.access.requireStoreFullAdmin,
      { storeId: args.storeId },
    );
    const bundle: InsightContextBundle = await ctx.runQuery(
      internal.contextTracking.contextBundles.compileUserInsightsContextBundle,
      { storeFrontUserId: args.storeFrontUserId, storeId: args.storeId },
    );
    const built = buildUserInsightsPromptFromContextBundle(bundle);
    const snapshotHash = bundle.snapshotHash;
    const sourceRefs = bundle.sourceRefs;

    const runIdResult = await createIntelligenceRun(ctx, {
      storeId: args.storeId,
      organizationId: access.organizationId,
      capability: USER_INSIGHTS_CAPABILITY,
      providerKey: resolveProviderId(args.provider),
      providerModel: resolveProviderModel(),
      idempotencyKey: `${USER_INSIGHTS_CAPABILITY}:${args.storeId}:${args.storeFrontUserId}:${snapshotHash}`,
      trigger: "compatibility",
      principalKind: "athenaUser",
      actorRef: String(access.athenaUserId),
      visibilityMode: "store_admin",
      debugSubjectTable: "storeFrontActor",
      debugSubjectId: String(args.storeFrontUserId),
      sourceRefs,
      dataWindowStartAt: bundle.dataWindowStartAt,
      dataWindowEndAt: bundle.dataWindowEndAt,
    });
    if (runIdResult.kind === "error") return runIdResult;
    const runId = runIdResult.runId;

    try {
    const contextSnapshotId: Id<"intelligenceContextSnapshot"> = await ctx.runMutation(
      internal.intelligence.runs.recordContextSnapshot,
      {
        runId,
        snapshotHash,
        payloadSummary: built.snapshot,
        payloadRedaction: bundle.payloadRedaction,
        ...getBundleSnapshotFields(bundle),
      },
    );

    await ctx.runMutation(internal.intelligence.runs.markRunRunning, { runId });
    const providerInvocationId = await recordProviderStarted(ctx, {
      runId,
      contextSnapshotId,
      providerKey: resolveProviderId(args.provider),
      providerModel: resolveProviderModel(),
      requestSummary: {
        schema: userInsightsSchema.name,
        promptCharacters: built.prompt.length,
      },
    });

    const providerResult = await runStructuredProvider({
      provider: args.provider,
      prompt: built.prompt,
      schema: userInsightsSchema,
      metadata: {
        capability: USER_INSIGHTS_CAPABILITY,
        storeId: String(args.storeId),
        storeFrontUserId: String(args.storeFrontUserId),
        snapshotHash,
      },
    });

    if (providerResult.status !== "succeeded") {
      await recordProviderFailure(ctx, {
        runId,
        invocationId: providerInvocationId,
        error: providerResult.error,
      });
      return failedGenerationResult(providerResult.error.message);
    }

    const payload = normalizeUserInsightsOutput(providerResult.output);
    const limitedEvidence =
      bundle.limitedEvidence || !hasEvidenceBackedRecommendations(payload, sourceRefs);

    await recordProviderSucceeded(ctx, {
      invocationId: providerInvocationId,
      providerModel: providerResult.metadata.modelId,
      responseSummary: {
        outputKeys: Object.keys(providerResult.output),
        limitedEvidence,
      },
    });

    const artifactId: Id<"intelligenceArtifact"> = await ctx.runMutation(internal.intelligence.runs.completeRunWithArtifact, {
      runId,
      contextSnapshotId,
      kind: "user_insights",
      subjectTable: "storeFrontActor",
      subjectId: String(args.storeFrontUserId),
      title: "Customer insights",
      summary: payload.summary,
      payload,
      evidenceRefs: sourceRefs,
      confidence: limitedEvidence ? 0.35 : 0.75,
      limitedEvidence,
    });

    return { kind: "ok" as const, artifactId, payload };
    } catch (error) {
      await failRunBestEffort(ctx, runId, error);
      throw error;
    }
  },
});

function resolveProviderId(provider?: string) {
  return provider === "fake" ? "fake" : "tanstack-openai";
}

function resolveProviderModel() {
  return process.env.ATHENA_INTELLIGENCE_OPENAI_MODEL ?? "gpt-4.1-mini";
}

function buildProviderRegistry(provider?: string) {
  const fakeOutput = provider === "fake" ? defaultFakeOutput() : undefined;

  return createAthenaProviderRegistry([
    createFakeStructuredTextProvider({ output: fakeOutput }),
    createTanStackStructuredTextProvider({
      id: "tanstack-openai",
      label: "TanStack AI OpenAI structured text",
      modelId: resolveProviderModel(),
      apiKey: process.env.OPENAI_API_KEY,
    }),
  ]);
}

async function createIntelligenceRun(
  ctx: ActionCtx,
  args: CreateIntelligenceRunArgs,
): Promise<
  | {
      kind: "ok";
      runId: Id<"intelligenceRun">;
    }
  | {
      kind: "error";
      message: string;
    }
> {
  try {
    return {
      kind: "ok",
      runId: await ctx.runMutation(internal.intelligence.runs.ensureRun, args),
    };
  } catch (error) {
    if (isInsightGenerationInProgressError(error)) {
      return failedGenerationResult(insightGenerationInProgressMessage);
    }

    throw error;
  }
}

export function isInsightGenerationInProgressError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("An Athena insight is already being generated")
  );
}

async function runStructuredProvider({
  provider,
  prompt,
  schema,
  metadata,
}: {
  provider?: string;
  prompt: string;
  schema: typeof storeInsightsSchema | typeof userInsightsSchema;
  metadata: Record<string, string>;
}): Promise<AthenaStructuredTextResult> {
  const abortController = new AbortController();
  const providerPromise = invokeStructuredTextProvider({
    registry: buildProviderRegistry(provider),
    providerId: resolveProviderId(provider),
    request: {
      capability: ATHENA_STRUCTURED_TEXT_V1,
      messages: [{ role: "user", content: prompt }],
      outputSchema: schema,
      abortController,
      signal: abortController.signal,
      temperature: 0.2,
      maxTokens: 900,
      metadata,
    },
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<AthenaStructuredTextResult>((resolve) => {
    timeout = setTimeout(() => {
      abortController.abort("provider_timeout");
      resolve(
        createProviderFailureResult({
          code: "provider_failure",
          capability: ATHENA_STRUCTURED_TEXT_V1,
          retryable: true,
          message: "The intelligence provider timed out.",
        }),
      );
    }, PROVIDER_TIMEOUT_MS);
  });

  try {
    return await Promise.race([providerPromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function recordProviderStarted(
  ctx: ActionCtx,
  args: {
    runId: Id<"intelligenceRun">;
    contextSnapshotId: Id<"intelligenceContextSnapshot">;
    providerKey: string;
    providerModel?: string;
    requestSummary: Record<string, unknown>;
  },
) {
  return ctx.runMutation(internal.intelligence.runs.recordProviderInvocation, {
    runId: args.runId,
    contextSnapshotId: args.contextSnapshotId,
    providerKey: args.providerKey,
    providerModel: args.providerModel,
    status: "started",
    requestSummary: args.requestSummary,
    rawPayloadStored: false,
  });
}

async function recordProviderSucceeded(
  ctx: ActionCtx,
  args: {
    invocationId: Id<"intelligenceProviderInvocation">;
    providerModel?: string;
    responseSummary: Record<string, unknown>;
  },
) {
  await ctx.runMutation(internal.intelligence.runs.updateProviderInvocation, {
    invocationId: args.invocationId,
    providerModel: args.providerModel,
    status: "succeeded",
    responseSummary: args.responseSummary,
    rawPayloadStored: false,
  });
}

async function recordProviderFailure(
  ctx: ActionCtx,
  args: {
    runId: Id<"intelligenceRun">;
    invocationId: Id<"intelligenceProviderInvocation">;
    error: PersistedIntelligenceError;
  },
) {
  const persistedError = toPersistedIntelligenceError(args.error);

  await ctx.runMutation(internal.intelligence.runs.updateProviderInvocation, {
    invocationId: args.invocationId,
    status: "failed",
    responseSummary: {
      failureCode: persistedError.code,
    },
    rawPayloadStored: false,
    error: persistedError,
  });
  await ctx.runMutation(internal.intelligence.runs.failRun, {
    runId: args.runId,
    error: persistedError,
  });
}

export function toPersistedIntelligenceError(
  error: PersistedIntelligenceError,
): PersistedIntelligenceError {
  return {
    code: error.code,
    message: error.message,
    ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
    retryable: error.retryable,
  };
}

async function failRunBestEffort(
  ctx: ActionCtx,
  runId: Id<"intelligenceRun">,
  error: unknown,
) {
  try {
    await ctx.runMutation(internal.intelligence.runs.failRun, {
      runId,
      error: {
        code: "internal_failure",
        message:
          error instanceof Error &&
          error.message === "The intelligence provider timed out."
            ? "The intelligence provider timed out."
            : "The intelligence run could not finish.",
        retryable: true,
      },
    });
  } catch {}
}

function failedGenerationResult(message: string) {
  return {
    kind: "error" as const,
    message,
  };
}

function defaultFakeOutput() {
  return {
    summary: "Athena generated a test insight from the available activity.",
    peak_activity_times: "unknown",
    popular_actions: ["viewed product"],
    engagement_level: "medium",
    device_preference: "unknown",
    likely_intent: "browsing",
    activity_status: "active",
    recommendations: ["Review recent customer activity before outreach."],
  };
}

function getBundleSnapshotFields(bundle: InsightContextBundle) {
  return {
    bundleKind: bundle.bundleKind,
    bundleVersion: bundle.bundleVersion,
    freshness: bundle.freshness,
    hiddenSourceCount: bundle.hiddenSourceCount,
    omittedEvidenceCount: bundle.omittedEvidenceCount,
    redactionMode: bundle.redactionMode,
    qualityFlags: bundle.qualityFlags,
    limitedEvidence: bundle.limitedEvidence,
  };
}

function getStoreInsightsSnapshotFallback(snapshot: Record<string, unknown>) {
  const deviceDistribution = snapshot.deviceDistribution;
  const activityTrend = snapshot.activityTrend;

  return {
    device_distribution: isDeviceDistribution(deviceDistribution)
      ? deviceDistribution
      : { desktop: "0%", mobile: "0%", unknown: "100%" },
    activity_trend: isActivityTrend(activityTrend) ? activityTrend : "unknown",
  };
}

function isDeviceDistribution(
  value: unknown,
): value is ReturnType<typeof normalizeStoreInsightsOutput>["device_distribution"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.desktop === "string" &&
    typeof record.mobile === "string" &&
    typeof record.unknown === "string"
  );
}

function isActivityTrend(
  value: unknown,
): value is ReturnType<typeof normalizeStoreInsightsOutput>["activity_trend"] {
  return (
    value === "increasing" ||
    value === "steady" ||
    value === "decreasing" ||
    value === "unknown"
  );
}
