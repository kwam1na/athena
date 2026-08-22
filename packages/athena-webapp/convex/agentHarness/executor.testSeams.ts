/**
 * Test-only executor seams bound to the delegated-admission test package
 * (`delegatedAdmission.testPorts.ts`).
 *
 * Two-dot basename on purpose: never bundled, never linted as ingress.
 * convex-test loads it under the aliased module key `./agentHarness/testSeams.ts`,
 * so the function references below (`agentHarness/testSeams:<export>`) resolve
 * to the registered functions this module exports.
 */
import type { TestConvex } from "convex-test";
import { anyApi } from "convex/server";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type schema from "../schema";
import type { AgentCapabilityRequest } from "../../shared/agentHarness/bridge";
import {
  TEST_ADMISSION,
  TEST_EVIDENCE_EXTRACTORS,
  TEST_MANIFESTS,
  TEST_NOW_BASE,
  TEST_PROFILE_ID,
  seedDelegatedOperator,
} from "./delegatedAdmission.testPorts";
import { buildCapabilitySchemaIndex, createAgentExecutorSeams, type AgentExecutorSeamRefs, type AgentSettleCallOutcome } from "./executorSeams";
import { markAgentRunRunningWithCtx } from "./lifecycle";
import { recordTurnIntentWithCtx } from "./turnBindings";

export type TestBridgeRequest = {
  capabilityId: string;
  namespace: string;
  verb: "get" | "list";
  args: AgentCapabilityRequest["args"];
  projections?: readonly string[];
  cursor?: string;
};

export const TEST_SCHEMAS = buildCapabilitySchemaIndex(TEST_MANIFESTS);

export const TEST_EXECUTOR_SEAMS = createAgentExecutorSeams({
  admission: TEST_ADMISSION,
  schemas: TEST_SCHEMAS,
  resolveEvidenceExtractor: (capabilityId) => TEST_EVIDENCE_EXTRACTORS[capabilityId],
});

export const prepareAttempt = TEST_EXECUTOR_SEAMS.functions.prepareAttempt;
export const beginAttempt = TEST_EXECUTOR_SEAMS.functions.beginAttempt;
export const reserveAndAdmitCall = TEST_EXECUTOR_SEAMS.functions.reserveAndAdmitCall;
export const settleCall = TEST_EXECUTOR_SEAMS.functions.settleCall;
export const finishAttempt = TEST_EXECUTOR_SEAMS.functions.finishAttempt;
export const completeRun = TEST_EXECUTOR_SEAMS.functions.completeRun;
export const recordScratch = TEST_EXECUTOR_SEAMS.functions.recordScratch;
export const heartbeatAttempt = TEST_EXECUTOR_SEAMS.functions.heartbeatAttempt;
export const loadAttemptReplayInputs = TEST_EXECUTOR_SEAMS.functions.loadAttemptReplayInputs;
export const describeAttemptExposure = TEST_EXECUTOR_SEAMS.functions.describeAttemptExposure;
export const readCitationEvidence = TEST_EXECUTOR_SEAMS.functions.readCitationEvidence;

const seams = (anyApi as unknown as { agentHarness: { testSeams: Record<string, unknown> } }).agentHarness.testSeams;

// ---------------------------------------------------------------------------
// Shared seeding and bridge helpers for the program executor test files
// ---------------------------------------------------------------------------

export type SeededDelegatedRun = {
  readonly operator: Awaited<ReturnType<typeof seedDelegatedOperator>>;
  readonly runId: Id<"intelligenceRun">;
  readonly grantId: Id<"agentRunGrant">;
  readonly bindingId?: Id<"agentTurnBinding">;
};

/**
 * A running delegated run for one operator. With `withBinding`, the run is
 * created through the lifecycle turn binding (so `operator_release_committed` and
 * `operatorViewedAt` exist); otherwise it is materialized directly.
 */
export async function seedDelegatedRun(
  ctx: MutationCtx,
  slug: string,
  options: {
    role?: "full_admin" | "pos_only";
    operationalRoles?: ("manager" | "cashier")[];
    withBinding?: boolean;
    key?: string;
    now?: number;
  } = {},
): Promise<SeededDelegatedRun> {
  const now = options.now ?? TEST_NOW_BASE;
  const operator = await seedDelegatedOperator(ctx, slug, { role: options.role ?? "full_admin", operationalRoles: options.operationalRoles });
  const request = {
    operator: { kind: "normal_user" as const, athenaUserId: operator.userId },
    profileId: TEST_PROFILE_ID,
    organizationId: operator.organizationId,
    storeId: operator.storeId,
    now,
  };
  if (options.withBinding) {
    const prepared = await TEST_ADMISSION.prepareRunGrantWithCtx(ctx, request);
    if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
    const intent = await recordTurnIntentWithCtx(ctx, {
      ...prepared.runInput,
      turnIdempotencyKey: options.key ?? `turn-${slug}`,
      runtimeThreadRef: `runtime_thread:${slug}`,
      promptPayload: { prompt: `question ${slug}` },
      promptPayloadHash: "sha256:prompt",
      now,
    });
    if (intent.outcome !== "created") throw new Error(intent.outcome);
    await markAgentRunRunningWithCtx(ctx, { runId: intent.runId, now });
    const run = await ctx.db.get("intelligenceRun", intent.runId);
    return { operator, runId: intent.runId, grantId: run!.runGrantId!, bindingId: intent.bindingId };
  }
  const materialized = await TEST_ADMISSION.materializeRunGrantWithCtx(ctx, {
    ...request,
    promptPayloadHash: "sha256:prompt",
    runIdempotencyKey: options.key ?? `turn-${slug}`,
  });
  if (materialized.kind !== "materialized") throw new Error(JSON.stringify(materialized));
  await markAgentRunRunningWithCtx(ctx, { runId: materialized.runId, now });
  return { operator, runId: materialized.runId, grantId: materialized.grantId };
}

/** The convex-test harness over the app schema (this module is test-only: two-dot basename). */
export type TestHarnessLike = TestConvex<typeof schema>;

type AnyCall = (reference: unknown, args: unknown) => Promise<unknown>;

/** Begin an executing attempt through the seam with an already-valid program. */
export async function beginExecutingAttempt(
  ctx: MutationCtx,
  run: { runId: Id<"intelligenceRun"> },
  options: { key?: string; source?: string; now?: number } = {},
) {
  const now = options.now ?? TEST_NOW_BASE;
  const prepared = await TEST_EXECUTOR_SEAMS.prepareAttemptWithCtx(ctx, { runId: run.runId, now });
  if (prepared.outcome !== "ready") throw new Error(JSON.stringify(prepared));
  const source = options.source ?? "const r = await athena.ops.shifts.list({ status: 'open' });\nreturn { r };";
  const begun = await TEST_EXECUTOR_SEAMS.beginAttemptWithCtx(ctx, {
    runId: run.runId,
    attemptIdempotencyKey: options.key ?? "attempt-1",
    programSource: source,
    validation: { ok: true, validatedSource: `async function __athena_program() {\n"use strict";\n${source}\n}\n` },
    facade: prepared.facade,
    now,
  });
  if (begun.outcome !== "executing") throw new Error(JSON.stringify(begun));
  return { attemptId: begun.attemptId, sequence: begun.sequence, facade: prepared.facade, ceilings: prepared.ceilings };
}

/** The bridge sequence the executor runs: reserve (mutation) → port (query) → settle (mutation). */
export async function bridgeCall(
  t: TestHarnessLike,
  run: { runId: Id<"intelligenceRun"> },
  attemptId: Id<"agentProgramAttempt">,
  request: TestBridgeRequest,
  options: { key?: string; now?: number; between?: () => Promise<void>; elapsedMs?: number } = {},
): Promise<{ admit: Awaited<ReturnType<typeof TEST_EXECUTOR_SEAMS.reserveAndAdmitCallWithCtx>>; settled?: AgentSettleCallOutcome }> {
  const now = options.now ?? TEST_NOW_BASE + 10;
  const admit = await t.run((ctx) =>
    TEST_EXECUTOR_SEAMS.reserveAndAdmitCallWithCtx(ctx, {
      runId: run.runId,
      attemptId,
      callIdempotencyKey: options.key ?? `call-${request.namespace}-${JSON.stringify(request.args)}-${request.cursor ?? ""}`,
      request: request as AgentCapabilityRequest,
      now,
    }),
  );
  if (admit.outcome !== "admitted") return { admit };
  const query = t.query as unknown as AnyCall;
  const response = await TEST_EXECUTOR_SEAMS.dispatchReadPort({ runQuery: (reference, args) => query(reference, args) as never }, admit.invocation);
  await options.between?.();
  const settled = await t.run((ctx) =>
    TEST_EXECUTOR_SEAMS.settleCallWithCtx(ctx, { callId: admit.callId, response, elapsedMs: options.elapsedMs ?? 5, now: now + 5 }),
  );
  return { admit, settled };
}

/** References the executor under test calls; resolved by convex-test through the aliased module key. */
export const TEST_SEAM_REFS: AgentExecutorSeamRefs = {
  prepareAttempt: seams.prepareAttempt as AgentExecutorSeamRefs["prepareAttempt"],
  beginAttempt: seams.beginAttempt as AgentExecutorSeamRefs["beginAttempt"],
  reserveAndAdmitCall: seams.reserveAndAdmitCall as AgentExecutorSeamRefs["reserveAndAdmitCall"],
  settleCall: seams.settleCall as AgentExecutorSeamRefs["settleCall"],
  finishAttempt: seams.finishAttempt as AgentExecutorSeamRefs["finishAttempt"],
  heartbeatAttempt: seams.heartbeatAttempt as AgentExecutorSeamRefs["heartbeatAttempt"],
  loadAttemptReplayInputs: seams.loadAttemptReplayInputs as AgentExecutorSeamRefs["loadAttemptReplayInputs"],
};
