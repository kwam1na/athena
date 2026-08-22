/// <reference types="vite/client" />
/**
 * Intended behaviour of the eleven Daily Operations resources (V26-1267).
 *
 * These run the REAL handlers through the REAL kernel port query against a
 * seeded store: reauthorization, scope derivation, argument validation,
 * projection stripping, bounds, freshness, per-source completeness, cursor
 * minting, and the raw-identifier scan are all the production code paths. Only
 * the enablement overlay differs (see `dailyOperations.smokeHarness.ts`).
 *
 * Read alongside the characterization suites in each domain folder: those pin
 * what the existing seams return, these pin what the semantic resources say
 * about it.
 */
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import type { AgentCapabilityRequest } from "../../../shared/agentHarness/bridge";
import { scanForRawIdentifiers } from "../../../shared/agentHarness/results";
import { agentReadPorts } from "../../platform/operationAdmission";
import {
  CURRENT_OPERATING_DATE,
  FIXTURE_NOW,
  PRIOR_OPERATING_DATE,
} from "./dailyOperations.fixture";
import {
  DAILY_OPERATIONS_MANIFESTS,
} from "../profiles/dailyOperations";
import { SMOKE_ADMISSION, SMOKE_CLOCK, SMOKE_SEAMS, seedSmokeRun, type SmokeRun } from "./dailyOperations.smokeHarness";

/**
 * convex-test resolves `<convex root>/<function path>`, so every glob key has to
 * be normalized to a path relative to `convex/`. Vite emits three shapes from
 * this directory: `../../<dir>/...` for other domains, `../<file>` for sibling
 * harness modules, and `./<file>` for this directory.
 */
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../../")
      ? path.replace(/^\.\.\/\.\.\//, "./")
      : path.startsWith("../")
        ? path.replace(/^\.\.\//, "./agentHarness/")
        : path.replace(/^\.\//, "./agentHarness/evals/"),
    loader,
  ]),
);
modules["./agentHarness/evals/dailyOperationsSmokePorts.ts"] =
  modules["./agentHarness/evals/dailyOperations.smokeHarness.ts"];
if (!modules["./agentHarness/evals/dailyOperationsSmokePorts.ts"]) {
  throw new Error(`smoke harness module key not found; got ${Object.keys(modules).slice(0, 5).join(", ")}`);
}

type Harness = TestConvex<typeof schema>;
type AnyCall = (reference: unknown, args: unknown) => Promise<unknown>;

let callSeq = 0;

/** An executing attempt through the seams, exactly as the executor creates one. */
async function beginAttempt(t: Harness, run: SmokeRun) {
  const prepared = await t.run((ctx) =>
    SMOKE_SEAMS.prepareAttemptWithCtx(ctx, { runId: run.runId, now: SMOKE_CLOCK.now }),
  );
  if (prepared.outcome !== "ready") throw new Error(JSON.stringify(prepared));
  const source = "return {};";
  const begun = await t.run((ctx) =>
    SMOKE_SEAMS.beginAttemptWithCtx(ctx, {
      runId: run.runId,
      attemptIdempotencyKey: `attempt-${run.runId}`,
      programSource: source,
      validation: { ok: true, validatedSource: `async function __athena_program() {\n"use strict";\n${source}\n}\n` },
      facade: prepared.facade,
      now: SMOKE_CLOCK.now,
    }),
  );
  if (begun.outcome !== "executing") throw new Error(JSON.stringify(begun));
  return begun.attemptId;
}

type ReadOutcome =
  | { kind: "envelope"; data: unknown; envelope: Record<string, unknown> }
  | { kind: "refused" | "unavailable" | "failed" | "denied"; detail: unknown };

/** One capability call the way the executor makes it: admit → dispatch → release. */
async function read(
  t: Harness,
  run: SmokeRun,
  attemptId: Id<"agentProgramAttempt">,
  request: { namespace: string; verb: "get" | "list"; args: Record<string, unknown>; cursor?: string },
): Promise<ReadOutcome> {
  const manifest = DAILY_OPERATIONS_MANIFESTS.find(
    (candidate) => `${candidate.namespace.package}.${candidate.namespace.resource}` === request.namespace,
  );
  if (!manifest) throw new Error(`unknown namespace ${request.namespace}`);
  callSeq += 1;
  const admit = await t.run((ctx) =>
    SMOKE_SEAMS.reserveAndAdmitCallWithCtx(ctx, {
      runId: run.runId,
      attemptId,
      callIdempotencyKey: `call-${callSeq}`,
      request: {
        capabilityId: manifest.capabilityId,
        namespace: request.namespace,
        verb: request.verb,
        args: request.args,
        cursor: request.cursor,
      } as AgentCapabilityRequest,
      now: SMOKE_CLOCK.now,
    }),
  );
  if (admit.outcome !== "admitted") return { kind: "denied", detail: admit };
  const response = await SMOKE_SEAMS.dispatchReadPort(
    { runQuery: (reference, args) => (t.query as unknown as AnyCall)(reference, args) as never },
    admit.invocation,
  );
  const settled = await t.run((ctx) =>
    SMOKE_SEAMS.settleCallWithCtx(ctx, {
      callId: admit.callId,
      response,
      elapsedMs: 5,
      now: SMOKE_CLOCK.now + 5,
    }),
  );
  if (settled.outcome === "released") {
    return {
      kind: "envelope",
      data: settled.envelope.data,
      envelope: settled.envelope as unknown as Record<string, unknown>,
    };
  }
  return { kind: response.kind === "envelope" ? "failed" : response.kind, detail: { response, settled } };
}

function expectEnvelope(outcome: ReadOutcome) {
  expect(outcome.kind, JSON.stringify(outcome)).toBe("envelope");
  if (outcome.kind !== "envelope") throw new Error("unreachable");
  return outcome;
}

beforeEach(() => {
  SMOKE_CLOCK.now = FIXTURE_NOW;
  callSeq = 0;
});

describe("Daily Operations resources", () => {
  it("binds every published port to an internal query at the composition root", () => {
    const declared = DAILY_OPERATIONS_MANIFESTS.map((manifest) => manifest.binding.portKey).sort();
    expect(declared).toEqual([
      "automation.dailyOperations",
      "cash.registerSessions",
      "inventory.positions",
      "inventory.replenishment",
      "operations.activity",
      "operations.approvals",
      "operations.attention",
      "operations.storeDay",
      "reports.daySales",
      "reports.storePulse",
      "reports.weekPerformance",
    ]);
    for (const portKey of declared) {
      const bound = agentReadPorts.bound.get(portKey);
      expect(bound, portKey).toBeDefined();
      expect(bound!.handlerPath).toBe(bound!.port.handler.functionPath);
    }
    expect(agentReadPorts.listUnboundPorts()).toEqual([]);
  });

  it("reads the store day, the attention queue, approvals, and activity for a full admin", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedSmokeRun(ctx, { slug: "ops" }));
    const attemptId = await beginAttempt(t, run);

    const day = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "operations.storeDay",
        verb: "get",
        args: { operatingDate: CURRENT_OPERATING_DATE },
      }),
    );
    const dayData = day.data as Record<string, unknown>;
    expect(dayData.lifecycleStage).toBe("close_blocked");
    expect(dayData.openingStatus).toBe("started");
    expect(dayData.closeStatus).toBe("not_started");
    expect(dayData.pendingApprovalCount).toBe(1);
    expect(dayData.transactionCount).toBe(2);
    expect(dayData.operatingWindow).toEqual({ derivation: "schedule", timezone: "Africa/Accra" });
    // Manager review evidence is granted for a full admin.
    expect(Array.isArray(dayData.managerReviewEvidence)).toBe(true);
    expect((dayData.managerReviewEvidence as unknown[]).length).toBe(1);
    expect(day.envelope.freshness).toMatchObject({ class: "live", authority: "authoritative_record" });
    expect(day.envelope.completeness).toMatchObject({ status: "complete" });

    const attention = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "operations.attention",
        verb: "list",
        args: { operatingDate: CURRENT_OPERATING_DATE },
      }),
    );
    const attentionRows = attention.data as Record<string, unknown>[];
    expect(attentionRows.length).toBeGreaterThan(0);
    expect(new Set(attentionRows.map((row) => row.status))).not.toContain("unknown");
    expect(attentionRows.every((row) => typeof row.itemRef === "string" && row.itemRef.startsWith("resource:"))).toBe(true);
    expect(attentionRows.every((row) => typeof row.managerReason === "string")).toBe(true);

    const approvals = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "operations.approvals",
        verb: "list",
        args: { operatingDate: CURRENT_OPERATING_DATE, state: "pending" },
      }),
    );
    const approvalRows = approvals.data as Record<string, unknown>[];
    expect(approvalRows).toHaveLength(1);
    expect(approvalRows[0].requestKind).toBe("variance_review");
    expect(approvalRows[0].state).toBe("pending");
    expect(typeof approvalRows[0].approvalProof).toBe("string");

    const activity = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "operations.activity",
        verb: "list",
        args: { operatingDate: CURRENT_OPERATING_DATE },
      }),
    );
    const activityRows = activity.data as Record<string, unknown>[];
    expect(activityRows.length).toBeGreaterThanOrEqual(2);
    const times = activityRows.map((row) => row.occurredAt as number);
    expect([...times].sort((left, right) => right - left)).toEqual(times);
    expect(activityRows.every((row) => typeof row.financialDetail === "string")).toBe(true);
  });

  it("reports frozen and live report authority differently", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedSmokeRun(ctx, { slug: "reports" }));
    const attemptId = await beginAttempt(t, run);

    const accepted = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "reports.daySales",
        verb: "get",
        args: { operatingDate: PRIOR_OPERATING_DATE },
      }),
    );
    const acceptedData = accepted.data as Record<string, unknown>;
    expect(acceptedData.recordState).toBe("reconciled");
    expect(acceptedData.recordRevision).toBe("7");
    expect(accepted.envelope.freshness).toMatchObject({ class: "accepted", authority: "authoritative_record", sourceVersion: "7" });
    expect(acceptedData.revenue).toEqual({ state: "known", value: { amount: 30_000, currency: "GHS" } });
    expect(accepted.envelope.completeness).toMatchObject({ status: "complete" });

    const live = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "reports.daySales",
        verb: "get",
        args: { operatingDate: CURRENT_OPERATING_DATE },
      }),
    );
    const liveData = live.data as Record<string, unknown>;
    expect(liveData.recordState).toBe("open");
    expect(liveData.recordRevision).toBeUndefined();
    expect(live.envelope.freshness).toMatchObject({ class: "live" });
    // The open day has no reconciling payment mix, so the aggregate is partial.
    expect(live.envelope.completeness).toMatchObject({ status: "partial" });
  });

  it("answers a day with no record without inventing totals", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedSmokeRun(ctx, { slug: "empty" }));
    const attemptId = await beginAttempt(t, run);
    const empty = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "reports.daySales",
        verb: "get",
        args: { operatingDate: "2026-01-01" },
      }),
    );
    const data = empty.data as Record<string, unknown>;
    expect(data.recordState).toBe("absent");
    expect(data.transactionCount).toBe(0);
    expect(data.revenue).toEqual({ state: "unknown", reason: "not_recorded" });
    expect(empty.envelope.completeness).toMatchObject({ status: "partial" });
    const sources = (empty.envelope.completeness as { sources: { sourceKey: string; status: string }[] }).sources;
    expect(sources.find((source) => source.sourceKey === "report")?.status).toBe("unavailable");
  });

  it("reads week performance, the pulse, registers, automation, and stock", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedSmokeRun(ctx, { slug: "wide" }));
    const attemptId = await beginAttempt(t, run);

    const week = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "reports.weekPerformance",
        verb: "get",
        args: { weekEndOperatingDate: CURRENT_OPERATING_DATE },
      }),
    );
    const weekData = week.data as { days: Record<string, unknown>[]; weekEndOperatingDate: string };
    expect(weekData.weekEndOperatingDate).toBe("2026-08-22");
    expect(weekData.days).toHaveLength(8);
    expect(weekData.days.filter((day) => day.isPriorBoundary)).toHaveLength(1);
    expect(new Set(weekData.days.map((day) => day.authority))).toEqual(new Set(["accepted", "live"]));

    const pulse = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "reports.storePulse",
        verb: "get",
        args: { operatingDate: CURRENT_OPERATING_DATE, window: "today" },
      }),
    );
    const pulseData = pulse.data as Record<string, unknown>;
    expect(pulseData.transactionCount).toBe(2);
    expect(pulseData.revenue).toEqual({ state: "known", value: { amount: 95_000, currency: "GHS" } });
    expect(pulse.envelope.freshness).toMatchObject({ class: "derived", authority: "derived" });

    const registers = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "cash.registerSessions",
        verb: "list",
        args: { operatingDate: CURRENT_OPERATING_DATE },
      }),
    );
    const registerRows = registers.data as Record<string, unknown>[];
    expect(registerRows).toHaveLength(2);
    expect(registerRows[0].status).toBe("open");
    const closed = registerRows.find((row) => row.status === "closed")!;
    expect(closed.variance).toEqual({ state: "known", value: { amount: -500, currency: "GHS" } });
    expect(registerRows[0].countedCash).toEqual({ state: "unknown", reason: "not_yet_available" });

    // A session reference minted by `list` resolves through `get`.
    const one = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "cash.registerSessions",
        verb: "get",
        args: { sessionRef: closed.sessionRef },
      }),
    );
    expect((one.data as Record<string, unknown>).registerLabel).toBe("Register 2");

    const automation = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "automation.dailyOperations",
        verb: "list",
        args: { operatingDate: CURRENT_OPERATING_DATE },
      }),
    );
    const automationRows = automation.data as Record<string, unknown>[];
    expect(automationRows).toHaveLength(2);
    expect(new Set(automationRows.map((row) => row.action))).toEqual(
      new Set(["opening.auto_start", "eod.prepare"]),
    );
    expect(automationRows.map((row) => row.disposition).sort()).toEqual(["action_taken", "needs_review"]);
    const automationSources = (automation.envelope.completeness as {
      sources: { sourceKey: string; status: string; missing?: string[] }[];
    }).sources;
    const scheduled = automationSources.find((source) => source.sourceKey === "scheduledWindows")!;
    expect(scheduled.status).toBe("partial");
    expect(scheduled.missing).toEqual(["eod.auto_complete"]);

    const positions = expectEnvelope(
      await read(t, run, attemptId, { namespace: "inventory.positions", verb: "list", args: {} }),
    );
    const positionRows = positions.data as Record<string, unknown>[];
    expect(positionRows).toHaveLength(2);
    expect(positionRows.map((row) => row.stockState).sort()).toEqual(["in_stock", "low"]);
    // A full admin holds the cost-overlay read intent, so the overlay is present.
    expect(positionRows[0].unitCost).toBeDefined();

    const replenishment = expectEnvelope(
      await read(t, run, attemptId, { namespace: "inventory.replenishment", verb: "list", args: {} }),
    );
    const replenishmentRows = replenishment.data as Record<string, unknown>[];
    expect(replenishmentRows).toHaveLength(1);
    expect(replenishmentRows[0].continuityStatus).toBe("exposed");
    expect(replenishmentRows[0].needsAction).toBe(true);
    expect(replenishmentRows[0].supplierCommitment).toBeDefined();
  });

  it("omits sensitive fields and whole resources for a POS-only operator", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedSmokeRun(ctx, { slug: "pos", role: "pos_only" }));
    const attemptId = await beginAttempt(t, run);

    // Registers stay reachable; every cash figure is structurally ABSENT.
    const registers = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "cash.registerSessions",
        verb: "list",
        args: { operatingDate: CURRENT_OPERATING_DATE },
      }),
    );
    for (const row of registers.data as Record<string, unknown>[]) {
      expect(Object.keys(row)).not.toContain("variance");
      expect(Object.keys(row)).not.toContain("expectedCash");
      expect(Object.keys(row)).not.toContain("countedCash");
      expect(Object.keys(row)).not.toContain("closeoutHistory");
      // ... and nothing was replaced by a zero.
      expect(JSON.stringify(row)).not.toContain('"amount":0');
    }

    // The store day is reachable but manager review evidence is absent.
    const day = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "operations.storeDay",
        verb: "get",
        args: { operatingDate: CURRENT_OPERATING_DATE },
      }),
    );
    expect(Object.keys(day.data as Record<string, unknown>)).not.toContain("managerReviewEvidence");

    // Positions stay reachable; the cost overlay escalation fails closed.
    const positions = expectEnvelope(
      await read(t, run, attemptId, { namespace: "inventory.positions", verb: "list", args: {} }),
    );
    for (const row of positions.data as Record<string, unknown>[]) {
      expect(Object.keys(row)).not.toContain("unitCost");
      expect(Object.keys(row)).not.toContain("stockValue");
      expect(row.onHand).toBeDefined();
    }

    // Whole resources the operator cannot discover are refused, not emptied.
    for (const namespace of ["reports.daySales", "reports.weekPerformance", "reports.storePulse", "operations.activity", "inventory.replenishment"]) {
      const refused = await read(t, run, attemptId, {
        namespace,
        verb: namespace === "operations.activity" || namespace === "inventory.replenishment" ? "list" : "get",
        args:
          namespace === "reports.weekPerformance"
            ? { weekEndOperatingDate: CURRENT_OPERATING_DATE }
            : namespace === "reports.storePulse"
              ? { operatingDate: CURRENT_OPERATING_DATE, window: "today" }
              : namespace === "inventory.replenishment"
                ? {}
                : { operatingDate: CURRENT_OPERATING_DATE },
      });
      expect(refused.kind, namespace).toBe("denied");
    }
  });

  it("refuses timezone offsets, raw windows, guessed refs, and cross-store refs", async () => {
    const t = convexTest(schema, modules);
    const own = await t.run((ctx) => seedSmokeRun(ctx, { slug: "own" }));
    const other = await t.run((ctx) => seedSmokeRun(ctx, { slug: "other", key: "smoke-other" }));
    const attemptId = await beginAttempt(t, own);

    // The schema has no timestamp/offset/window filter at all: they are unknown filters.
    for (const args of [
      { operatingDate: CURRENT_OPERATING_DATE, timezoneOffsetMinutes: -60 },
      { operatingDate: CURRENT_OPERATING_DATE, startAt: 1, endAt: 2 },
      { operatingDate: "2026-08-21T00:00:00Z" },
      { operatingDate: "2026-13-40" },
    ]) {
      const rejected = await read(t, own, attemptId, {
        namespace: "operations.storeDay",
        verb: "get",
        args,
      });
      expect(rejected.kind, JSON.stringify(args)).not.toBe("envelope");
    }

    // A guessed opaque ref fails the binding digest.
    const guessed = await read(t, own, attemptId, {
      namespace: "cash.registerSessions",
      verb: "get",
      args: { sessionRef: "resource:register_session.deadbeef.0123456789abcdef01234567" },
    });
    expect(guessed.kind).toBe("unavailable");

    // A ref minted for ANOTHER store does not resolve in this one.
    const otherAttempt = await beginAttempt(t, other);
    const otherSessions = expectEnvelope(
      await read(t, other, otherAttempt, {
        namespace: "cash.registerSessions",
        verb: "list",
        args: { operatingDate: CURRENT_OPERATING_DATE },
      }),
    );
    const foreignRef = (otherSessions.data as Record<string, unknown>[])[0].sessionRef as string;
    const crossStore = await read(t, own, attemptId, {
      namespace: "cash.registerSessions",
      verb: "get",
      args: { sessionRef: foreignRef },
    });
    expect(crossStore.kind).toBe("unavailable");
  });

  it("falls back to the calendar day and says so when no schedule governs the date", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedSmokeRun(ctx, { slug: "noschedule", withSchedule: false }));
    const attemptId = await beginAttempt(t, run);
    const day = expectEnvelope(
      await read(t, run, attemptId, {
        namespace: "operations.storeDay",
        verb: "get",
        args: { operatingDate: CURRENT_OPERATING_DATE },
      }),
    );
    expect((day.data as Record<string, unknown>).operatingWindow).toEqual({ derivation: "utc_fallback" });
    expect(day.envelope.warnings).toEqual([
      expect.objectContaining({ code: "operating_window_fallback", sourceKey: "lifecycle" }),
    ]);
  });

  it("never leaks a raw identifier into any resource's result", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedSmokeRun(ctx, { slug: "ids" }));
    const attemptId = await beginAttempt(t, run);
    const reads: { namespace: string; verb: "get" | "list"; args: Record<string, unknown> }[] = [
      { namespace: "operations.storeDay", verb: "get", args: { operatingDate: CURRENT_OPERATING_DATE } },
      { namespace: "operations.attention", verb: "list", args: { operatingDate: CURRENT_OPERATING_DATE } },
      { namespace: "operations.approvals", verb: "list", args: { operatingDate: CURRENT_OPERATING_DATE, state: "pending" } },
      { namespace: "operations.activity", verb: "list", args: { operatingDate: CURRENT_OPERATING_DATE } },
      { namespace: "reports.daySales", verb: "get", args: { operatingDate: PRIOR_OPERATING_DATE } },
      { namespace: "reports.weekPerformance", verb: "get", args: { weekEndOperatingDate: CURRENT_OPERATING_DATE } },
      { namespace: "reports.storePulse", verb: "get", args: { operatingDate: CURRENT_OPERATING_DATE, window: "today" } },
      { namespace: "cash.registerSessions", verb: "list", args: { operatingDate: CURRENT_OPERATING_DATE } },
      { namespace: "automation.dailyOperations", verb: "list", args: { operatingDate: CURRENT_OPERATING_DATE } },
      { namespace: "inventory.positions", verb: "list", args: {} },
      { namespace: "inventory.replenishment", verb: "list", args: {} },
    ];
    for (const request of reads) {
      const outcome = expectEnvelope(await read(t, run, attemptId, request));
      expect(scanForRawIdentifiers(outcome.data), request.namespace).toEqual([]);
      expect(JSON.stringify(outcome.data), request.namespace).not.toContain(run.storeId);
    }
  });

  it("describes a POS-only grant with strictly fewer capabilities than a full admin's", async () => {
    const t = convexTest(schema, modules);
    const admin = await t.run((ctx) => seedSmokeRun(ctx, { slug: "grant-admin" }));
    const pos = await t.run((ctx) => seedSmokeRun(ctx, { slug: "grant-pos", role: "pos_only", key: "smoke-pos" }));

    const describe = async (run: SmokeRun) => {
      const verdict = await t.run((ctx) =>
        SMOKE_ADMISSION.reauthorizeGrantWithCtx(ctx, { runId: run.runId, purpose: "release", now: SMOKE_CLOCK.now }),
      );
      if (verdict.kind === "refused") throw new Error(JSON.stringify(verdict));
      return SMOKE_ADMISSION.describeGrantForModel(verdict);
    };

    const adminGrant = await describe(admin);
    const posGrant = await describe(pos);
    const adminCapabilities = new Set(adminGrant.capabilityIds);
    const posCapabilities = new Set(posGrant.capabilityIds);

    expect(adminCapabilities.size).toBe(11);
    expect(posCapabilities.size).toBeLessThan(adminCapabilities.size);
    for (const capabilityId of posCapabilities) expect(adminCapabilities).toContain(capabilityId);
    expect(posGrant.grantedProjectionsByCapability["cap_dailyops_register_sessions"]).toEqual([]);
    expect(adminGrant.grantedProjectionsByCapability["cap_dailyops_register_sessions"]).toEqual(["cashFinancials"]);
    expect(posGrant.grantedProjectionsByCapability["cap_dailyops_inventory_positions"]).toEqual([]);
    expect(adminGrant.grantedProjectionsByCapability["cap_dailyops_inventory_positions"]).toEqual(["costOverlay"]);
  });
});
