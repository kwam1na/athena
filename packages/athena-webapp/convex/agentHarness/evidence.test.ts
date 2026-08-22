/// <reference types="vite/client" />
/**
 * Executor evidence (plan U6 scenarios 3, 6, 11, 12, 13; ticket V26-1264):
 * invocation normalization, the 240 KiB per-record ceiling with typed
 * boundary truncation, completeness/freshness/egress derivation, the
 * Convex-document-headroom sensor, attempt-completion storage, `completeRun`
 * promotion rules, replay-window loading, and the distinct evidence states
 * after expiry and lifecycle deletion.
 */
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import { hashCanonical } from "../../shared/agentHarness/agentRuntime";
import {
  AGENT_CALL_EVIDENCE_BYTE_CEILING,
  SHORT_LIVED_RETENTION_MS,
  STANDARD_RETENTION_MS,
  measureJsonByteLength,
} from "../../shared/agentHarness/execution";
import { scanForRawIdentifiers, type AgentReadEnvelope } from "../../shared/agentHarness/results";
import { opaqueRef } from "../../shared/agentHarness/values";
import { removeStoreWithCtx } from "../inventory/stores";
import { AGENT_CALL_EVIDENCE_CONTENT_CEILING_BYTES, AGENT_CALL_EVIDENCE_METADATA_HEADROOM_BYTES } from "./budgets";
import {
  AUDIT_TRAIL_MANIFEST,
  SHIFTS_MANIFEST,
  STORE_DAY_MANIFEST,
  TEST_CLOCK,
  TEST_ENABLEMENT,
  TEST_NOW_BASE,
  TEST_OVERSIZED_NOTE,
  TEST_PORT_BEHAVIOR,
} from "./delegatedAdmission.testPorts";
import {
  AGENT_EVIDENCE_TRUNCATION_WARNING,
  fitEnvelopeForEvidence,
  immutableRevisionOf,
  normalizeHostCall,
  normalizedRequestDigest,
  summarizeAttemptInputs,
  type AgentExecutionFacadeEntry,
} from "./evidence";
import { TEST_EXECUTOR_SEAMS, beginExecutingAttempt, bridgeCall, seedDelegatedRun, type TestBridgeRequest } from "./executor.testSeams";
import { admitCapabilityCallWithCtx, markCapabilityCallExecutingWithCtx, settleCapabilityCallWithCtx } from "./lifecycle";
import { measureEncodedBytes } from "./programRuntime/outputCeiling";
import { computeReadResultHash } from "./readPorts";
import { readCitationEvidenceWithCtx, sweepExpiredAgentContentWithCtx } from "./retention";

// Cuts the module cycle `platform/operationAdmission` -> `sharedDemo/...`, as retention.test.ts does.
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

const DAY = 86_400_000;

const FACADE: readonly AgentExecutionFacadeEntry[] = [
  { package: "ops", resource: "shifts", verbs: ["list"], capabilityId: SHIFTS_MANIFEST.capabilityId, namespace: "ops.shifts" },
  { package: "ops", resource: "storeDay", verbs: ["get"], capabilityId: STORE_DAY_MANIFEST.capabilityId, namespace: "ops.storeDay" },
];

function listEnvelope(items: readonly unknown[], overrides: Partial<AgentReadEnvelope<unknown>> = {}): AgentReadEnvelope<unknown> {
  const base = {
    contractVersion: 1 as const,
    capabilityId: SHIFTS_MANIFEST.capabilityId,
    namespace: "ops.shifts",
    verb: "list" as const,
    data: items,
    observedAt: TEST_NOW_BASE,
    capturedAt: TEST_NOW_BASE,
    freshness: { class: "live" as const, authority: "live_read" as const, observedAt: TEST_NOW_BASE, capturedAt: TEST_NOW_BASE },
    completeness: { status: "complete" as const, sources: [{ sourceKey: "shifts", status: "complete" as const }] },
    warnings: [],
    sourceRefs: [{ ref: opaqueRef("source", "shift-page-1"), kind: "shift", capturedAt: TEST_NOW_BASE }],
    pagination: { hasMore: false, pageIndex: 0, pageSize: items.length, pagesRemainingInRun: 1 },
  };
  const envelope = { ...base, ...overrides } as AgentReadEnvelope<unknown>;
  return { ...envelope, resultHash: computeReadResultHash(envelope) };
}

function getEnvelope(data: unknown): AgentReadEnvelope<unknown> {
  const envelope = {
    contractVersion: 1 as const,
    capabilityId: STORE_DAY_MANIFEST.capabilityId,
    namespace: "ops.storeDay",
    verb: "get" as const,
    data,
    observedAt: TEST_NOW_BASE,
    capturedAt: TEST_NOW_BASE,
    freshness: { class: "live" as const, authority: "live_read" as const, observedAt: TEST_NOW_BASE, capturedAt: TEST_NOW_BASE },
    completeness: { status: "complete" as const, sources: [{ sourceKey: "day", status: "complete" as const }] },
    warnings: [],
    sourceRefs: [{ ref: opaqueRef("source", "day-1"), kind: "store_day", capturedAt: TEST_NOW_BASE }],
    pagination: undefined,
  } as AgentReadEnvelope<unknown>;
  return { ...envelope, resultHash: computeReadResultHash(envelope) };
}

/** Pad a string field so the encoded envelope lands on exactly `targetBytes`. */
function padToExactBytes(build: (pad: string) => AgentReadEnvelope<unknown>, targetBytes: number): AgentReadEnvelope<unknown> {
  const without = measureEncodedBytes(build(""));
  return build("x".repeat(targetBytes - without));
}

beforeEach(() => {
  TEST_ENABLEMENT.reset();
  TEST_CLOCK.now = TEST_NOW_BASE;
  TEST_PORT_BEHAVIOR.shifts = "normal";
});

describe("invocation normalization", () => {
  it("maps a facade call onto the capability request, lifts the cursor, drops undefined, and keys it exactly like U4's stored hash", () => {
    const cursor = opaqueRef("cursor", "v1.1.70616765.abc");
    const normalized = normalizeHostCall(FACADE, { package: "ops", resource: "shifts", verb: "list", args: { status: "open", cursor, zzz: undefined as never } });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.invocation.request).toEqual({ capabilityId: SHIFTS_MANIFEST.capabilityId, namespace: "ops.shifts", verb: "list", args: { status: "open" }, cursor });
    expect(normalized.invocation.requestDigest).toBe(
      hashCanonical({ capabilityId: SHIFTS_MANIFEST.capabilityId, verb: "list", args: { status: "open" }, projections: [], cursor }),
    );
    expect(normalized.invocation.requestDigest).toBe(normalizedRequestDigest(normalized.invocation.request));
    // Same read, different key order: same identity (dedupe inside an attempt).
    const reordered = normalizeHostCall(FACADE, { package: "ops", resource: "shifts", verb: "list", args: { cursor, status: "open" } });
    expect(reordered.ok && reordered.invocation.requestDigest).toBe(normalized.invocation.requestDigest);
  });

  it("refuses paths outside the facade as unauthorized and malformed arguments as denied, before any admission", () => {
    expect(normalizeHostCall(FACADE, { package: "ops", resource: "auditTrail", verb: "list", args: {} })).toMatchObject({ ok: false, result: { kind: "unauthorized", code: "unauthorized_capability" } });
    expect(normalizeHostCall(FACADE, { package: "ops", resource: "storeDay", verb: "list", args: {} })).toMatchObject({ ok: false, result: { kind: "unauthorized" } });
    expect(normalizeHostCall(FACADE, { package: "ops", resource: "shifts", verb: "list", args: [1, 2] })).toMatchObject({ ok: false, result: { kind: "denied", code: "invalid_arguments" } });
    expect(normalizeHostCall(FACADE, { package: "ops", resource: "shifts", verb: "list", args: { cursor: "page-2" } })).toMatchObject({ ok: false, result: { kind: "denied", code: "invalid_arguments" } });
    expect(normalizeHostCall(FACADE, { package: "ops", resource: "storeDay", verb: "get", args: { operatingDate: "2026-08-21", cursor: opaqueRef("cursor", "v1.1.00.ab") } })).toMatchObject({ ok: false, result: { kind: "denied" } });
  });
});

describe("per-call evidence ceiling (scenario 13)", () => {
  it("cuts a list page at its item boundary, never inside an item or a multibyte character, and re-hashes what will be stored", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ shiftRef: opaqueRef("resource", `shift-${index}`), label: `shift ${index}`, status: "open", managerNotes: TEST_OVERSIZED_NOTE }));
    const envelope = listEnvelope(items);
    expect(measureEncodedBytes(envelope)).toBeGreaterThan(AGENT_CALL_EVIDENCE_BYTE_CEILING);
    const fit = fitEnvelopeForEvidence(envelope);
    expect(fit.kind).toBe("truncated");
    if (fit.kind !== "truncated") return;
    expect(fit.truncation).toMatchObject({ boundary: "collection_item", keptItems: 3, droppedItems: 7 });
    const data = fit.envelope.data as typeof items;
    expect(data).toHaveLength(3);
    expect(data).toEqual(items.slice(0, 3));
    expect(data[2].managerNotes).toBe(TEST_OVERSIZED_NOTE);
    expect(fit.encodedBytes).toBeLessThanOrEqual(AGENT_CALL_EVIDENCE_CONTENT_CEILING_BYTES);
    expect(measureEncodedBytes(fit.envelope)).toBe(fit.encodedBytes);
    expect(measureJsonByteLength(fit.envelope)).toBeLessThan(AGENT_CALL_EVIDENCE_BYTE_CEILING);
    expect(fit.envelope.completeness).toEqual({ status: "partial", sources: [{ sourceKey: "shifts", status: "truncated", reason: "truncated_at_evidence_ceiling" }] });
    expect(fit.envelope.warnings.map((warning) => warning.code)).toContain(AGENT_EVIDENCE_TRUNCATION_WARNING);
    expect(fit.envelope.pagination).toMatchObject({ pageSize: 3, hasMore: false });
    const { resultHash: _hash, ...rest } = fit.envelope;
    expect(fit.envelope.resultHash).toBe(computeReadResultHash(rest as AgentReadEnvelope<unknown>));
    expect(fit.envelope.resultHash).not.toBe(envelope.resultHash);
  });

  it("fits an envelope that sits exactly on the content budget and truncates one byte over", () => {
    const budget = AGENT_CALL_EVIDENCE_BYTE_CEILING - AGENT_CALL_EVIDENCE_METADATA_HEADROOM_BYTES;
    const exact = padToExactBytes((pad) => listEnvelope([{ shiftRef: opaqueRef("resource", "s1"), label: pad, status: "open" }, { shiftRef: opaqueRef("resource", "s2"), label: "tail", status: "open" }]), budget);
    expect(measureEncodedBytes(exact)).toBe(budget);
    expect(fitEnvelopeForEvidence(exact)).toMatchObject({ kind: "fits", encodedBytes: budget });
    const over = padToExactBytes((pad) => listEnvelope([{ shiftRef: opaqueRef("resource", "s1"), label: pad, status: "open" }, { shiftRef: opaqueRef("resource", "s2"), label: "tail", status: "open" }]), budget + 1);
    const fit = fitEnvelopeForEvidence(over);
    expect(fit.kind).toBe("truncated");
    if (fit.kind === "truncated") {
      // One byte over: items are atomic, so the page is cut at an item boundary
      // (the truncation warning reserves its own allowance) and never rejected.
      expect(fit.truncation.boundary).toBe("collection_item");
      expect(fit.truncation.keptItems + fit.truncation.droppedItems).toBe(2);
      expect(fit.truncation.droppedItems).toBeGreaterThanOrEqual(1);
      expect(fit.encodedBytes).toBeLessThanOrEqual(budget);
    }
  });

  it("rejects an oversized snapshot with a typed reason instead of chunking it, and keeps a fitting one untouched", () => {
    const big = getEnvelope({ operatingDate: "2026-08-21", status: "open", cashVariance: { amountMinor: 1, currency: "GHS" }, notes: "é".repeat(130_000) });
    expect(fitEnvelopeForEvidence(big)).toMatchObject({ kind: "rejected", truncation: { reason: "evidence_payload_exceeds_ceiling", boundary: "none" } });
    const small = getEnvelope({ operatingDate: "2026-08-21", status: "open" });
    expect(fitEnvelopeForEvidence(small)).toMatchObject({ kind: "fits", envelope: small });
  });

  it("keeps a maximal stored call record under 240 KiB including metadata and far under the 1 MiB document limit, through storage, replay, and cleanup", async () => {
    const t = convexTest(schema, modules);
    const budget = AGENT_CALL_EVIDENCE_CONTENT_CEILING_BYTES;
    const maximal = padToExactBytes((pad) => listEnvelope([{ shiftRef: opaqueRef("resource", "s1"), label: pad, status: "open" }]), budget);
    expect(fitEnvelopeForEvidence(maximal).kind).toBe("fits");
    const { callId, payload, call } = await t.run(async (ctx) => {
      const run = await seedDelegatedRun(ctx, "maximal");
      const attempt = await beginExecutingAttempt(ctx, run);
      const admitted = await admitCapabilityCallWithCtx(ctx, {
        runId: run.runId,
        attemptId: attempt.attemptId,
        callIdempotencyKey: "max",
        capabilityId: SHIFTS_MANIFEST.capabilityId,
        normalizedArgsHash: "args:max",
        normalizedArgs: { status: "open" },
        requested: { calls: 1, rows: 10, bytes: 16_384, costUnits: 2, elapsedMs: 1_000 },
        now: TEST_NOW_BASE,
      });
      if (admitted.outcome !== "admitted") throw new Error(admitted.outcome);
      await markCapabilityCallExecutingWithCtx(ctx, { callId: admitted.callId, now: TEST_NOW_BASE });
      const settled = await settleCapabilityCallWithCtx(ctx, {
        callId: admitted.callId,
        outcome: "succeeded",
        actual: { rows: 1, bytes: budget, costUnits: 2, elapsedMs: 3 },
        resultHash: maximal.resultHash,
        output: maximal,
        sourceRefs: Array.from({ length: 64 }, (_, index) => ({ table: "opaque_source", id: `source:shift-${index}`, surface: "shift" })),
        now: TEST_NOW_BASE,
      });
      if (settled.outcome !== "settled" || !settled.outputStored) throw new Error(JSON.stringify(settled));
      const call = (await ctx.db.get("agentCapabilityCall", admitted.callId))!;
      const payload = (await ctx.db.get("agentReplayPayload", call.replayPayloadId!))!;
      return { callId: admitted.callId, payload, call };
    });
    const recordBytes = measureJsonByteLength(payload);
    expect(payload.byteLength).toBe(budget);
    expect(recordBytes).toBeGreaterThan(budget);
    expect(recordBytes).toBeLessThan(AGENT_CALL_EVIDENCE_BYTE_CEILING);
    expect(recordBytes).toBeLessThan(1024 * 1024 / 4);
    expect(measureJsonByteLength(call)).toBeLessThan(64 * 1024);
    // Replay sees the complete envelope; expiry cleans it without a document-limit failure.
    const replay = await t.run((ctx) => ctx.db.get("agentReplayPayload", payload._id));
    expect(replay?.content).toEqual(maximal);
    const swept = await t.run((ctx) => sweepExpiredAgentContentWithCtx(ctx, { now: TEST_NOW_BASE + SHORT_LIVED_RETENTION_MS + 1, limit: 50 }));
    expect(swept.deletedReplayPayloads).toBeGreaterThanOrEqual(1);
    expect(await t.run((ctx) => ctx.db.get("agentReplayPayload", payload._id))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get("agentCapabilityCall", callId))).toMatchObject({ status: "succeeded", resultHash: maximal.resultHash });
  });
});

describe("attempt derivations (scenarios 3, 9)", () => {
  it("downgrades completion on truncation and mixed freshness and inherits the maximum egress class", () => {
    const live = listEnvelope([{ shiftRef: opaqueRef("resource", "s1"), label: "a", status: "open" }]);
    const stale = listEnvelope([], {
      observedAt: TEST_NOW_BASE - 3_600_000,
      freshness: { class: "stale", authority: "live_read", observedAt: TEST_NOW_BASE - 3_600_000, capturedAt: TEST_NOW_BASE, staleAfter: TEST_NOW_BASE - 60_000 },
      completeness: { status: "partial", sources: [{ sourceKey: "shifts", status: "truncated", reason: "truncated_at_evidence_ceiling" }] },
    });
    const summary = summarizeAttemptInputs([
      { envelope: live, egressClass: "operational" },
      { envelope: stale, egressClass: "sensitive" },
    ]);
    expect(summary.completeness.status).toBe("partial");
    expect(summary.completeness.sources.map((source) => source.status)).toEqual(["complete", "truncated"]);
    expect(summary.freshness).toEqual({ classes: ["live", "stale"], mixed: true, oldestObservedAt: TEST_NOW_BASE - 3_600_000, newestObservedAt: TEST_NOW_BASE });
    expect(summary.egressClass).toBe("sensitive");
    expect(summarizeAttemptInputs([]).completeness.status).toBe("partial");
    expect(summarizeAttemptInputs([{ envelope: live, egressClass: "operational" }])).toMatchObject({ completeness: { status: "complete" }, freshness: { classes: ["live"], mixed: false }, egressClass: "operational" });
  });

  it("reads an immutable revision only from authoritative records", () => {
    const accepted = listEnvelope([], {
      freshness: { class: "accepted", authority: "authoritative_record", observedAt: TEST_NOW_BASE, capturedAt: TEST_NOW_BASE },
      sourceRefs: [{ ref: opaqueRef("source", "audit-1"), kind: "audit_entry", version: "rev-7", capturedAt: TEST_NOW_BASE }],
    });
    expect(immutableRevisionOf(accepted)).toBe("source:audit-1@rev-7");
    expect(immutableRevisionOf(listEnvelope([]))).toBeUndefined();
    expect(immutableRevisionOf(null)).toBeUndefined();
  });
});

describe("attempt completion storage, completeRun promotion, replay window, and evidence states (scenarios 11, 12)", () => {
  type Harness = TestConvex<typeof schema>;

  const shifts: TestBridgeRequest = { capabilityId: SHIFTS_MANIFEST.capabilityId, namespace: "ops.shifts", verb: "list", args: { status: "open" } };
  const storeDay: TestBridgeRequest = { capabilityId: STORE_DAY_MANIFEST.capabilityId, namespace: "ops.storeDay", verb: "get", args: { operatingDate: "2026-08-21" } };
  const audit: TestBridgeRequest = { capabilityId: AUDIT_TRAIL_MANIFEST.capabilityId, namespace: "ops.auditTrail", verb: "list", args: {} };

  async function seedCompletedAttempt(t: Harness, slug: string, options: { withBinding?: boolean } = {}) {
    const run = await t.run((ctx) => seedDelegatedRun(ctx, slug, { withBinding: options.withBinding }));
    const attempt = await t.run((ctx) => beginExecutingAttempt(ctx, run));
    const calls = {
      shifts: await bridgeCall(t, run, attempt.attemptId, shifts, { key: "c-shifts" }),
      storeDay: await bridgeCall(t, run, attempt.attemptId, storeDay, { key: "c-day" }),
      audit: await bridgeCall(t, run, attempt.attemptId, audit, { key: "c-audit" }),
    };
    for (const call of Object.values(calls)) if (call.settled?.outcome !== "released") throw new Error(JSON.stringify(call));
    const finished = await t.run((ctx) =>
      TEST_EXECUTOR_SEAMS.finishAttemptWithCtx(ctx, {
        attemptId: attempt.attemptId,
        end: { status: "completed", output: { openShifts: 1, dayStatus: "open" }, diagnostics: { elapsedMs: 12, hostCalls: 3, maxInFlight: 1, bridgeArgsBytes: 40, bridgeOutputBytes: 900, resultBytes: 40, sourceBytes: 80 } },
        now: TEST_NOW_BASE + 100,
      }),
    );
    if (finished.outcome !== "result") throw new Error(JSON.stringify(finished));
    return { run, attempt, calls, finished };
  }

  function payloadsOf(t: Harness, runId: Doc<"intelligenceRun">["_id"]) {
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- bounded test inspection
    return t.run((ctx) => ctx.db.query("agentReplayPayload").withIndex("by_runId", (q) => q.eq("runId", runId)).collect());
  }

  it("stores the authored and exact validated source, every released call's complete sanitized output, and the result — all short-lived — at attempt completion", async () => {
    const t = convexTest(schema, modules);
    const { run, attempt, finished } = await seedCompletedAttempt(t, "storage");
    const payloads = await payloadsOf(t, run.runId);
    expect(payloads.map((payload) => [payload.subjectKind, payload.retentionClass]).sort()).toEqual([
      ["call_output", "short_lived"],
      ["call_output", "short_lived"],
      ["call_output", "short_lived"],
      ["program_result", "short_lived"],
      ["program_source", "short_lived"],
    ]);
    const source = payloads.find((payload) => payload.subjectKind === "program_source")!;
    expect(source.content).toMatchObject({ authored: expect.stringContaining("athena.ops.shifts.list"), validated: expect.stringContaining("__athena_program"), facade: attempt.facade });
    expect(source.expiresAt).toBe(TEST_NOW_BASE + SHORT_LIVED_RETENTION_MS);
    const row = await t.run((ctx) => ctx.db.get("agentProgramAttempt", attempt.attemptId));
    expect(row).toMatchObject({ status: "result_produced", resultHash: finished.resultHash, validatedSourceHash: expect.stringMatching(/^sha256:/), egressClass: "sensitive", completeness: "complete", providerEgress: { state: "committed" } });
    const result = payloads.find((payload) => payload.subjectKind === "program_result")!;
    expect(result.content).toMatchObject({ output: { openShifts: 1, dayStatus: "open" }, egressClass: "sensitive", completeness: { status: "complete" } });
    expect((result.content as { derivedFromCallRefs: string[] }).derivedFromCallRefs).toHaveLength(3);
    const outputs = payloads.filter((payload) => payload.subjectKind === "call_output");
    for (const output of outputs) expect(scanForRawIdentifiers((output.content as AgentReadEnvelope<unknown>).data)).toEqual([]);
  });

  it("promotes only the cited attempt's source/result, mints deterministic claim slices, records immutable revisions, and never promotes call outputs", async () => {
    const t = convexTest(schema, modules);
    const { run, attempt, finished } = await seedCompletedAttempt(t, "promote", { withBinding: true });
    const other = await t.run((ctx) => beginExecutingAttempt(ctx, run, { key: "attempt-2", source: "return { a: 1 };" }));
    const otherFinished = await t.run((ctx) =>
      TEST_EXECUTOR_SEAMS.finishAttemptWithCtx(ctx, {
        attemptId: other.attemptId,
        end: { status: "completed", output: { a: 1 }, diagnostics: { elapsedMs: 1, hostCalls: 0, maxInFlight: 0, bridgeArgsBytes: 0, bridgeOutputBytes: 0, resultBytes: 7, sourceBytes: 16 } },
        now: TEST_NOW_BASE + 120,
      }),
    );
    expect(otherFinished.outcome).toBe("result");

    const byNamespace = Object.fromEntries(finished.citations.map((candidate) => [candidate.namespace, candidate]));
    const completed = await t.run((ctx) =>
      TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, {
        runId: run.runId,
        idempotencyKey: "complete-1",
        citedAttemptRefs: [finished.attemptRef],
        citations: [
          { ref: byNamespace["ops.shifts"].citation, claim: "One shift is open." },
          { ref: byNamespace["ops.storeDay"].citation, claim: "The day is open.", claimShape: "day_status" },
          { ref: byNamespace["ops.auditTrail"].citation },
        ],
        artifact: { title: "Answer", summary: "One shift is open and the day is open.", payload: { answer: "..." } },
        now: TEST_NOW_BASE + 200,
      }),
    );
    expect(completed).toMatchObject({ outcome: "completed" });
    if (completed.outcome !== "completed") return;
    expect(completed.citations).toEqual([
      { ref: byNamespace["ops.shifts"].citation, support: "provenance_only", reason: "Shift rows are references." },
      { ref: byNamespace["ops.storeDay"].citation, support: "claim_support" },
      { ref: byNamespace["ops.auditTrail"].citation, support: "provenance_only", reason: "Audit rows are references.", immutableRevisionRef: expect.stringMatching(/^source:audit-.*@rev-7$/) },
    ]);

    const payloads = await payloadsOf(t, run.runId);
    const cited = payloads.filter((payload) => payload.attemptId === attempt.attemptId);
    expect(cited.map((payload) => [payload.subjectKind, payload.retentionClass]).sort()).toEqual([
      ["call_output", "short_lived"],
      ["call_output", "short_lived"],
      ["call_output", "short_lived"],
      ["program_result", "standard"],
      ["program_source", "standard"],
    ]);
    expect(cited.find((payload) => payload.subjectKind === "program_source")!.expiresAt).toBe(TEST_NOW_BASE + 200 + STANDARD_RETENTION_MS);
    const uncited = payloads.filter((payload) => payload.attemptId === other.attemptId);
    expect(uncited.map((payload) => payload.retentionClass)).toEqual(["short_lived", "short_lived"]);
    const rows = await t.run(async (ctx) => ({
      cited: await ctx.db.get("agentProgramAttempt", attempt.attemptId),
      other: await ctx.db.get("agentProgramAttempt", other.attemptId),
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- bounded test inspection
      claims: await ctx.db.query("agentClaimSupport").withIndex("by_runId", (q) => q.eq("runId", run.runId)).collect(),
      binding: await ctx.db.get("agentTurnBinding", run.bindingId!),
    }));
    expect(rows.cited?.cited).toBe(true);
    expect(rows.other?.cited).toBe(false);
    expect(rows.claims).toHaveLength(1);
    expect(rows.claims[0]).toMatchObject({ extractorKey: "ops.storeDay", extractorVersion: "1", slice: { operatingDate: "2026-08-21", status: "open" }, retentionClass: "standard" });
    expect(rows.binding).toMatchObject({ step: "athena_committed", operatorReleaseCommittedAt: TEST_NOW_BASE + 200 });
  });

  it("replays inside the 30-day window from the stored validated source and complete inputs, then reports expired and lifecycle-deleted distinctly", async () => {
    const t = convexTest(schema, modules);
    const { run, attempt, calls } = await seedCompletedAttempt(t, "replay");
    const available = await t.run((ctx) => TEST_EXECUTOR_SEAMS.loadAttemptReplayInputsWithCtx(ctx, { attemptId: attempt.attemptId, now: TEST_NOW_BASE + DAY }));
    expect(available.kind).toBe("available");
    if (available.kind !== "available") return;
    expect(available.source.validated).toContain("__athena_program");
    expect(available.source.facade).toEqual(attempt.facade);
    expect(available.inputs).toHaveLength(3);
    expect(available.missingInputs).toBe(0);
    const shiftsCall = await t.run((ctx) => ctx.db.get("agentCapabilityCall", calls.shifts.admit.outcome === "admitted" ? calls.shifts.admit.callId : (null as never)));
    const shiftsInput = available.inputs.find((input) => input.capabilityId === SHIFTS_MANIFEST.capabilityId)!;
    expect(shiftsInput.requestDigest).toBe(shiftsCall!.normalizedArgsHash);
    expect(shiftsInput.envelope).toEqual(calls.shifts.settled?.outcome === "released" ? calls.shifts.settled.envelope : null);
    expect(available.outputHash).toMatch(/^sha256:/);

    const failed = await t.run(async (ctx) => {
      const second = await beginExecutingAttempt(ctx, run, { key: "attempt-2", source: "return 1;" });
      await TEST_EXECUTOR_SEAMS.finishAttemptWithCtx(ctx, {
        attemptId: second.attemptId,
        end: { status: "failed", code: "runtime_error", message: "boom", diagnostics: { elapsedMs: 1, hostCalls: 0, maxInFlight: 0, bridgeArgsBytes: 0, bridgeOutputBytes: 0, resultBytes: 0, sourceBytes: 9 } },
        now: TEST_NOW_BASE + 300,
      });
      return TEST_EXECUTOR_SEAMS.loadAttemptReplayInputsWithCtx(ctx, { attemptId: second.attemptId, now: TEST_NOW_BASE + 301 });
    });
    expect(failed).toEqual({ kind: "no_result", status: "failed" });

    const later = TEST_NOW_BASE + SHORT_LIVED_RETENTION_MS + DAY;
    await t.run((ctx) => sweepExpiredAgentContentWithCtx(ctx, { now: later, limit: 100 }));
    const expired = await t.run((ctx) => TEST_EXECUTOR_SEAMS.loadAttemptReplayInputsWithCtx(ctx, { attemptId: attempt.attemptId, now: later }));
    expect(expired).toMatchObject({ kind: "expired" });

    const deleted = await t.run(async (ctx) => {
      await removeStoreWithCtx(ctx, run.operator.storeId);
      return TEST_EXECUTOR_SEAMS.loadAttemptReplayInputsWithCtx(ctx, { attemptId: attempt.attemptId, now: later });
    });
    expect(deleted).toEqual({ kind: "deleted_by_lifecycle" });
  });

  it("answers reconstructible (claim slice or immutable revision), provenance_only, evidence_expired, and evidence_deleted_by_lifecycle honestly after replay expiry", async () => {
    const t = convexTest(schema, modules);
    const { run, finished } = await seedCompletedAttempt(t, "states");
    const byNamespace = Object.fromEntries(finished.citations.map((candidate) => [candidate.namespace, candidate]));
    const completed = await t.run((ctx) =>
      TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, {
        runId: run.runId,
        idempotencyKey: "complete-1",
        citedAttemptRefs: [finished.attemptRef],
        citations: [
          { ref: byNamespace["ops.shifts"].citation },
          { ref: byNamespace["ops.storeDay"].citation, claimShape: "day_status" },
          { ref: byNamespace["ops.auditTrail"].citation },
        ],
        artifact: { payload: { answer: "..." } },
        now: TEST_NOW_BASE + 200,
      }),
    );
    if (completed.outcome !== "completed") throw new Error(JSON.stringify(completed));
    const [shiftsBinding, dayBinding, auditBinding] = completed.citationBindingIds;
    const viewer = { principalKind: "athenaUser" as const, actorRef: "athenaUser:investigator" };
    const states = async (now: number) =>
      t.run(async (ctx) => ({
        shifts: (await readCitationEvidenceWithCtx(ctx, { citationBindingId: shiftsBinding, viewer, purpose: "investigation", now }))?.state,
        day: (await readCitationEvidenceWithCtx(ctx, { citationBindingId: dayBinding, viewer, purpose: "investigation", now }))?.state,
        audit: (await readCitationEvidenceWithCtx(ctx, { citationBindingId: auditBinding, viewer, purpose: "investigation", now }))?.state,
      }));

    expect(await states(TEST_NOW_BASE + DAY)).toEqual({ shifts: "reconstructible", day: "reconstructible", audit: "reconstructible" });
    const afterReplay = TEST_NOW_BASE + SHORT_LIVED_RETENTION_MS + DAY;
    await t.run((ctx) => sweepExpiredAgentContentWithCtx(ctx, { now: afterReplay, limit: 100 }));
    expect(await states(afterReplay)).toEqual({ shifts: "provenance_only", day: "reconstructible", audit: "reconstructible" });
    const view = await t.run((ctx) => readCitationEvidenceWithCtx(ctx, { citationBindingId: auditBinding, viewer, purpose: "investigation", now: afterReplay }));
    expect(view?.citation.immutableRevisionRef).toMatch(/@rev-7$/);
    const afterStandard = TEST_NOW_BASE + 200 + STANDARD_RETENTION_MS + DAY;
    await t.run((ctx) => sweepExpiredAgentContentWithCtx(ctx, { now: afterStandard, limit: 100 }));
    expect(await states(afterStandard)).toEqual({ shifts: "evidence_expired", day: "evidence_expired", audit: "evidence_expired" });

    const second = await seedCompletedAttempt(t, "states-deleted");
    const secondCompleted = await t.run((ctx) =>
      TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, {
        runId: second.run.runId,
        idempotencyKey: "complete-2",
        citedAttemptRefs: [second.finished.attemptRef],
        citations: [{ ref: second.finished.citations[0].citation }],
        artifact: { payload: { answer: "..." } },
        now: TEST_NOW_BASE + 200,
      }),
    );
    if (secondCompleted.outcome !== "completed") throw new Error(JSON.stringify(secondCompleted));
    const deletedState = await t.run(async (ctx) => {
      await removeStoreWithCtx(ctx, second.run.operator.storeId);
      return (await readCitationEvidenceWithCtx(ctx, { citationBindingId: secondCompleted.citationBindingIds[0], viewer, purpose: "investigation", now: TEST_NOW_BASE + DAY }))?.state;
    });
    expect(deletedState).toBe("evidence_deleted_by_lifecycle");
  });
});
