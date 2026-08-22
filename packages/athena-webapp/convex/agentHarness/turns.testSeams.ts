/**
 * Test-only turn seams bound to U4's test package and U6's test executor seams.
 *
 * Two-dot basename on purpose: never bundled, never linted as ingress.
 * convex-test loads it under the aliased module key `./agentHarness/testTurns.ts`,
 * so `agentHarness/testTurns:<export>` references resolve to the functions
 * this module exports. The host tests bind U7's runtime host to these refs so
 * the same orchestration runs against the fake and the Convex adapter.
 */
import { anyApi, type FunctionReference } from "convex/server";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { TEST_ADMISSION, TEST_NOW_BASE, TEST_PROFILE_ID, seedDelegatedOperator } from "./delegatedAdmission.testPorts";
import { createCompletionOutbox } from "./completionOutbox";
import { TEST_EXECUTOR_SEAMS } from "./executor.testSeams";
import type { AgentToolSeamRefs } from "./tools";
import { createAgentTurnSeams } from "./turns";
import { recordTurnIntentWithCtx } from "./turnBindings";
import { prepareDelegatedRunGrantWithCtx } from "./grants";

export const TEST_OUTBOX = createCompletionOutbox({ admission: TEST_ADMISSION });

export const TEST_TURN_SEAMS = createAgentTurnSeams({
  admission: TEST_ADMISSION,
  outbox: TEST_OUTBOX,
  // The contract-fake provider is "configured" only in tests.
  isProviderConfigured: (providerId) => providerId === "athena_contract_fake",
});

export const describeGrant = TEST_TURN_SEAMS.functions.describeGrant;
export const prepareTurn = TEST_TURN_SEAMS.functions.prepareTurn;
export const markTurnRunning = TEST_TURN_SEAMS.functions.markTurnRunning;
export const recordRuntimeTurnRef = TEST_TURN_SEAMS.functions.recordRuntimeTurnRef;
export const recordTurnProgress = TEST_TURN_SEAMS.functions.recordTurnProgress;
export const peekTurnState = TEST_TURN_SEAMS.functions.peekTurnState;
export const finalizeTurn = TEST_TURN_SEAMS.functions.finalizeTurn;
export const prepareCompletion = TEST_OUTBOX.functions.prepareCompletion;
export const loadProjection = TEST_OUTBOX.functions.loadProjection;
export const recordProjection = TEST_OUTBOX.functions.recordProjection;
export const recordProjectionFailure = TEST_OUTBOX.functions.recordProjectionFailure;
export const suppressRelease = TEST_OUTBOX.functions.suppressRelease;
export const listOutboxDue = TEST_OUTBOX.functions.listOutboxDue;

type AnyRef = FunctionReference<"query" | "mutation", "internal">;
const turns = (anyApi as unknown as { agentHarness: { testTurns: Record<string, AnyRef>; testSeams: Record<string, AnyRef> } }).agentHarness;

/** References the runtime host under test calls; resolved by convex-test through the aliased module keys. */
export const TEST_TURN_REFS = {
  describeGrant: turns.testTurns.describeGrant,
  prepareTurn: turns.testTurns.prepareTurn,
  markTurnRunning: turns.testTurns.markTurnRunning,
  recordRuntimeTurnRef: turns.testTurns.recordRuntimeTurnRef,
  recordTurnProgress: turns.testTurns.recordTurnProgress,
  peekTurnState: turns.testTurns.peekTurnState,
  finalizeTurn: turns.testTurns.finalizeTurn,
  prepareCompletion: turns.testTurns.prepareCompletion,
  loadProjection: turns.testTurns.loadProjection,
  recordProjection: turns.testTurns.recordProjection,
  recordProjectionFailure: turns.testTurns.recordProjectionFailure,
  suppressRelease: turns.testTurns.suppressRelease,
  listOutboxDue: turns.testTurns.listOutboxDue,
  recordScratch: turns.testSeams.recordScratch,
  completeRun: turns.testSeams.completeRun,
  advanceTurnBinding: (anyApi as unknown as { agentHarness: { turnBindings: Record<string, AnyRef> } }).agentHarness.turnBindings.advanceTurnBinding,
};

export const TEST_TOOL_REFS: AgentToolSeamRefs = {
  describeGrant: TEST_TURN_REFS.describeGrant as AgentToolSeamRefs["describeGrant"],
  recordScratch: TEST_TURN_REFS.recordScratch as AgentToolSeamRefs["recordScratch"],
  prepareCompletion: TEST_TURN_REFS.prepareCompletion as AgentToolSeamRefs["prepareCompletion"],
  completeRun: TEST_TURN_REFS.completeRun as AgentToolSeamRefs["completeRun"],
};

/**
 * A recorded (not yet driven) turn for one operator: exactly what the public
 * `startTurn` leaves behind, minus admission. The host drives it from
 * `intent_recorded`.
 */
export async function seedRecordedTurn(
  ctx: MutationCtx,
  slug: string,
  options: { role?: "full_admin" | "pos_only"; operationalRoles?: ("manager" | "cashier")[]; key?: string; threadKey?: string; question?: string; now?: number; operator?: Awaited<ReturnType<typeof seedDelegatedOperator>> } = {},
) {
  const now = options.now ?? TEST_NOW_BASE;
  const operator = options.operator ?? (await seedDelegatedOperator(ctx, slug, { role: options.role ?? "full_admin", operationalRoles: options.operationalRoles }));
  const prepared = await prepareDelegatedRunGrantWithCtx(ctx, TEST_ADMISSION.config, {
    operator: { kind: "normal_user", athenaUserId: operator.userId },
    profileId: TEST_PROFILE_ID,
    organizationId: operator.organizationId,
    storeId: operator.storeId,
    now,
  });
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const intent = await recordTurnIntentWithCtx(ctx, {
    ...prepared.runInput,
    turnIdempotencyKey: options.key ?? `turn-${slug}`,
    threadKey: options.threadKey ?? `thread-${slug}`,
    promptPayload: { question: options.question ?? "Which shifts are open?", context: { operatingDate: "2026-08-21" } },
    now,
  });
  if (intent.outcome !== "created") throw new Error(intent.outcome);
  return { operator, bindingId: intent.bindingId as Id<"agentTurnBinding">, runId: intent.runId as Id<"intelligenceRun"> };
}

export { TEST_EXECUTOR_SEAMS };
