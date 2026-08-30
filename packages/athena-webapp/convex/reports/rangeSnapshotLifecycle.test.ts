/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  REPORTS_FOLD_VERSION,
  deriveMovementRequestLifecycle,
  type ReportMovementLifecycle,
} from "../../shared/reportsContract";
import { REPORTS_SWEEP_STORE_ALLOWLIST_ENV, sweepWithCtx } from "./sweeper";
import { computeRange } from "./customRange";
import {
  MOVEMENT_ADMISSIONS_PER_PRINCIPAL,
  MOVEMENT_RANGE_SNAPSHOT_KIND,
} from "./skuMovementRange";
import {
  ensureRangeSnapshotCore,
  recordRangeSnapshotWorkerFailureCore,
  runRangeSnapshotBatchCore,
  scheduleEligibleRangeSnapshotWork,
  cleanupExpiredRangeSnapshots,
  tryConsumeRangeSnapshotAdmission,
  type RangeSnapshotKindConfig,
} from "./rangeSnapshotLifecycle";

/**
 * U3 seam tests: the kind-generic range-snapshot lifecycle exercised through
 * a SYNTHETIC second kind built purely in test code (no fake kind ships in
 * production — `"custom_summary"` is the schema-valid stand-in literal, and
 * nothing in production registers a lifecycle config for it). Behavioral
 * identity for the first kind is owned by skuMovementRange.test.ts, which
 * runs the full movement suite against the same generic machinery.
 */

// Path-string function references (the worker/batch continuation chain) need
// module keys rooted at the convex directory, so remap the test-relative glob
// exactly as skuMovementRange.test.ts does.
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);

type Harness = ReturnType<typeof convexTest>;

function allow(...storeIds: Id<"store">[]) {
  process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV] = storeIds.join(",");
}

beforeEach(() => {
  // Ensure and the backstop schedule real actions through the convex-test
  // scheduler; frozen timers keep those continuations parked so each test
  // drives the fenced state machine deterministically itself.
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV];
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedStore(t: Harness, slug = "lifecycle") {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", {
      email: `${slug}@example.test`,
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: slug,
      slug,
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: userId,
      currency: "GHS",
      name: slug,
      organizationId,
      slug,
    });
    return { userId, organizationId, storeId };
  });
}

const ZERO_DAY_METRICS = {
  grossSalesMinor: 0,
  netSalesMinor: 0,
  refundsMinor: 0,
  unitsSold: 0,
  unitsReturned: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 0 as number | null,
  paymentsCollectedMinor: 0,
  paymentsRefundedMinor: 0,
  paymentAllocatedMinor: 0,
};

/** Write one certified reportDay (no SKU rows — the synthetic kind's
 * aggregator never reads a source table). */
async function certifyDay(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  revision: number,
) {
  const existing = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .unique();
  const dayDoc = {
    storeId,
    operatingDate,
    ...ZERO_DAY_METRICS,
    currency: "GHS",
    status: "reconciled" as const,
    foldVersion: REPORTS_FOLD_VERSION,
    certifiedFoldRevision: revision,
    factCount: 1,
    lastFactRecordedAt: 1,
    flags: {
      mixedCurrency: false,
      hasUncostedRevenue: false,
      quarantinedFactCount: 0,
    },
  };
  if (existing) await ctx.db.patch("reportDay", existing._id, dayDoc);
  else await ctx.db.insert("reportDay", dayDoc);
}

type SyntheticLifecycleConfig =
  RangeSnapshotKindConfig<ReportMovementLifecycle>;

/**
 * A second kind as pure configuration on the generic seams: no ranking
 * phase, no child table, its own constants and (kind-scoped) admission
 * budgets. `aggregateSourceDay` is a spy so tests can observe exactly which
 * admitted days the generic machinery hands to the kind.
 */
function syntheticKind(
  overrides: {
    constants?: Partial<SyntheticLifecycleConfig["constants"]>;
    aggregateSourceDay?: SyntheticLifecycleConfig["aggregateSourceDay"];
  } = {},
): SyntheticLifecycleConfig & {
  aggregateSourceDay: ReturnType<typeof vi.fn>;
} {
  const aggregateSourceDay =
    overrides.aggregateSourceDay ?? vi.fn().mockResolvedValue("ok");
  return {
    kind: "custom_summary",
    contractVersion: 1,
    maxRangeDays: 31,
    hasRankingPhase: false,
    // A real registered action path (the generic scheduler needs one); the
    // movement worker no-ops against a foreign-kind row, and frozen timers
    // park the continuation anyway.
    workerRef: MOVEMENT_RANGE_SNAPSHOT_KIND.workerRef,
    admissionKeyScope: "custom_summary",
    constants: {
      stallRecoveryMs: 10 * 60_000,
      maxAttempts: 2,
      retryBaseMs: 1_000,
      retryMaxMs: 4_000,
      waitingRetryMs: 15_000,
      backpressureRetryMs: 10_000,
      retryJitterMs: 5_000,
      resetChildBatch: 500,
      cleanupChildBatch: 100,
      admissionWindowMs: 10 * 60_000,
      admissionsPerPrincipal: 4,
      admissionsPerStore: 8,
      admissionsGlobal: 20,
      ...(overrides.constants ?? {}),
    },
    errorCodes: {
      workerFailed: "synthetic_worker_failed",
      sourceStale: "synthetic_source_stale",
    },
    validateRange: () => {},
    computeRequestKey: (args) =>
      `synthetic:${args.storeId}:${args.startDate}:${args.endDate}:` +
      args.revisionVector
        .map((entry) => `${entry.operatingDate}=${entry.revision}`)
        .join(","),
    deriveLifecycle: deriveMovementRequestLifecycle,
    children: {
      deleteStaleBatch: async () => 0,
      hasAny: async () => false,
      deleteExpiredBatch: async () => 0,
    },
    aggregateSourceDay,
  } as SyntheticLifecycleConfig & {
    aggregateSourceDay: ReturnType<typeof vi.fn>;
  };
}

async function ensureSynthetic(
  t: Harness,
  config: SyntheticLifecycleConfig,
  args: {
    storeId: Id<"store">;
    startDate: string;
    endDate: string;
    principalKey?: string;
    now?: number;
  },
) {
  return t.run((ctx) =>
    ensureRangeSnapshotCore(ctx, config, {
      storeId: args.storeId,
      principalKey: args.principalKey ?? "principal-1",
      startDate: args.startDate,
      endDate: args.endDate,
      now: args.now,
    }),
  );
}

async function headerByKey(
  t: Harness,
  storeId: Id<"store">,
  requestKey: string,
): Promise<Doc<"reportRangeResult"> | null> {
  return t.run((ctx) =>
    (ctx as unknown as MutationCtx).db
      .query("reportRangeResult")
      .withIndex("by_storeId_requestKey", (q) =>
        q.eq("storeId", storeId).eq("requestKey", requestKey),
      )
      .unique(),
  );
}

/** Drive the generic fenced batch machine until the request settles,
 * recording every phase the machine passes through. */
async function drive(
  t: Harness,
  config: SyntheticLifecycleConfig,
  rangeResultId: Id<"reportRangeResult">,
  maxSteps = 50,
): Promise<{ row: Doc<"reportRangeResult">; phases: string[] }> {
  const phases: string[] = [];
  for (let steps = 0; ; steps += 1) {
    if (steps > maxSteps) throw new Error("state machine did not converge");
    const row = await t.run((ctx) =>
      ctx.db.get("reportRangeResult", rangeResultId),
    );
    if (!row) throw new Error("header vanished mid-drive");
    if (
      row.movementPhase === "completed" ||
      row.movementPhase === "terminal_error"
    ) {
      return { row, phases };
    }
    phases.push(row.movementPhase!);
    const intent = await t.run((ctx) =>
      runRangeSnapshotBatchCore(ctx, config, {
        rangeResultId,
        expectedPhase: row.movementPhase!,
        expectedFence: row.movementFence!,
      }),
    );
    if (intent.next === "stale") throw new Error("unexpected stale batch");
  }
}

// ---------------------------------------------------------------------------
// Budget isolation: kind-keyed admission budgets are independent at every
// scope (principal, store, global).
// ---------------------------------------------------------------------------

describe("admission budget isolation between kinds", () => {
  it("a second kind's admissions never consume movement's budget at any scope", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const now = Date.now();
    const synthetic = syntheticKind({
      // Tiny budgets so every scope saturates in one admission.
      constants: {
        admissionsPerPrincipal: 1,
        admissionsPerStore: 1,
        admissionsGlobal: 1,
      },
    });
    const consume = (
      config: SyntheticLifecycleConfig,
      principalKey = "principal-1",
    ) =>
      t.run((ctx) =>
        tryConsumeRangeSnapshotAdmission(ctx, config, {
          principalKey,
          storeKey: String(storeId),
          now,
        }),
      );

    // Saturate movement's per-principal budget.
    for (let index = 0; index < MOVEMENT_ADMISSIONS_PER_PRINCIPAL; index += 1) {
      expect(await consume(MOVEMENT_RANGE_SNAPSHOT_KIND)).toBe(true);
    }
    expect(await consume(MOVEMENT_RANGE_SNAPSHOT_KIND)).toBe(false);

    // The synthetic kind still admits for the same principal and store —
    // and its single admission saturates ITS principal, store, and global
    // budgets at once.
    expect(await consume(synthetic)).toBe(true);
    expect(await consume(synthetic)).toBe(false);
    // Global saturation, not just principal: a different principal is still
    // refused within the synthetic kind...
    expect(await consume(synthetic, "principal-2")).toBe(false);
    // ...while movement's global budget (20) is untouched by any of it: a
    // fresh movement principal admits immediately.
    expect(await consume(MOVEMENT_RANGE_SNAPSHOT_KIND, "principal-2")).toBe(
      true,
    );

    // The isolation mechanism on disk: movement's grandfathered raw keys
    // beside the second kind's kind-scoped keys, in the same table.
    const buckets = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture read
      ctx.db.query("reportMovementAdmission").collect(),
    );
    const keysByScope = new Map<string, string[]>();
    for (const bucket of buckets) {
      keysByScope.set(bucket.scope, [
        ...(keysByScope.get(bucket.scope) ?? []),
        bucket.key,
      ]);
    }
    expect(keysByScope.get("principal")).toEqual(
      expect.arrayContaining([
        "principal-1",
        "custom_summary:principal-1",
      ]),
    );
    expect(keysByScope.get("store")).toEqual(
      expect.arrayContaining([
        String(storeId),
        `custom_summary:${String(storeId)}`,
      ]),
    );
    expect(keysByScope.get("global")).toEqual(
      expect.arrayContaining(["global", "custom_summary:global"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Phase-set flexibility: a configured kind without a ranking phase
// transitions aggregating → completed, publication recheck included.
// ---------------------------------------------------------------------------

describe("phase-set flexibility", () => {
  it("a kind without a ranking phase completes aggregating → completed, never entering ranking", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    await t.run(async (ctx) => {
      await certifyDay(ctx, storeId, "2026-07-01", 3);
      await certifyDay(ctx, storeId, "2026-07-02", 5);
    });
    const synthetic = syntheticKind();

    const result = await ensureSynthetic(t, synthetic, {
      storeId,
      startDate: "2026-07-01",
      endDate: "2026-07-03", // third day has no reportDay: the empty sentinel
    });
    expect(result.lifecycle.state).toBe("queued_pending");
    const header = (await headerByKey(t, storeId, result.requestKey!))!;
    expect(header.kind).toBe("custom_summary");
    expect(header.movementPhase).toBe("queued");
    expect(header.movementFence).toBe(1);

    const { row, phases } = await drive(t, synthetic, header._id);

    // queued reset, then one batch per admitted day — and no ranking, ever.
    expect(phases).toEqual([
      "queued",
      "aggregating",
      "aggregating",
      "aggregating",
    ]);
    expect(row.movementPhase).toBe("completed");
    expect(row.status).toBe("completed");
    expect(row.computedAt).toBeDefined();
    expect(row.movementSourceDayCursor).toBeUndefined();
    expect(row.movementEligibleAt).toBeUndefined();
    // Every committed batch advanced the fence exactly once.
    expect(row.movementFence).toBe(1 + phases.length);

    // The kind's aggregator saw exactly the two certified days (the empty
    // day is skipped generically) with the admitted revisions.
    expect(synthetic.aggregateSourceDay).toHaveBeenCalledTimes(2);
    expect(
      synthetic.aggregateSourceDay.mock.calls.map((call) => call[2]),
    ).toEqual([
      { operatingDate: "2026-07-01", revision: 3 },
      { operatingDate: "2026-07-02", revision: 5 },
    ]);
  });

  it("the no-ranking publication recheck refuses a vector that moved after aggregation", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    await t.run(async (ctx) => {
      await certifyDay(ctx, storeId, "2026-07-01", 1);
      await certifyDay(ctx, storeId, "2026-07-02", 1);
    });
    const synthetic = syntheticKind();

    const result = await ensureSynthetic(t, synthetic, {
      storeId,
      startDate: "2026-07-01",
      endDate: "2026-07-02",
    });
    const header = (await headerByKey(t, storeId, result.requestKey!))!;

    // Drive through the reset and the first day.
    for (const expectedPhase of ["queued", "aggregating"] as const) {
      const row = (await t.run((ctx) =>
        ctx.db.get("reportRangeResult", header._id),
      ))!;
      expect(row.movementPhase).toBe(expectedPhase);
      await t.run((ctx) =>
        runRangeSnapshotBatchCore(ctx, synthetic, {
          rangeResultId: header._id,
          expectedPhase,
          expectedFence: row.movementFence!,
        }),
      );
    }

    // The already-aggregated day refolds under a new revision. The final
    // batch's day gate only checks the CURRENT day, so publication must be
    // refused by the full-vector recheck.
    await t.run((ctx) => certifyDay(ctx, storeId, "2026-07-01", 2));

    const row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    const intent = await t.run((ctx) =>
      runRangeSnapshotBatchCore(ctx, synthetic, {
        rangeResultId: header._id,
        expectedPhase: "aggregating",
        expectedFence: row.movementFence!,
      }),
    );
    expect(intent).toEqual({ next: "done" });

    const terminal = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(terminal.movementPhase).toBe("terminal_error");
    expect(terminal.status).toBe("failed");
    expect(terminal.movementErrorCode).toBe("synthetic_source_stale");
    expect(terminal.movementCorrelationId).toBeDefined();
    expect(terminal.movementTotals).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fence generality: fencing, retry, and the failure lane behave identically
// for a kind that is pure configuration.
// ---------------------------------------------------------------------------

describe("fence generality", () => {
  it("a spent fence and a foreign-kind worker are both no-ops", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const synthetic = syntheticKind();

    const result = await ensureSynthetic(t, synthetic, {
      storeId,
      startDate: "2026-07-01",
      endDate: "2026-07-01",
    });
    const header = (await headerByKey(t, storeId, result.requestKey!))!;

    // Commit the queued batch (fence 1 → 2)...
    const first = await t.run((ctx) =>
      runRangeSnapshotBatchCore(ctx, synthetic, {
        rangeResultId: header._id,
        expectedPhase: "queued",
        expectedFence: 1,
      }),
    );
    expect(first).toEqual({ next: "continue", phase: "aggregating", fence: 2 });

    // ...then replay the same expected {phase, fence}: a duplicate worker
    // carrying the spent fence observes the mismatch and no-ops.
    const replay = await t.run((ctx) =>
      runRangeSnapshotBatchCore(ctx, synthetic, {
        rangeResultId: header._id,
        expectedPhase: "queued",
        expectedFence: 1,
      }),
    );
    expect(replay).toEqual({ next: "stale" });

    // A worker configured for a DIFFERENT kind can never act on this row,
    // even with the correct phase and fence.
    const foreign = await t.run((ctx) =>
      runRangeSnapshotBatchCore(ctx, MOVEMENT_RANGE_SNAPSHOT_KIND, {
        rangeResultId: header._id,
        expectedPhase: "aggregating",
        expectedFence: 2,
      }),
    );
    expect(foreign).toEqual({ next: "stale" });

    const row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(row.movementPhase).toBe("aggregating");
    expect(row.movementFence).toBe(2);
  });

  it("the failure lane records kind-generic retry backoff, resumes, and caps to the kind's terminal code", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const synthetic = syntheticKind(); // maxAttempts 2, base 1s, cap 4s
    const now = Date.now();

    const result = await ensureSynthetic(t, synthetic, {
      storeId,
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      now,
    });
    const header = (await headerByKey(t, storeId, result.requestKey!))!;

    // First failure: retry_wait with the configured backoff, fence advanced.
    const firstFailure = await t.run((ctx) =>
      recordRangeSnapshotWorkerFailureCore(ctx, synthetic, {
        rangeResultId: header._id,
        expectedFence: 1,
        now,
      }),
    );
    expect(firstFailure).toEqual({ recorded: true });
    let row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(row.movementPhase).toBe("retry_wait");
    expect(row.movementAttempt).toBe(1);
    expect(row.movementEligibleAt).toBe(now + 1_000);

    // The retry_wait resume lane re-enters aggregation at the cursor.
    const resume = await t.run((ctx) =>
      runRangeSnapshotBatchCore(ctx, synthetic, {
        rangeResultId: header._id,
        expectedPhase: "retry_wait",
        expectedFence: row.movementFence!,
        now,
      }),
    );
    expect(resume).toMatchObject({ next: "continue", phase: "aggregating" });

    // A failure reported under a superseded fence is ignored.
    const stale = await t.run((ctx) =>
      recordRangeSnapshotWorkerFailureCore(ctx, synthetic, {
        rangeResultId: header._id,
        expectedFence: 1,
        now,
      }),
    );
    expect(stale).toEqual({ recorded: false });

    // The capped attempt goes terminal under the KIND'S sanitized code.
    row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    const secondFailure = await t.run((ctx) =>
      recordRangeSnapshotWorkerFailureCore(ctx, synthetic, {
        rangeResultId: header._id,
        expectedFence: row.movementFence!,
        now,
      }),
    );
    expect(secondFailure.recorded).toBe(true);
    expect(secondFailure.correlationId).toBeDefined();
    row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(row.movementPhase).toBe("terminal_error");
    expect(row.status).toBe("failed");
    expect(row.movementErrorCode).toBe("synthetic_worker_failed");
  });
});

// ---------------------------------------------------------------------------
// Dispatch exhaustiveness: an unknown or unregistered kind cannot reach the
// legacy custom-summary compute/expiry path, the backstop, or cleanup.
// ---------------------------------------------------------------------------

describe("dispatch exhaustiveness", () => {
  async function insertKindedHeader(
    t: Harness,
    storeId: Id<"store">,
    overrides: Partial<Doc<"reportRangeResult">> = {},
  ) {
    return t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey: `synthetic:${Math.random().toString(16).slice(2)}`,
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        status: "pending",
        kind: "custom_summary",
        movementPhase: "aggregating",
        movementContractVersion: 1,
        movementRevisionVector: [
          { operatingDate: "2026-07-01", revision: "empty" as const },
        ],
        movementAttempt: 0,
        movementFence: 1,
        movementSourceDayCursor: "2026-07-01",
        requestedAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000,
        foldVersion: REPORTS_FOLD_VERSION,
        ...overrides,
      }),
    );
  }

  it("the backstop clears eligibility for a kinded row with no registered config and schedules nothing", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const unregisteredId = await insertKindedHeader(t, storeId, {
      movementEligibleAt: Date.now() - 1_000,
    });

    const scheduled = await t.run((ctx) =>
      scheduleEligibleRangeSnapshotWork(ctx, Date.now(), [
        MOVEMENT_RANGE_SNAPSHOT_KIND,
      ]),
    );
    expect(scheduled).toBe(0);

    const row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", unregisteredId),
    ))!;
    // Out of the eligible index, but otherwise untouched: no lifecycle owns
    // it, so nothing may act on it.
    expect(row.movementEligibleAt).toBeUndefined();
    expect(row.movementPhase).toBe("aggregating");
    expect(row.status).toBe("pending");
  });

  it("cleanup leaves an expired kinded header with no registered config alone", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const expiredId = await insertKindedHeader(t, storeId, {
      movementEligibleAt: undefined,
      expiresAt: Date.now() - 1_000,
    });

    const result = await t.run((ctx) =>
      cleanupExpiredRangeSnapshots(ctx, Date.now(), [
        MOVEMENT_RANGE_SNAPSHOT_KIND,
      ]),
    );
    expect(result.headersDeleted).toBe(0);
    expect(result.headersCleaning).toBe(0);
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", expiredId)),
    ).not.toBeNull();
  });

  it("summary cleanup owns legacy and custom-summary headers but not movement or mix", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const legacyId = await t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey: "range:legacy-expired",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        status: "completed",
        requestedAt: Date.now() - 10_000,
        expiresAt: Date.now() - 1_000,
        foldVersion: REPORTS_FOLD_VERSION,
      }),
    );
    const kindedId = await insertKindedHeader(t, storeId, {
      movementEligibleAt: undefined,
      expiresAt: Date.now() - 1_000,
    });

    const result = await t.run((ctx) => sweepWithCtx(ctx));
    expect(result.rangesExpired).toBe(2);

    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", legacyId)),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", kindedId)),
    ).toBeNull();
  });

  it("the legacy summary compute path is a no-op for ANY kinded request", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const kindedId = await insertKindedHeader(t, storeId);

    await t.run(async (ctx) => {
      const request = (await ctx.db.get("reportRangeResult", kindedId))!;
      await computeRange(ctx, request);
    });

    const row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", kindedId),
    ))!;
    // Untouched: still pending, no summary fields, lifecycle state intact.
    expect(row.status).toBe("pending");
    expect(row.totals).toBeUndefined();
    expect(row.topSkus).toBeUndefined();
    expect(row.computedAt).toBeUndefined();
    expect(row.movementPhase).toBe("aggregating");
  });
});
