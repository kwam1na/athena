// @vitest-environment node
/// <reference types="vite/client" />
/**
 * Program executor end to end (plan U6 scenarios 1–13; ticket V26-1264):
 * the real QuickJS sandbox, Athena validation, and the executor seams under
 * convex-test against U4's proven test package. Every durable effect is
 * asserted on the rows: budgets shared across retries, deduplicated
 * concurrent reads, truncation and mixed freshness, citations bound to the
 * attempt and hash, normalized failure diagnostics, exactly one output,
 * conservative settlement on timeout/cancel, egress inheritance through
 * arbitrary transforms, revocation races with truthful exposure, replay
 * inside the window, and the provider-visible boundary through U2's fake
 * runtime adapter and tool ledger.
 */
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import {
  createAgentToolDispatchLedger,
  type AgentRuntimeEvent,
  type AgentRuntimeTurnHooks,
  type AgentToolDefinition,
  type AgentToolRegistration,
} from "../../shared/agentHarness/agentRuntime";
import { createAgentRuntimeContractFake } from "../../shared/agentHarness/agentRuntimeFake";
import { SHORT_LIVED_RETENTION_MS, budgetVector } from "../../shared/agentHarness/execution";
import { opaqueRef } from "../../shared/agentHarness/values";
import {
  SHIFTS_MANIFEST,
  TEST_CLOCK,
  TEST_ENABLEMENT,
  TEST_NOW_BASE,
  TEST_PORT_BEHAVIOR,
  TEST_PROFILE_ID,
} from "./delegatedAdmission.testPorts";
import { createProgramExecutor, type AgentExecuteProgramResult, type AgentExecutorCtx, type AgentProgramExecutorConfig } from "./executor";
import { TEST_EXECUTOR_SEAMS, TEST_SEAM_REFS, seedDelegatedRun } from "./executor.testSeams";
import { cancelAgentRunWithCtx, getBudgetLedgerForRun, listCapabilityCallsForRun, listProgramAttemptsForRun } from "./lifecycle";
import { createQuickJsProgramRuntime } from "./programRuntime/quickJsRuntime";
import type { AgentProgramRuntime } from "./programRuntime/types";
import type { AgentReadPortDispatchCtx, AgentReadPortInvocation } from "./readPorts";
import { sweepExpiredAgentContentWithCtx } from "./retention";
import { acknowledgeOperatorViewWithCtx } from "./turnBindings";

vi.mock("../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx: vi.fn(),
}));

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);
modules["./agentHarness/testPorts.ts"] = modules["./agentHarness/delegatedAdmission.testPorts.ts"];
modules["./agentHarness/testSeams.ts"] = modules["./agentHarness/executor.testSeams.ts"];

type Harness = TestConvex<typeof schema>;
type AnyCall = (reference: unknown, args: unknown) => Promise<unknown>;

let runtimePromise: Promise<AgentProgramRuntime> | undefined;
const runtime = () => (runtimePromise ??= createQuickJsProgramRuntime());

function executorCtx(t: Harness): AgentExecutorCtx {
  return {
    runQuery: (reference, args) => (t.query as unknown as AnyCall)(reference, args),
    runMutation: (reference, args) => (t.mutation as unknown as AnyCall)(reference, args),
  };
}

type DispatchHook = (ctx: AgentReadPortDispatchCtx, invocation: AgentReadPortInvocation) => Promise<unknown>;

async function makeExecutor(options: Partial<AgentProgramExecutorConfig> & { dispatchDelayMs?: number } = {}) {
  const dispatch: DispatchHook = async (ctx, invocation) => {
    if (options.dispatchDelayMs) await new Promise((resolve) => setTimeout(resolve, options.dispatchDelayMs));
    return TEST_EXECUTOR_SEAMS.dispatchReadPort(ctx, invocation);
  };
  return createProgramExecutor({
    runtime: await runtime(),
    seams: TEST_SEAM_REFS,
    dispatchReadPort: dispatch as AgentProgramExecutorConfig["dispatchReadPort"],
    clock: () => TEST_CLOCK.now,
    heartbeatMs: 10_000,
    ...options,
    ceilingOverrides: { maxElapsedMs: 5_000, ...options.ceilingOverrides },
  });
}

const PROGRAM_BASIC = `const shifts = await athena.ops.shifts.list({ status: "open" });
const day = await athena.ops.storeDay.get({ operatingDate: "2026-08-21" });
return { shifts: shifts.kind, day: day.kind, open: shifts.kind === "result" ? shifts.envelope.data.length : -1 };`;

const DIAG_KEYS = ["elapsedMs", "hostCalls", "maxInFlight", "bridgeArgsBytes", "bridgeOutputBytes", "resultBytes", "sourceBytes"];

function expectResult(result: AgentExecuteProgramResult) {
  expect(result.outcome, JSON.stringify(result)).toBe("result");
  if (result.outcome !== "result") throw new Error("unreachable");
  return result;
}

beforeEach(() => {
  TEST_ENABLEMENT.reset();
  TEST_CLOCK.now = TEST_NOW_BASE;
  TEST_PORT_BEHAVIOR.shifts = "normal";
});

describe("one execution path: validate → attempt → sandbox → one async bridge → one result", () => {
  it("admits registered reads through the bridge, returns exactly one structured result with citations, commits provider egress, and leaves the run running", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "basic"));
    const executor = await makeExecutor();
    const result = expectResult(await executor.executeProgram(executorCtx(t), { runId: run.runId, attemptIdempotencyKey: "a1", source: PROGRAM_BASIC }));

    expect(result.result.output).toEqual({ shifts: "result", day: "result", open: 1 });
    expect(result.result).toMatchObject({ completeness: { status: "complete" }, egressClass: "sensitive", freshness: { classes: ["live"], mixed: false } });
    expect(result.result.outputHash).toMatch(/^sha256:/);
    expect(result.resultHash).toMatch(/^sha256:/);
    expect(result.attemptRef).toMatch(/^attempt_v1\.1\./);
    expect(result.citations.map((candidate) => candidate.namespace)).toEqual(["ops.shifts", "ops.storeDay"]);
    expect(result.result.derivedFromCallRefs).toEqual(result.citations.map((candidate) => candidate.citation));
    expect(result.providerEgress).toMatchObject({ state: "committed", at: TEST_NOW_BASE });
    expect(result.replayed).toBe(false);
    expect(result.diagnostics).toMatchObject({ hostCalls: 2, maxInFlight: 1 });
    expect(result.calls.map((call) => [call.namespace, call.outcome, call.deduplicated])).toEqual([
      ["ops.shifts", "result", false],
      ["ops.storeDay", "result", false],
    ]);

    const rows = await t.run(async (ctx) => ({
      run: await ctx.db.get("intelligenceRun", run.runId),
      attempts: await listProgramAttemptsForRun(ctx, run.runId),
      calls: await listCapabilityCallsForRun(ctx, run.runId),
      ledger: await getBudgetLedgerForRun(ctx, run.runId),
    }));
    expect(rows.run?.status).toBe("running");
    expect(rows.attempts).toHaveLength(1);
    expect(rows.attempts[0]).toMatchObject({ status: "result_produced", resultHash: result.resultHash, egressClass: "sensitive", completeness: "complete", providerEgress: { state: "committed" } });
    expect(rows.calls.map((call) => call.status)).toEqual(["succeeded", "succeeded"]);
    expect(rows.ledger?.charged.calls).toBe(2);
    expect(rows.ledger?.outstanding).toEqual(budgetVector({}));
  });

  it("creates a diagnostic attempt for a rejected program that consumes no read budget but counts toward the attempt cap", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "rejected"));
    const executor = await makeExecutor();
    const ctx = executorCtx(t);
    const rejected = await executor.executeProgram(ctx, { runId: run.runId, attemptIdempotencyKey: "a1", source: `const x = await athena.ops.shifts.list({ status: "open" });` });
    expect(rejected).toMatchObject({ outcome: "rejected", issues: [{ code: "missing_output" }] });
    const rows = await t.run(async (ctx) => ({ attempts: await listProgramAttemptsForRun(ctx, run.runId), ledger: await getBudgetLedgerForRun(ctx, run.runId) }));
    expect(rows.attempts[0]).toMatchObject({ status: "rejected", error: { code: "program_rejected" } });
    expect(rows.ledger).toMatchObject({ charged: budgetVector({}), outstanding: budgetVector({}), attemptCount: 1 });
    expect(await executor.executeProgram(ctx, { runId: run.runId, attemptIdempotencyKey: "a1", source: PROGRAM_BASIC })).toMatchObject({ outcome: "resumed", status: "rejected" });
  });
});

describe("scenario 1 — retries and new attempts share the original hard run budget", () => {
  it("charges every attempt against the same ledger, denies the read that would exceed it inside the program, and caps attempts", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "budget"));
    const executor = await makeExecutor();
    const ctx = executorCtx(t);
    const three = `const a = await athena.ops.shifts.list({ status: "open" });
const b = await athena.ops.shifts.list({ status: "closed" });
const c = await athena.ops.storeDay.get({ operatingDate: "2026-08-21" });
return { kinds: [a.kind, b.kind, c.kind] };`;
    const first = expectResult(await executor.executeProgram(ctx, { runId: run.runId, attemptIdempotencyKey: "a1", source: three }));
    expect(first.result.output).toEqual({ kinds: ["result", "result", "result"] });
    let ledger = await t.run((c) => getBudgetLedgerForRun(c, run.runId));
    expect(ledger?.charged.calls).toBe(3);

    // Run limit is 8 calls: the retry sees 5 left, and its sixth read is denied in-program.
    const six = `const kinds = [];
for (const date of ["2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"]) {
  const r = await athena.ops.storeDay.get({ operatingDate: date });
  kinds.push(r.kind === "denied" ? r.code : r.kind);
}
return { kinds };`;
    const second = expectResult(await executor.executeProgram(ctx, { runId: run.runId, attemptIdempotencyKey: "a2", source: six }));
    expect(second.result.output).toEqual({ kinds: ["result", "result", "result", "result", "result", "budget_exceeded"] });
    ledger = await t.run((c) => getBudgetLedgerForRun(c, run.runId));
    expect(ledger?.charged.calls).toBe(9);
    expect(ledger?.outstanding).toEqual(budgetVector({}));
    const calls = await t.run((c) => listCapabilityCallsForRun(c, run.runId));
    expect(calls.filter((call) => call.status === "denied")).toHaveLength(1);
    expect(calls.find((call) => call.status === "denied")?.charged).toEqual(budgetVector({ calls: 1 }));

    const third = await executor.executeProgram(ctx, { runId: run.runId, attemptIdempotencyKey: "a3", source: PROGRAM_BASIC });
    expect(third).toMatchObject({ outcome: "denied", code: "attempt_cap_exceeded" });
  });
});

describe("scenario 2 — concurrent reads respect limits and never double-charge deduplicated calls", () => {
  it("serves identical concurrent reads from one admitted call and pages within the declared operation limit", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "concurrent"));
    const executor = await makeExecutor();
    const source = `const [a, b] = await Promise.all([
  athena.ops.shifts.list({ status: "open" }),
  athena.ops.shifts.list({ status: "open" }),
]);
const [day, all] = await Promise.all([
  athena.ops.storeDay.get({ operatingDate: "2026-08-21" }),
  athena.ops.shifts.list({}),
]);
const page2 = all.kind === "result" && all.envelope.pagination.cursor ? await athena.ops.shifts.list({ cursor: all.envelope.pagination.cursor }) : null;
return {
  same: JSON.stringify(a) === JSON.stringify(b),
  hashes: [a.kind === "result" ? a.envelope.resultHash : null, b.kind === "result" ? b.envelope.resultHash : null],
  day: day.kind,
  page2: page2 && page2.kind === "result" ? { items: page2.envelope.data.length, hasMore: page2.envelope.pagination.hasMore, pageIndex: page2.envelope.pagination.pageIndex } : null,
};`;
    const result = expectResult(await executor.executeProgram(executorCtx(t), { runId: run.runId, attemptIdempotencyKey: "a1", source }));
    const output = result.result.output as { same: boolean; hashes: string[]; day: string; page2: { items: number; hasMore: boolean; pageIndex: number } | null };
    expect(output.same).toBe(true);
    expect(output.hashes[0]).toBe(output.hashes[1]);
    expect(output.day).toBe("result");
    expect(output.page2).toEqual({ items: 2, hasMore: false, pageIndex: 1 });
    expect(result.diagnostics).toMatchObject({ hostCalls: 5, maxInFlight: 2 });
    expect(result.calls.filter((call) => call.deduplicated)).toHaveLength(1);
    const rows = await t.run(async (ctx) => ({ calls: await listCapabilityCallsForRun(ctx, run.runId), ledger: await getBudgetLedgerForRun(ctx, run.runId) }));
    expect(rows.calls).toHaveLength(4);
    expect(rows.ledger?.charged.calls).toBe(4);
    expect(rows.ledger?.reservationCount).toBe(4);
    expect(rows.ledger?.charged.rows).toBe(1 + 1 + 2 + 2);
    expect(result.citations).toHaveLength(4);
  });

  it("fails the program, not the run, when it exceeds the in-flight ceiling", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "inflight"));
    const executor = await makeExecutor();
    const source = `const r = await Promise.all([
  athena.ops.storeDay.get({ operatingDate: "2026-08-18" }),
  athena.ops.storeDay.get({ operatingDate: "2026-08-19" }),
  athena.ops.storeDay.get({ operatingDate: "2026-08-20" }),
]);
return { n: r.length };`;
    const result = await executor.executeProgram(executorCtx(t), { runId: run.runId, attemptIdempotencyKey: "a1", source });
    expect(result).toMatchObject({ outcome: "failed", error: { code: "program_in_flight_limit" } });
    const rows = await t.run(async (ctx) => ({ run: await ctx.db.get("intelligenceRun", run.runId), calls: await listCapabilityCallsForRun(ctx, run.runId), ledger: await getBudgetLedgerForRun(ctx, run.runId) }));
    expect(rows.run?.status).toBe("running");
    expect(rows.calls.every((call) => call.status === "canceled" || call.status === "succeeded")).toBe(true);
    expect(rows.ledger?.outstanding).toEqual(budgetVector({}));
  });
});

describe("scenario 3 — truncation and mixed freshness downgrade completion accurately", () => {
  it("cuts an oversized page at its item boundary before the program sees it and marks the attempt partial; stale inputs mark freshness mixed", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "truncate"));
    const executor = await makeExecutor();
    const ctx = executorCtx(t);
    TEST_PORT_BEHAVIOR.shifts = "oversized";
    const source = `const shifts = await athena.ops.shifts.list({});
const day = await athena.ops.storeDay.get({ operatingDate: "2026-08-21" });
return {
  items: shifts.kind === "result" ? shifts.envelope.data.length : -1,
  warnings: shifts.kind === "result" ? shifts.envelope.warnings.map((w) => w.code) : [],
  completeness: shifts.kind === "result" ? shifts.envelope.completeness.status : null,
  notesLength: shifts.kind === "result" ? shifts.envelope.data[0].managerNotes.length : 0,
};`;
    const truncated = expectResult(await executor.executeProgram(ctx, { runId: run.runId, attemptIdempotencyKey: "a1", source }));
    expect(truncated.result.output).toEqual({ items: 3, warnings: ["evidence_payload_truncated"], completeness: "partial", notesLength: 30_000 });
    expect(truncated.result.completeness.status).toBe("partial");
    expect(truncated.result.completeness.sources.map((sourceEntry) => sourceEntry.status).sort()).toEqual(["complete", "truncated"]);
    expect(truncated.calls[0].truncation).toEqual({ keptItems: 3, droppedItems: 7 });
    const shiftsCall = (await t.run((c) => listCapabilityCallsForRun(c, run.runId)))[0];
    expect(shiftsCall).toMatchObject({ status: "partial", completeness: "partial" });
    const payload = await t.run((c) => ctx && c.db.get("agentReplayPayload", shiftsCall.replayPayloadId!));
    expect(payload!.byteLength).toBeLessThan(240 * 1024);
    expect((payload!.content as { data: unknown[] }).data).toHaveLength(3);
    expect(shiftsCall.resultHash).toBe((payload!.content as { resultHash: string }).resultHash);

    TEST_PORT_BEHAVIOR.shifts = "stale";
    const mixed = expectResult(await executor.executeProgram(ctx, { runId: run.runId, attemptIdempotencyKey: "a2", source: PROGRAM_BASIC }));
    expect(mixed.result.freshness).toMatchObject({ classes: ["live", "stale"], mixed: true, oldestObservedAt: TEST_NOW_BASE - 3_600_000, newestObservedAt: TEST_NOW_BASE });
    expect(mixed.result.completeness.status).toBe("complete");
  });
});

describe("scenario 6 — failures persist normalized diagnostics without datasets or secrets", () => {
  it("records counters and a withheld, digested error; released inputs stay bounded evidence and the run stays running", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "failure"));
    const executor = await makeExecutor();
    // A program that can never return is rejected statically; this one returns on a branch it never takes.
    const source = `const shifts = await athena.ops.shifts.list({ status: "open" });
if (shifts.kind === "result") throw new Error("boom " + JSON.stringify(shifts.envelope.data));
return { rows: 0 };`;
    const result = await executor.executeProgram(executorCtx(t), { runId: run.runId, attemptIdempotencyKey: "a1", source });
    expect(result).toMatchObject({ outcome: "failed", error: { code: "program_runtime_error" } });
    if (result.outcome !== "failed") return;
    expect(result.error.message).toMatch(/^Program raised Error \(details withheld; digest [0-9a-f]{16}\)\.$/);
    expect(JSON.stringify(result)).not.toContain("failure store");
    expect(Object.keys(result.diagnostics).sort()).toEqual(expect.arrayContaining(DIAG_KEYS));
    const attempt = (await t.run((ctx) => listProgramAttemptsForRun(ctx, run.runId)))[0];
    expect(attempt).toMatchObject({ status: "failed", error: { code: "program_runtime_error" } });
    expect(JSON.stringify(attempt)).not.toContain("failure store");
    expect(JSON.stringify(attempt)).not.toContain("boom");
    const diagnostic = JSON.parse(attempt.error!.diagnostic!) as Record<string, unknown>;
    expect(Object.keys(diagnostic).sort()).toEqual(expect.arrayContaining(DIAG_KEYS));
    expect(diagnostic.hostCalls).toBe(1);
    const run2 = await t.run((ctx) => ctx.db.get("intelligenceRun", run.runId));
    expect(run2?.status).toBe("running");
  });
});

describe("scenario 7 — exactly one explicit structured output", () => {
  it("rejects missing and duplicate outputs before any read, fails oversized and unstructured outputs safely, and never mints a second result", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "outputs"));
    const executor = await makeExecutor();
    const ctx = executorCtx(t);
    expect(await executor.executeProgram(ctx, { runId: run.runId, attemptIdempotencyKey: "missing", source: `const x = 1;` })).toMatchObject({ outcome: "rejected", issues: [{ code: "missing_output" }] });
    expect(await executor.executeProgram(ctx, { runId: run.runId, attemptIdempotencyKey: "duplicate", source: `return { a: 1 };\nreturn { b: 2 };` })).toMatchObject({ outcome: "rejected" });
    const ledgerAfterRejections = await t.run((c) => getBudgetLedgerForRun(c, run.runId));
    expect(ledgerAfterRejections).toMatchObject({ attemptCount: 2, charged: budgetVector({}) });

    const fresh = await t.run((c) => seedDelegatedRun(c, "outputs-2"));
    expect(await executor.executeProgram(ctx, { runId: fresh.runId, attemptIdempotencyKey: "oversized", source: `return { big: "x".repeat(250000) };` })).toMatchObject({ outcome: "failed", error: { code: "program_result_too_large" } });
    expect(await executor.executeProgram(ctx, { runId: fresh.runId, attemptIdempotencyKey: "scalar", source: `return 5;` })).toMatchObject({ outcome: "failed", error: { code: "program_result_not_structured" } });

    const third = await t.run((c) => seedDelegatedRun(c, "outputs-3"));
    const produced = expectResult(await executor.executeProgram(ctx, { runId: third.runId, attemptIdempotencyKey: "ok", source: `return { ok: true };` }));
    const again = await t.run((c) =>
      TEST_EXECUTOR_SEAMS.finishAttemptWithCtx(c, { attemptId: produced.attemptId, end: { status: "completed", output: { ok: false }, diagnostics: produced.diagnostics }, now: TEST_NOW_BASE + 1 }),
    );
    expect(again).toMatchObject({ outcome: "result", replayed: true, resultHash: produced.resultHash, result: { output: { ok: true } } });
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- bounded test inspection
    const payloads = await t.run((c) => c.db.query("agentReplayPayload").withIndex("by_attemptId_subjectKind", (q) => q.eq("attemptId", produced.attemptId).eq("subjectKind", "program_result")).collect());
    expect(payloads).toHaveLength(1);
  });
});

describe("scenario 8 — timeout and cancellation settle open calls conservatively", () => {
  it("settles an in-flight read as timeout (reservation charged, no payload) when the program exceeds its elapsed ceiling", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "timeout"));
    const executor = await makeExecutor({ dispatchDelayMs: 400, ceilingOverrides: { maxElapsedMs: 150 } });
    const result = await executor.executeProgram(executorCtx(t), { runId: run.runId, attemptIdempotencyKey: "a1", source: PROGRAM_BASIC });
    expect(result).toMatchObject({ outcome: "failed", error: { code: "program_timeout", retryable: true } });
    const rows = await t.run(async (ctx) => ({ calls: await listCapabilityCallsForRun(ctx, run.runId), ledger: await getBudgetLedgerForRun(ctx, run.runId), attempts: await listProgramAttemptsForRun(ctx, run.runId) }));
    expect(rows.calls).toHaveLength(1);
    expect(rows.calls[0]).toMatchObject({ status: "failed", error: { code: "timeout" }, charged: budgetVector({ calls: 1, rows: 10, bytes: 16_384, costUnits: 2, elapsedMs: 1_000 }) });
    expect(rows.calls[0].replayPayloadId).toBeUndefined();
    expect(rows.calls[0].delegation?.release).toMatchObject({ verdict: "withheld", reason: "timeout" });
    expect(rows.ledger?.outstanding).toEqual(budgetVector({}));
    expect(rows.attempts[0]).toMatchObject({ status: "failed", error: { code: "program_timeout" } });
  });

  it("cancels the attempt and settles its open read as canceled when the caller aborts", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "abort"));
    const executor = await makeExecutor({ dispatchDelayMs: 400 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);
    const result = await executor.executeProgram(executorCtx(t), { runId: run.runId, attemptIdempotencyKey: "a1", source: PROGRAM_BASIC, signal: controller.signal });
    expect(result).toMatchObject({ outcome: "canceled", error: { code: "program_canceled" } });
    const rows = await t.run(async (ctx) => ({ calls: await listCapabilityCallsForRun(ctx, run.runId), run: await ctx.db.get("intelligenceRun", run.runId), ledger: await getBudgetLedgerForRun(ctx, run.runId) }));
    expect(rows.calls[0]).toMatchObject({ status: "canceled", charged: budgetVector({ calls: 1, rows: 10, bytes: 16_384, costUnits: 2, elapsedMs: 1_000 }) });
    expect(rows.run?.status).toBe("running");
    expect(rows.ledger?.outstanding).toEqual(budgetVector({}));
  });
});

describe("scenario 9 — egress inheritance through arbitrary transforms", () => {
  const TRANSFORMS = `const day = await athena.ops.storeDay.get({ operatingDate: "2026-08-21" });
const shifts = await athena.ops.shifts.list({ status: "open" });
const d = day.kind === "result" ? day.envelope.data : {};
const rows = shifts.kind === "result" ? shifts.envelope.data : [];
const renamed = { st: d.status };
const aggregate = rows.length + (d.cashVariance ? 1 : 0);
const joined = rows.map((row) => ({ label: row.label, dayStatus: d.status }));
const filtered = rows.filter((row) => row.status === "open").map((row) => row.label.length);
const branch = d.cashVariance && d.cashVariance.amountMinor < 0 ? "short" : "fine";
const inferred = branch === "short";
return { renamed, aggregate, joined, filtered, branch, inferred, constant: 42 };`;

  it("marks the result and attempt with the maximum input class for an admin, and operational for a cashier who never received the sensitive projections", async () => {
    const t = convexTest(schema, modules);
    const admin = await t.run((ctx) => seedDelegatedRun(ctx, "egress-admin"));
    const cashier = await t.run((ctx) => seedDelegatedRun(ctx, "egress-cashier", { role: "pos_only", operationalRoles: ["cashier"] }));
    const executor = await makeExecutor();
    const ctx = executorCtx(t);
    const adminResult = expectResult(await executor.executeProgram(ctx, { runId: admin.runId, attemptIdempotencyKey: "a1", source: TRANSFORMS }));
    expect(adminResult.result.egressClass).toBe("sensitive");
    expect(adminResult.result.output).toMatchObject({ branch: "short", inferred: true, constant: 42 });
    const cashierResult = expectResult(await executor.executeProgram(ctx, { runId: cashier.runId, attemptIdempotencyKey: "a1", source: TRANSFORMS }));
    expect(cashierResult.result.egressClass).toBe("operational");
    expect(cashierResult.result.output).toMatchObject({ branch: "fine", inferred: false });
    const attempts = await t.run(async (c) => ({ admin: await listProgramAttemptsForRun(c, admin.runId), cashier: await listProgramAttemptsForRun(c, cashier.runId) }));
    expect(attempts.admin[0].egressClass).toBe("sensitive");
    expect(attempts.cashier[0].egressClass).toBe("operational");
    // A constant output derived after reading sensitive inputs cannot declassify.
    const constant = expectResult(await executor.executeProgram(ctx, { runId: admin.runId, attemptIdempotencyKey: "a2", source: `const d = await athena.ops.storeDay.get({ operatingDate: "2026-08-21" });\nreturn { fine: true };` }));
    expect(constant.result.egressClass).toBe("sensitive");
    expect(adminResult.citations.every((candidate) => candidate.egressClass === "sensitive")).toBe(true);
    expect(cashierResult.citations.every((candidate) => candidate.egressClass === "operational")).toBe(true);
  });
});

describe("scenario 10 — revocation races produce truthful exposure state", () => {
  const exposure = (t: Harness, attemptId: Id<"agentProgramAttempt">) => t.run((ctx) => TEST_EXECUTOR_SEAMS.describeAttemptExposureWithCtx(ctx, attemptId));

  it("withholds the result when authority is revoked between the sandbox result and the provider boundary", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "race-before"));
    const executor = await makeExecutor({
      hooks: { beforeFinish: async () => t.run((ctx) => ctx.db.delete("organizationMember", run.operator.membershipId!)) },
    });
    const result = await executor.executeProgram(executorCtx(t), { runId: run.runId, attemptIdempotencyKey: "a1", source: PROGRAM_BASIC });
    expect(result).toMatchObject({ outcome: "withheld", reason: "membership_revoked", result: { kind: "unauthorized", code: "unauthorized_scope" }, providerEgress: { state: "withheld" } });
    expect(JSON.stringify(result)).not.toContain("race-before store");
    if (result.outcome !== "withheld") return;
    expect(await exposure(t, result.attemptId)).toMatchObject({ attemptStatus: "result_produced", providerExposed: false, providerEgress: "withheld", providerEgressReason: "membership_revoked", operatorReleaseCommitted: false, operatorViewed: false, revokedAfterProviderExposure: false });
    const completion = await t.run((ctx) => TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, { runId: run.runId, idempotencyKey: "c", citedAttemptRefs: [result.attemptRef], citations: [], artifact: { payload: {} }, now: TEST_NOW_BASE + 5 }));
    expect(completion).toMatchObject({ outcome: "refused", reason: "membership_revoked" });
  });

  it("records prior provider exposure truthfully when revocation, cancellation, or the kill switch lands after provider_egress_committed", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "race-after", { withBinding: true }));
    const executor = await makeExecutor();
    const result = expectResult(await executor.executeProgram(executorCtx(t), { runId: run.runId, attemptIdempotencyKey: "a1", source: PROGRAM_BASIC }));
    expect(await exposure(t, result.attemptId)).toMatchObject({ providerExposed: true, providerEgress: "committed", operatorReleaseCommitted: false, operatorViewed: false, revokedAfterProviderExposure: false, binding: "active" });

    TEST_ENABLEMENT.narrow({ profiles: { [TEST_PROFILE_ID]: "disabled" } });
    const killed = await t.run((ctx) => TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, { runId: run.runId, idempotencyKey: "c", citedAttemptRefs: [result.attemptRef], citations: [], artifact: { payload: {} }, now: TEST_NOW_BASE + 5 }));
    expect(killed).toMatchObject({ outcome: "refused", reason: "profile_disabled" });
    const next = await executor.executeProgram(executorCtx(t), { runId: run.runId, attemptIdempotencyKey: "a2", source: PROGRAM_BASIC });
    expect(next).toMatchObject({ outcome: "refused", reason: "profile_disabled" });
    await t.run((ctx) => cancelAgentRunWithCtx(ctx, { runId: run.runId, idempotencyKey: "kill", reason: "profile_kill_switch", now: TEST_NOW_BASE + 6 }));
    TEST_ENABLEMENT.reset();
    const after = await exposure(t, result.attemptId);
    expect(after).toMatchObject({ runStatus: "canceled", providerExposed: true, providerEgress: "committed", revokedAfterProviderExposure: true, operatorReleaseCommitted: false, operatorViewed: false, binding: "abandoned" });
    expect(after?.providerEgressAt).toBe(TEST_NOW_BASE);
    const attempts = await t.run((ctx) => listProgramAttemptsForRun(ctx, run.runId));
    expect(attempts[0].providerEgress).toMatchObject({ state: "committed", at: TEST_NOW_BASE });
  });

  it("keeps query visibility and browser receipt distinct across operator_release_committed, revocation, and an authorized view", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "release", { withBinding: true }));
    const executor = await makeExecutor();
    const result = expectResult(await executor.executeProgram(executorCtx(t), { runId: run.runId, attemptIdempotencyKey: "a1", source: PROGRAM_BASIC }));
    const completed = await t.run((ctx) =>
      TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, {
        runId: run.runId,
        idempotencyKey: "c",
        citedAttemptRefs: [result.attemptRef],
        citations: result.citations.map((candidate) => ({ ref: candidate.citation })),
        artifact: { payload: { answer: "One shift is open." } },
        now: TEST_NOW_BASE + 5,
      }),
    );
    expect(completed).toMatchObject({ outcome: "completed" });
    expect(await exposure(t, result.attemptId)).toMatchObject({ runStatus: "completed", providerExposed: true, operatorReleaseCommitted: true, operatorReleaseCommittedAt: TEST_NOW_BASE + 5, operatorViewed: false });

    // Revoked after commit but before any authorized fetch: nothing claims browser receipt.
    await t.run((ctx) => ctx.db.delete("organizationMember", run.operator.membershipId!));
    const revoked = await exposure(t, result.attemptId);
    expect(revoked).toMatchObject({ operatorReleaseCommitted: true, operatorViewed: false });
    // Re-admitted and actually fetched: only now is receipt recorded, and it cannot be recalled.
    await t.run((ctx) => ctx.db.insert("organizationMember", { organizationId: run.operator.organizationId, userId: run.operator.userId, role: "full_admin" }));
    const acknowledged = await t.run((ctx) => acknowledgeOperatorViewWithCtx(ctx, { bindingId: run.bindingId!, viewerActorRef: `athenaUser:${run.operator.userId}`, now: TEST_NOW_BASE + 9 }));
    expect(acknowledged).toEqual({ acknowledged: true, operatorViewedAt: TEST_NOW_BASE + 9 });
    expect(await exposure(t, result.attemptId)).toMatchObject({ operatorViewed: true, operatorViewedAt: TEST_NOW_BASE + 9 });
    expect(await t.run((ctx) => TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, { runId: run.runId, idempotencyKey: "c2", citedAttemptRefs: [], citations: [], artifact: { payload: {} }, now: TEST_NOW_BASE + 10 }))).toMatchObject({ outcome: "already_terminal", status: "completed" });
  });
});

describe("scenario 11 — replay inside the window", () => {
  it("re-executes the exact validated program against the stored complete inputs and reproduces the output hash, then reports expiry", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "replay"));
    const executor = await makeExecutor();
    const ctx = executorCtx(t);
    const source = `const [shifts, day] = await Promise.all([
  athena.ops.shifts.list({ status: "open" }),
  athena.ops.storeDay.get({ operatingDate: "2026-08-21" }),
]);
const rows = shifts.kind === "result" ? shifts.envelope.data : [];
return { labels: rows.map((row) => row.label).sort(), variance: day.kind === "result" ? day.envelope.data.cashVariance : null };`;
    const result = expectResult(await executor.executeProgram(ctx, { runId: run.runId, attemptIdempotencyKey: "a1", source }));
    TEST_CLOCK.now = TEST_NOW_BASE + 86_400_000;
    const replay = await executor.replayAttempt(ctx, { attemptId: result.attemptId });
    expect(replay).toMatchObject({ kind: "replayed", sourceMatches: true, outputMatches: true, storedOutputHash: result.result.outputHash, missingInputs: 0, servedInputs: 2 });
    if (replay.kind !== "replayed") return;
    expect(replay.outcome).toMatchObject({ status: "completed", output: result.result.output });
    // Replay never touched the ledger or created calls.
    const rows = await t.run(async (c) => ({ calls: await listCapabilityCallsForRun(c, run.runId), ledger: await getBudgetLedgerForRun(c, run.runId) }));
    expect(rows.calls).toHaveLength(2);
    expect(rows.ledger?.charged.calls).toBe(2);

    TEST_CLOCK.now = TEST_NOW_BASE + SHORT_LIVED_RETENTION_MS + 86_400_000;
    await t.run((c) => sweepExpiredAgentContentWithCtx(c, { now: TEST_CLOCK.now, limit: 100 }));
    expect(await executor.replayAttempt(ctx, { attemptId: result.attemptId })).toEqual({ kind: "not_replayable", reason: "expired" });
  });
});

describe("provider-visible boundary through U2's runtime adapter contract and tool ledger", () => {
  function buildTool(executor: Awaited<ReturnType<typeof makeExecutor>>, t: Harness, runId: Id<"intelligenceRun">) {
    const definition: AgentToolDefinition<{ source: string }, unknown> = {
      toolId: "athena.executeProgram",
      description: "Run one bounded read-only TypeScript program.",
      validateInput: (raw) => {
        const source = (raw as { source?: unknown } | null)?.source;
        return typeof source === "string" ? { ok: true, args: { source } } : { ok: false, issues: [{ path: "source", message: "source required" }] };
      },
    };
    const registration: AgentToolRegistration<{ source: string }, unknown> = {
      definition,
      handler: async (args, context) => {
        const result = await executor.executeProgram(executorCtx(t), { runId, attemptIdempotencyKey: context.idempotencyKey, source: args.source, signal: context.signal });
        if (result.outcome === "result") {
          return { kind: "success", result: { attemptRef: result.attemptRef, result: result.result, citations: result.citations, providerEgress: result.providerEgress } };
        }
        if (result.outcome === "withheld") return { kind: "denied", denial: { code: result.reason, message: "The result was withheld." } };
        return { kind: "failure", error: { code: result.outcome, message: "The program did not produce a result.", retryable: false } };
      },
    };
    return registration;
  }

  async function driveTurn(t: Harness, registration: AgentToolRegistration<{ source: string }, unknown>, source: string) {
    const fake = createAgentRuntimeContractFake();
    const ledger = createAgentToolDispatchLedger({ adapterVersion: fake.adapter.descriptor.adapterVersion, tools: [registration] });
    const events: AgentRuntimeEvent[] = [];
    const hooks: AgentRuntimeTurnHooks = {
      onEvent: (event) => {
        events.push(event);
        if (event.kind === "turn_started" || event.kind === "turn_resumed") ledger.beginTurn(event.turnRef);
        if (event.kind === "turn_completed") ledger.terminalizeTurn(event.turnRef, `turn_${event.outcome}`);
      },
      dispatchTool: (request) => ledger.dispatch(request),
    };
    fake.scriptTurn("turn-1", [
      { kind: "tool_call", callId: "call-1", toolId: "athena.executeProgram", args: { source } },
      { kind: "complete", narrative: "done" },
    ]);
    const thread = await fake.adapter.ensureThread({ threadKey: "executor|thread", contextBindingRef: opaqueRef("context_binding", "ctx"), correlation: { operatorRef: "athenaUser:op", profileId: TEST_PROFILE_ID } });
    const input = await fake.adapter.saveInput({
      threadRef: thread.threadRef,
      turnKey: "turn-1",
      prompt: { text: "Which shifts are open?", egressClass: "operational", promptHash: "sha256:prompt", untrustedDataLabel: "retrieved_store_data" },
      history: { messages: [], projectionDigest: "sha256:empty", reauthorizedAt: TEST_NOW_BASE },
    });
    const { turnRef } = await fake.adapter.startTurn(
      { threadRef: thread.threadRef, inputRef: input.inputRef, turnKey: "turn-1", tools: [registration.definition], model: { providerId: "athena_contract_fake", modelId: "fake-1", region: "local" }, limits: { maxToolCalls: 2, maxElapsedMs: 60_000 } },
      hooks,
    );
    await fake.settle(turnRef);
    return { results: fake.dispatchResults(turnRef), ledger, events };
  }

  it("attaches the programResult to the tool response only after provider_egress_committed, and the ledger binds it to the result hash", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "provider"));
    const executor = await makeExecutor();
    const { results, ledger, events } = await driveTurn(t, buildTool(executor, t, run.runId), PROGRAM_BASIC);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: "outcome", callId: "call-1", toolId: "athena.executeProgram", outcome: { kind: "success", result: { providerEgress: { state: "committed" }, result: { output: { open: 1 } } } } });
    expect(ledger.entries()[0]).toMatchObject({ status: "settled", resultHash: expect.stringMatching(/^fnv1a64:/) });
    expect(events.map((event) => event.kind)).toEqual(["turn_started", "tool_call_requested", "tool_call_completed", "turn_completed"]);
    const attempt = (await t.run((ctx) => listProgramAttemptsForRun(ctx, run.runId)))[0];
    expect(attempt).toMatchObject({ status: "result_produced", providerEgress: { state: "committed" }, attemptIdempotencyKey: expect.stringContaining("call-1") });
    expect(await t.run((ctx) => ctx.db.get("intelligenceRun", run.runId))).toMatchObject({ status: "running" });
  });

  it("returns a typed denial (not the result) through the tool response when authority is revoked before the boundary", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "provider-revoked"));
    const executor = await makeExecutor({ hooks: { beforeFinish: async () => t.run((ctx) => ctx.db.delete("organizationMember", run.operator.membershipId!)) } });
    const { results } = await driveTurn(t, buildTool(executor, t, run.runId), PROGRAM_BASIC);
    expect(results[0]).toMatchObject({ kind: "outcome", outcome: { kind: "denied", denial: { code: "membership_revoked" } } });
    expect(JSON.stringify(results)).not.toContain("provider-revoked store");
    const attempt = (await t.run((ctx) => listProgramAttemptsForRun(ctx, run.runId)))[0];
    expect(attempt.providerEgress).toMatchObject({ state: "withheld", reason: "membership_revoked" });
  });
});
