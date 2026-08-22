/**
 * Read-port registry: closed binding map, opaque cursors, and envelope
 * finishing (field omission, contract enforcement, bounds).
 */
import { anyApi, makeFunctionReference, type FunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "../_generated/api";
import { opaqueRef } from "../../shared/agentHarness/values";
import {
  SHIFTS_MANIFEST,
  STORE_DAY_MANIFEST,
  TEST_NOW_BASE,
  TEST_PORT_BINDINGS,
  TEST_REGISTRY,
} from "./delegatedAdmission.testPorts";
import {
  AgentReadPortBindingError,
  createAgentReadPortRegistry,
  finishAgentReadEnvelope,
  mintAgentCursor,
  resolveAgentCursor,
  resolveAgentReadPortHandler,
  validateAgentReadRequestArgs,
  type AgentReadPortInvocationBinding,
} from "./readPorts";

const RUN_A = "run-a";
const RUN_B = "run-b";

const internalRef = (name: string) =>
  makeFunctionReference<"query">(name) as unknown as FunctionReference<"query", "internal">;

describe("read-port registry bindings", () => {
  it("binds only generated ports to references whose function name is exactly the registered internal path", () => {
    const registry = createAgentReadPortRegistry({ registry: TEST_REGISTRY, bindings: TEST_PORT_BINDINGS });
    const bound = resolveAgentReadPortHandler(registry, "ops.shifts");
    expect(bound.kind).toBe("bound");
    if (bound.kind !== "bound") return;
    expect(bound.port.capabilityId).toBe(SHIFTS_MANIFEST.capabilityId);
    expect(registry.listUnboundPorts()).toEqual([]);
    expect(resolveAgentReadPortHandler(registry, "ops.nope")).toEqual({ kind: "unregistered", portKey: "ops.nope" });
  });

  it("leaves a generated port without a binding unreachable instead of guessing", () => {
    const registry = createAgentReadPortRegistry({
      registry: TEST_REGISTRY,
      bindings: TEST_PORT_BINDINGS.filter((binding) => binding.portKey !== "ops.auditTrail"),
    });
    expect(registry.listUnboundPorts()).toEqual(["ops.auditTrail"]);
    expect(resolveAgentReadPortHandler(registry, "ops.auditTrail")).toEqual({ kind: "unbound", portKey: "ops.auditTrail" });
  });

  it("rejects a public api.* reference, a mismatched internal target, an unknown port, a duplicate, and a non-reference", () => {
    const attempt = (bindings: readonly AgentReadPortInvocationBinding[]) => () =>
      createAgentReadPortRegistry({ registry: TEST_REGISTRY, bindings });

    expect(
      attempt([
        {
          portKey: "ops.shifts",
          handler: api.operations.dailyOperations.getDailyOperationsSnapshot as unknown as FunctionReference<"query", "internal">,
        },
      ]),
    ).toThrow(AgentReadPortBindingError);
    try {
      attempt([
        {
          portKey: "ops.shifts",
          handler: api.operations.dailyOperations.getDailyOperationsSnapshot as unknown as FunctionReference<"query", "internal">,
        },
      ])();
    } catch (error) {
      expect((error as AgentReadPortBindingError).code).toBe("handler_path_mismatch");
    }

    expect(attempt([{ portKey: "ops.shifts", handler: internalRef("agentHarness/testPorts:getStoreDay") }])).toThrow(
      /handler_path_mismatch/,
    );
    expect(attempt([{ portKey: "ops.unknown", handler: internalRef("agentHarness/testPorts:listShifts") }])).toThrow(
      /port_unregistered/,
    );
    expect(attempt([TEST_PORT_BINDINGS[0], TEST_PORT_BINDINGS[0]])).toThrow(/binding_duplicate/);
    expect(
      attempt([{ portKey: "ops.shifts", handler: { functionPath: "agentHarness/testPorts:listShifts" } as never }]),
    ).toThrow(/handler_not_function_reference/);
    // `anyApi` is the same proxy `internal` is: the name still has to match.
    expect(
      attempt([
        {
          portKey: "ops.shifts",
          handler: (anyApi as unknown as { operations: { dailyOperations: { getDailyOperationsSnapshot: FunctionReference<"query", "internal"> } } })
            .operations.dailyOperations.getDailyOperationsSnapshot,
        },
      ]),
    ).toThrow(/handler_path_mismatch/);
  });
});

describe("opaque cursors", () => {
  it("mints run- and port-bound cursors that never look like document ids and refuse to cross runs or ports", () => {
    const cursor = mintAgentCursor({ runId: RUN_A, portKey: "ops.shifts", rawCursor: "page-2", pageIndex: 1 });
    expect(cursor.startsWith("cursor:")).toBe(true);
    expect(cursor).not.toContain("page-2");
    expect(resolveAgentCursor(cursor, { runId: RUN_A, portKey: "ops.shifts" })).toEqual({ rawCursor: "page-2", pageIndex: 1 });
    expect(resolveAgentCursor(cursor, { runId: RUN_B, portKey: "ops.shifts" })).toBeNull();
    expect(resolveAgentCursor(cursor, { runId: RUN_A, portKey: "ops.auditTrail" })).toBeNull();
    expect(resolveAgentCursor("cursor:v1.garbage", { runId: RUN_A, portKey: "ops.shifts" })).toBeNull();
    expect(resolveAgentCursor("resource:shift-1", { runId: RUN_A, portKey: "ops.shifts" })).toBeNull();
    const tampered = cursor.slice(0, -2) + "zz";
    expect(resolveAgentCursor(tampered, { runId: RUN_A, portKey: "ops.shifts" })).toBeNull();
  });
});

describe("request argument validation", () => {
  it("accepts declared filters and rejects unknown names, raw ids, wrong kinds, and missing required filters", () => {
    expect(validateAgentReadRequestArgs(SHIFTS_MANIFEST, "list", { status: "open" })).toEqual({ ok: true });
    expect(validateAgentReadRequestArgs(SHIFTS_MANIFEST, "list", {})).toEqual({ ok: true });
    expect(validateAgentReadRequestArgs(SHIFTS_MANIFEST, "list", { storeId: "k17abcd3fg9h2j4k5m6n7p8q9r0s1t2u" })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "filter_unknown" }), expect.objectContaining({ code: "raw_identifier_in_args" })]),
    });
    expect(validateAgentReadRequestArgs(SHIFTS_MANIFEST, "list", { status: "weird" })).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "filter_value_invalid", path: "status" })],
    });
    expect(validateAgentReadRequestArgs(STORE_DAY_MANIFEST, "get", {})).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "filter_required", path: "operatingDate" })],
    });
    expect(validateAgentReadRequestArgs(STORE_DAY_MANIFEST, "get", { operatingDate: "not-a-date" })).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "filter_value_invalid" })],
    });
    expect(validateAgentReadRequestArgs(SHIFTS_MANIFEST, "get", {})).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "verb_unsupported" })],
    });
    expect(validateAgentReadRequestArgs(SHIFTS_MANIFEST, "list", { cursor: "cursor:x" })).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "filter_unknown", path: "cursor" })],
    });
  });
});

describe("envelope finishing", () => {
  const port = TEST_REGISTRY.readPorts["ops.shifts"];
  const rows = [
    { shiftRef: opaqueRef("resource", "shift-1"), label: "Morning", status: "closed", revenue: { amountMinor: 1, currency: "GHS" }, managerNotes: "n" },
  ];
  const output = {
    kind: "data" as const,
    data: rows,
    observedAt: TEST_NOW_BASE - 5,
    freshness: { class: "live" as const, authority: "live_read" as const },
    sources: [{ sourceKey: "shifts", status: "complete" as const }],
    sourceRefs: [{ ref: opaqueRef("source", "page-1"), kind: "shift", capturedAt: TEST_NOW_BASE - 5 }],
    page: { hasMore: true, rawCursor: "page-2" },
  };
  const context = { runId: RUN_A, portKey: "ops.shifts", pageIndex: 0, now: TEST_NOW_BASE };

  it("omits ungranted fields structurally, derives completeness, mints the next cursor, and hashes the result", () => {
    const finished = finishAgentReadEnvelope({ manifest: SHIFTS_MANIFEST, port, verb: "list", grantedProjections: [], output, context });
    expect(finished.kind).toBe("envelope");
    if (finished.kind !== "envelope") return;
    const item = (finished.envelope.data as Record<string, unknown>[])[0];
    expect(Object.keys(item).sort()).toEqual(["label", "shiftRef", "status"]);
    expect("revenue" in item).toBe(false);
    expect(finished.envelope.capabilityId).toBe(SHIFTS_MANIFEST.capabilityId);
    expect(finished.envelope.namespace).toBe("ops.shifts");
    expect(finished.envelope.capturedAt).toBe(TEST_NOW_BASE);
    expect(finished.envelope.observedAt).toBe(TEST_NOW_BASE - 5);
    expect(finished.envelope.completeness).toEqual({ status: "complete", sources: [{ sourceKey: "shifts", status: "complete" }] });
    expect(finished.envelope.pagination).toMatchObject({ hasMore: true, pageIndex: 0, pageSize: 1, pagesRemainingInRun: 1 });
    expect(resolveAgentCursor(finished.envelope.pagination!.cursor!, { runId: RUN_A, portKey: "ops.shifts" })).toEqual({ rawCursor: "page-2", pageIndex: 1 });
    expect(finished.envelope.resultHash).toMatch(/^fnv1a64:/);
    expect(finished.usage).toMatchObject({ rows: 1 });
    const granted = finishAgentReadEnvelope({ manifest: SHIFTS_MANIFEST, port, verb: "list", grantedProjections: ["financials"], output, context });
    if (granted.kind !== "envelope") throw new Error("expected envelope");
    expect(Object.keys((granted.envelope.data as Record<string, unknown>[])[0]).sort()).toEqual(["label", "revenue", "shiftRef", "status"]);
    expect(granted.envelope.resultHash).not.toBe(finished.envelope.resultHash);
  });

  it("fails closed on undeclared fields, raw identifiers, and page bounds instead of passing them through", () => {
    const leaky = finishAgentReadEnvelope({
      manifest: SHIFTS_MANIFEST,
      port,
      verb: "list",
      grantedProjections: [],
      output: { ...output, data: [{ ...rows[0], internalCostBasis: 3 }] },
      context,
    });
    expect(leaky).toMatchObject({ kind: "failed", error: { code: "port_contract_violation" } });
    const rawId = finishAgentReadEnvelope({
      manifest: SHIFTS_MANIFEST,
      port,
      verb: "list",
      grantedProjections: [],
      output: { ...output, data: [{ ...rows[0], label: "k17abcd3fg9h2j4k5m6n7p8q9r0s1t2u" }] },
      context,
    });
    expect(rawId).toMatchObject({ kind: "failed", error: { code: "port_contract_violation" } });
    const oversized = finishAgentReadEnvelope({
      manifest: SHIFTS_MANIFEST,
      port,
      verb: "list",
      grantedProjections: [],
      output: { ...output, data: Array.from({ length: 11 }, () => rows[0]) },
      context,
    });
    expect(oversized).toMatchObject({ kind: "failed", error: { code: "port_contract_violation" } });
    const lastPage = finishAgentReadEnvelope({
      manifest: SHIFTS_MANIFEST,
      port,
      verb: "list",
      grantedProjections: [],
      output,
      context: { ...context, pageIndex: 1 },
    });
    expect(lastPage).toMatchObject({ kind: "envelope", envelope: { pagination: { hasMore: false, pagesRemainingInRun: 0 } } });
    const unavailable = finishAgentReadEnvelope({
      manifest: SHIFTS_MANIFEST,
      port,
      verb: "list",
      grantedProjections: [],
      output: { kind: "unavailable", reason: "offline", retryable: true, sourceKey: "shifts" },
      context,
    });
    expect(unavailable).toEqual({ kind: "unavailable", reason: "offline", retryable: true, sourceKey: "shifts" });
  });
});
