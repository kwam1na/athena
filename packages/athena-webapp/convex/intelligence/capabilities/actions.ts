import { v } from "convex/values";

import { action, type ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import {
  ATHENA_STRUCTURED_TEXT_V1,
  type AthenaStructuredTextSchema,
} from "../types";
import {
  createAthenaProviderRegistry,
  invokeStructuredTextProvider,
} from "../registry";
import {
  createFakeStructuredTextProvider,
  createTanStackStructuredTextProvider,
} from "../providers";
import {
  buildSnapshotHash,
  buildSourceRefs,
  buildStoreInsightsPrompt,
  buildUserInsightsPrompt,
  hasEvidenceBackedRecommendations,
  normalizeStoreInsightsOutput,
  normalizeUserInsightsOutput,
} from "./insights";

const STORE_INSIGHTS_CAPABILITY = "storeInsights";
const USER_INSIGHTS_CAPABILITY = "userInsights";

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
    const analytics = await ctx.runQuery(internal.storeFront.analytics.getAllInternal, {
      storeId: args.storeId,
    });
    const built = buildStoreInsightsPrompt(analytics);
    const snapshotHash = buildSnapshotHash(built.snapshot);
    const sourceRefs = buildSourceRefs(analytics);
    const dataWindow = getDataWindow(analytics);

    const runId: Id<"intelligenceRun"> = await ctx.runMutation(internal.intelligence.runs.ensureRun, {
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
      sourceRefs,
      dataWindowStartAt: dataWindow.startAt,
      dataWindowEndAt: dataWindow.endAt,
    });

    const contextSnapshotId: Id<"intelligenceContextSnapshot"> = await ctx.runMutation(
      internal.intelligence.runs.recordContextSnapshot,
      {
        runId,
        snapshotHash,
        payloadSummary: built.snapshot,
        payloadRedaction: "analytics rows compacted; user contact fields omitted",
      },
    );

    await ctx.runMutation(internal.intelligence.runs.markRunRunning, { runId });

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
        contextSnapshotId,
        providerKey: resolveProviderId(args.provider),
        error: providerResult.error,
      });
      return failedGenerationResult(providerResult.error.message);
    }

    const payload = normalizeStoreInsightsOutput(providerResult.output, {
      device_distribution: built.snapshot.deviceDistribution,
      activity_trend: built.snapshot.activityTrend,
    });
    const limitedEvidence = !hasEvidenceBackedRecommendations(payload, sourceRefs);

    await ctx.runMutation(internal.intelligence.runs.recordProviderInvocation, {
      runId,
      contextSnapshotId,
      providerKey: providerResult.metadata.providerId,
      providerModel: providerResult.metadata.modelId,
      status: "succeeded",
      requestSummary: {
        schema: storeInsightsSchema.name,
        promptCharacters: built.prompt.length,
      },
      responseSummary: {
        outputKeys: Object.keys(providerResult.output),
        limitedEvidence,
      },
      rawPayloadStored: false,
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
    const analytics = await ctx.runQuery(
      internal.storeFront.user.getStoreUserActivityInternal,
      { id: args.storeFrontUserId, storeId: args.storeId },
    );
    const built = buildUserInsightsPrompt(analytics);
    const snapshotHash = buildSnapshotHash(built.snapshot);
    const sourceRefs = buildSourceRefs(analytics);
    const dataWindow = getDataWindow(analytics);

    const runId: Id<"intelligenceRun"> = await ctx.runMutation(internal.intelligence.runs.ensureRun, {
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
      sourceRefs: [
        { table: "storeFrontUser", id: String(args.storeFrontUserId) },
        ...sourceRefs,
      ],
      dataWindowStartAt: dataWindow.startAt,
      dataWindowEndAt: dataWindow.endAt,
    });

    const contextSnapshotId: Id<"intelligenceContextSnapshot"> = await ctx.runMutation(
      internal.intelligence.runs.recordContextSnapshot,
      {
        runId,
        snapshotHash,
        payloadSummary: built.snapshot,
        payloadRedaction: "analytics rows compacted; contact fields omitted",
      },
    );

    await ctx.runMutation(internal.intelligence.runs.markRunRunning, { runId });

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
        contextSnapshotId,
        providerKey: resolveProviderId(args.provider),
        error: providerResult.error,
      });
      return failedGenerationResult(providerResult.error.message);
    }

    const payload = normalizeUserInsightsOutput(providerResult.output);
    const limitedEvidence = !hasEvidenceBackedRecommendations(payload, sourceRefs);

    await ctx.runMutation(internal.intelligence.runs.recordProviderInvocation, {
      runId,
      contextSnapshotId,
      providerKey: providerResult.metadata.providerId,
      providerModel: providerResult.metadata.modelId,
      status: "succeeded",
      requestSummary: {
        schema: userInsightsSchema.name,
        promptCharacters: built.prompt.length,
      },
      responseSummary: {
        outputKeys: Object.keys(providerResult.output),
        limitedEvidence,
      },
      rawPayloadStored: false,
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
}) {
  return invokeStructuredTextProvider({
    registry: buildProviderRegistry(provider),
    providerId: resolveProviderId(provider),
    request: {
      capability: ATHENA_STRUCTURED_TEXT_V1,
      messages: [{ role: "user", content: prompt }],
      outputSchema: schema,
      temperature: 0.2,
      maxTokens: 900,
      metadata,
    },
  });
}

async function recordProviderFailure(
  ctx: ActionCtx,
  args: {
    runId: Id<"intelligenceRun">;
    contextSnapshotId: Id<"intelligenceContextSnapshot">;
    providerKey: string;
    error: {
      code: string;
      message: string;
      retryable: boolean;
    };
  },
) {
  await ctx.runMutation(internal.intelligence.runs.recordProviderInvocation, {
    runId: args.runId,
    contextSnapshotId: args.contextSnapshotId,
    providerKey: args.providerKey,
    status: "failed",
    requestSummary: {
      failureCode: args.error.code,
    },
    rawPayloadStored: false,
    error: args.error,
  });
  await ctx.runMutation(internal.intelligence.runs.failRun, {
    runId: args.runId,
    error: args.error,
  });
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

function getDataWindow(analytics: Array<{ _creationTime: number }>) {
  if (analytics.length === 0) return {};

  const times = analytics.map((item) => item._creationTime);

  return {
    startAt: Math.min(...times),
    endAt: Math.max(...times),
  };
}
