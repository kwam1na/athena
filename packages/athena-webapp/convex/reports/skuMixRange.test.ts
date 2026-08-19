/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Failure-injection seam for the atomic batch mutation: the mix sort-key
 * helper runs once per accumulated (non-zero) source row, so tripping it
 * mid-day proves the batch rolls back child writes, header totals, cursor,
 * and fence TOGETHER while the separate failure mutation still records retry
 * metadata.
 */
const sortKeyControl = vi.hoisted(() => ({
  callCount: 0,
  failAfterCalls: Infinity,
}));

vi.mock("../../shared/reportsContract", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../shared/reportsContract")>();
  return {
    ...actual,
    mixUnitsSoldSortKey: (unitsSold: number) => {
      sortKeyControl.callCount += 1;
      if (sortKeyControl.callCount > sortKeyControl.failAfterCalls) {
        throw new Error("SECRET_INTERNAL_DETAIL: injected batch defect");
      }
      return actual.mixUnitsSoldSortKey(unitsSold);
    },
  };
});

vi.mock("./access", () => ({ requireReportsStoreAccess: vi.fn() }));
import { requireReportsStoreAccess } from "./access";
const actualAccess =
  await vi.importActual<typeof import("./access")>("./access");

/**
 * The admission rail's identity port. convex-test has no auth provider, so
 * without a stub every exported handler is an anonymous denial and these
 * suites would test admission rather than the fenced state machine. The rail's
 * behaviour on these five functions is covered end to end, with real
 * identities and a real demo principal, in `reportsAdmission.test.ts`.
 */
vi.mock("../lib/athenaUserAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/athenaUserAuth")>()),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
}));
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";

import {
  REPORTS_FOLD_VERSION,
  REPORT_MIX_RANGE_MAX_DAYS,
  REPORT_MIX_REQUEST_KEY_PREFIX,
  REPORT_MIX_VISIBLE_ROW_LIMIT,
  REPORT_MOVEMENT_REQUEST_KEY_PREFIX,
  REPORT_RANGE_MAX_DAYS_BY_KIND,
  REPORT_RANGE_TTL_MS,
  admissibleMovementDayRevision,
  mixUnitsSoldSortKey,
} from "../../shared/reportsContract";
import {
  isSharedDemoCapabilityAllowed,
} from "../platform/capabilityCatalog";
import {
  ensureMixRangeOperationDefinition,
  retryMixRangeOperationDefinition,
} from "../operationAdmission/domains/reports_definitions";
import { REPORTS_SWEEP_STORE_ALLOWLIST_ENV } from "./sweeper";
import { cleanupExpiredRangeSnapshots } from "./rangeSnapshotLifecycle";
import { listRangeSkuMix } from "./queries";
import {
  ensureMovementRangeCore,
  MOVEMENT_RANGE_SNAPSHOT_KIND,
} from "./skuMovementRange";
import {
  MIX_ADMISSIONS_PER_PRINCIPAL,
  MIX_ADMISSIONS_PER_STORE,
  MIX_ADMISSIONS_GLOBAL,
  MIX_ADMISSION_WINDOW_MS,
  MIX_BACKPRESSURE_RETRY_MS,
  MIX_CLEANUP_CHILD_BATCH,
  MIX_ERROR_CODE_SOURCE_STALE,
  MIX_ERROR_CODE_WORKER_FAILED,
  MIX_MAX_ATTEMPTS,
  MIX_RANGE_SNAPSHOT_KIND,
  MIX_RETRY_BASE_MS,
  MIX_RETRY_JITTER_MS,
  MIX_RETRY_MAX_MS,
  MIX_STEADY_STATE_CHILDREN_PER_REQUEST,
  MIX_STEADY_STATE_REQUESTS_PER_DAY,
  MIX_WAITING_RETRY_MS,
  REPORTS_SWEEP_INTERVAL_MS,
  ensureMixRange,
  ensureMixRangeCore,
  getMixRange,
  getMixRangeVisible,
  mixRetryBackoffMs,
  recordMixWorkerFailureCore,
  retryTerminalMixRequest,
  runMixBatchCore,
} from "./skuMixRange";

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

function isoDateOffset(startDate: string, offset: number): string {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const WORKER_REF = makeFunctionReference<"action">(
  "reports/skuMixRange:runMixWorker",
);

function handlerOf(fn: unknown): (...args: any[]) => Promise<any> {
  return (fn as unknown as { _handler: (...args: any[]) => Promise<any> })
    ._handler;
}

function allow(...storeIds: Id<"store">[]) {
  process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV] = storeIds.join(",");
}

beforeEach(() => {
  // Admission and retry both schedule real internal actions through the
  // convex-test scheduler; frozen timers keep those continuations parked so
  // each test drives the fenced state machine deterministically itself.
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
  vi.clearAllMocks();
  vi.mocked(requireReportsStoreAccess).mockResolvedValue({
    athenaUser: { _id: "principal-1" },
  } as never);
  vi.mocked(requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
    _id: "principal-1" as Id<"athenaUser">,
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
  sortKeyControl.callCount = 0;
  sortKeyControl.failAfterCalls = Infinity;
  delete process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV];
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedStore(t: Harness, slug = "mix") {
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

/** One product with many SKUs — identity hydration needs real catalog docs. */
async function seedSkus(
  t: Harness,
  storeId: Id<"store">,
  count: number,
  slug = "mix",
): Promise<Id<"productSku">[]> {
  return t.run(async (ctx) => {
    const store = (await ctx.db.get("store", storeId))!;
    const categoryId = await ctx.db.insert("category", {
      name: `Cat ${slug}`,
      slug: `cat-${slug}`,
      storeId,
    });
    const subcategoryId = await ctx.db.insert("subcategory", {
      categoryId,
      name: `Sub ${slug}`,
      slug: `sub-${slug}`,
      storeId,
    });
    const productId = await ctx.db.insert("product", {
      availability: "live" as const,
      categoryId,
      createdByUserId: store.createdByUserId,
      currency: "GHS",
      inventoryCount: 10,
      name: `Product ${slug}`,
      organizationId: store.organizationId,
      slug: `product-${slug}`,
      storeId,
      subcategoryId,
    });
    const skuIds: Id<"productSku">[] = [];
    for (let index = 0; index < count; index += 1) {
      skuIds.push(
        await ctx.db.insert("productSku", {
          images: [],
          inventoryCount: 10,
          price: 1000,
          productId,
          quantityAvailable: 10,
          storeId,
        }),
      );
    }
    return skuIds;
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

const ZERO_SKU_DAY_METRICS = {
  grossSalesMinor: 0,
  netSalesMinor: 0,
  refundsMinor: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 0 as number | null,
};

type SkuMixSpec = {
  productSkuId: Id<"productSku">;
  unitsSold: number;
  unitsReturned?: number;
};

/** Write one certified (day, SKU rows) generation, revisions stamped alike. */
async function certifyDay(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  revision: number,
  skuRows: SkuMixSpec[],
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

  for (const row of skuRows) {
    await ctx.db.insert("reportSkuDay", {
      storeId,
      productSkuId: row.productSkuId,
      operatingDate,
      unitsSold: row.unitsSold,
      unitsReturned: row.unitsReturned ?? 0,
      ...ZERO_SKU_DAY_METRICS,
      certifiedFoldRevision: revision,
    });
  }
}

async function ensure(
  t: Harness,
  args: {
    storeId: Id<"store">;
    startDate: string;
    endDate: string;
    principalKey?: string;
    now?: number;
  },
) {
  return t.run((ctx) =>
    ensureMixRangeCore(ctx, {
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

/** Drive the fenced batch machine until the request settles. */
async function drive(
  t: Harness,
  rangeResultId: Id<"reportRangeResult">,
  maxSteps = 400,
): Promise<{ row: Doc<"reportRangeResult">; steps: number }> {
  let steps = 0;
  for (;;) {
    const row = await t.run((ctx) =>
      ctx.db.get("reportRangeResult", rangeResultId),
    );
    if (!row) throw new Error("header vanished mid-drive");
    if (
      row.movementPhase === "completed" ||
      row.movementPhase === "terminal_error"
    ) {
      return { row, steps };
    }
    const intent = await t.run((ctx) =>
      runMixBatchCore(ctx, {
        rangeResultId,
        expectedPhase: row.movementPhase!,
        expectedFence: row.movementFence!,
      }),
    );
    if (intent.next === "stale") throw new Error("unexpected stale batch");
    steps += 1;
    if (steps > maxSteps) throw new Error("state machine did not converge");
  }
}

async function admitOne(
  t: Harness,
  storeId: Id<"store">,
  startDate: string,
  endDate: string,
) {
  const result = await ensure(t, { storeId, startDate, endDate });
  expect(result.lifecycle.state).toBe("queued_pending");
  const header = await headerByKey(t, storeId, result.requestKey!);
  return { requestKey: result.requestKey!, header: header! };
}

async function mixChildren(
  t: Harness,
  storeId: Id<"store">,
  rangeResultId: Id<"reportRangeResult">,
  limit = 200,
): Promise<Doc<"reportRangeMixSku">[]> {
  return t.run((ctx) =>
    (ctx as unknown as MutationCtx).db
      .query("reportRangeMixSku")
      .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
        q.eq("storeId", storeId).eq("rangeResultId", rangeResultId),
      )
      .take(limit),
  );
}

async function visible(t: Harness, storeId: Id<"store">, requestKey: string) {
  return t.run((ctx) =>
    handlerOf(getMixRangeVisible)(ctx, { storeId, requestKey }),
  );
}

// ---------------------------------------------------------------------------
// The no-bump premise (opened first, per the plan): mix source admissibility
// needs nothing beyond `certifiedFoldRevision` + the current fold version —
// the exact helpers movement already uses. If any of these assertions fails,
// the rollout gains a repair drain and the unit must stop and re-plan.
// ---------------------------------------------------------------------------

describe("provenance precondition (the no-bump premise)", () => {
  it("the shared admissibility helper is sufficient: certified admits, uncertified and stale-fold do not", () => {
    // Certified at the current fold version: admissible with its revision.
    expect(
      admissibleMovementDayRevision("2026-07-01", {
        foldVersion: REPORTS_FOLD_VERSION,
        certifiedFoldRevision: 4,
      }),
    ).toEqual({ operatingDate: "2026-07-01", revision: 4 });
    // Absent day: the explicit empty sentinel (admissible: no activity).
    expect(admissibleMovementDayRevision("2026-07-01", null)).toEqual({
      operatingDate: "2026-07-01",
      revision: "empty",
    });
    // Uncertified or stale-fold: not admissible — repair pending.
    expect(
      admissibleMovementDayRevision("2026-07-01", {
        foldVersion: REPORTS_FOLD_VERSION,
      }),
    ).toBeNull();
    expect(
      admissibleMovementDayRevision("2026-07-01", {
        foldVersion: REPORTS_FOLD_VERSION - 1,
        certifiedFoldRevision: 4,
      }),
    ).toBeNull();
  });

  it("an uncertified day makes the request wait rather than admit", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    await t.run((ctx) =>
      ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-07-01",
        ...ZERO_DAY_METRICS,
        currency: "GHS",
        status: "reconciled" as const,
        // Pre-certification generation: current fold version, no revision.
        foldVersion: REPORTS_FOLD_VERSION,
        factCount: 1,
        lastFactRecordedAt: 1,
        flags: {
          mixedCurrency: false,
          hasUncostedRevenue: false,
          quarantinedFactCount: 0,
        },
      }),
    );
    const result = await ensure(t, {
      storeId,
      startDate: "2026-07-01",
      endDate: "2026-07-02",
    });
    expect(result.requestKey).toBeNull();
    expect(result.lifecycle.state).toBe("waiting");
    const retryAfterMs =
      result.lifecycle.state === "waiting" ? result.lifecycle.retryAfterMs : 0;
    expect(retryAfterMs).toBeGreaterThanOrEqual(MIX_WAITING_RETRY_MS);
    expect(retryAfterMs).toBeLessThan(
      MIX_WAITING_RETRY_MS + MIX_RETRY_JITTER_MS,
    );
    const rows = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture read
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  it("a stale-fold-version day also waits, then admits once re-certified", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    await t.run((ctx) =>
      ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-07-01",
        ...ZERO_DAY_METRICS,
        currency: "GHS",
        status: "reconciled" as const,
        foldVersion: REPORTS_FOLD_VERSION - 1,
        certifiedFoldRevision: 1,
        factCount: 1,
        lastFactRecordedAt: 1,
        flags: {
          mixedCurrency: false,
          hasUncostedRevenue: false,
          quarantinedFactCount: 0,
        },
      }),
    );
    const stale = await ensure(t, {
      storeId,
      startDate: "2026-07-01",
      endDate: "2026-07-01",
    });
    expect(stale.lifecycle.state).toBe("waiting");

    await t.run(async (ctx) => {
      const day = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-01"),
        )
        .unique();
      await ctx.db.patch("reportDay", day!._id, {
        foldVersion: REPORTS_FOLD_VERSION,
      });
    });
    const certified = await ensure(t, {
      storeId,
      startDate: "2026-07-01",
      endDate: "2026-07-01",
    });
    expect(certified.lifecycle.state).toBe("queued_pending");
  });

  it("a dirty mark on any included day waits without writing", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    await t.run(async (ctx) => {
      await certifyDay(ctx, storeId, "2026-07-01", 1, []);
      await ctx.db.insert("reportDirtyDay", {
        storeId,
        operatingDate: "2026-07-01",
        reason: "late_fact",
        markedAt: Date.now(),
      });
    });
    const result = await ensure(t, {
      storeId,
      startDate: "2026-07-01",
      endDate: "2026-07-02",
    });
    expect(result.lifecycle.state).toBe("waiting");
    const rows = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture read
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Enablement, validation, and the empty range
// ---------------------------------------------------------------------------

describe("ensure gates", () => {
  it("returns sanitized not_available for a non-allowlisted store, writing nothing", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const result = await ensure(t, {
      storeId,
      startDate: "not-a-date",
      endDate: "also-not",
    });
    expect(result).toEqual({
      requestKey: null,
      lifecycle: { state: "not_available" },
    });
    const rows = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture read
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  it("rejects malformed dates and spans beyond the 184-day mix ceiling", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    expect(REPORT_RANGE_MAX_DAYS_BY_KIND.sku_mix).toBe(184);
    await expect(
      ensure(t, { storeId, startDate: "2026-02-30", endDate: "2026-03-01" }),
    ).rejects.toThrow(/Invalid startDate/);
    // 2026-01-01 .. 2026-07-04 inclusive is 185 days — one over the ceiling.
    await expect(
      ensure(t, { storeId, startDate: "2026-01-01", endDate: "2026-07-04" }),
    ).rejects.toThrow(/maximum is 184 days/);
  });

  it("admits a full 184-day range of empty days and completes with honest zero totals", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    // 2026-01-01 .. 2026-07-03 inclusive is exactly 184 days, all empty.
    const result = await ensure(t, {
      storeId,
      startDate: "2026-01-01",
      endDate: "2026-07-03",
    });
    expect(result.lifecycle.state).toBe("queued_pending");
    expect(result.requestKey!.startsWith(REPORT_MIX_REQUEST_KEY_PREFIX)).toBe(
      true,
    );
    const header = await headerByKey(t, storeId, result.requestKey!);
    expect(header!.movementRevisionVector).toHaveLength(
      REPORT_MIX_RANGE_MAX_DAYS,
    );

    const { row } = await drive(t, header!._id);
    expect(row.movementPhase).toBe("completed");
    expect(row.movementTotals).toEqual({
      unitsSold: 0,
      unitsReturned: 0,
      netUnits: 0,
      skuCount: 0,
    });

    const view = await visible(t, storeId, result.requestKey!);
    expect(view.lifecycle).toMatchObject({
      state: "completed",
      totals: { totalUnitsSold: 0, skuCount: 0 },
    });
    // Zero activity: no visible rows and NO Other bucket.
    expect(view.data).toEqual({ rows: [], totalUnitsSold: 0, skuCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// Admission windows — kind-scoped, independent of movement's budgets
// ---------------------------------------------------------------------------

describe("admission", () => {
  it("keeps ambient mix exploration within the loosened admission envelope", () => {
    expect(MIX_ADMISSIONS_PER_PRINCIPAL).toBe(24);
    expect(MIX_ADMISSIONS_PER_STORE).toBe(48);
    expect(MIX_ADMISSIONS_GLOBAL).toBe(120);
  });

  it("saturates per principal with retryable backpressure and zero writes", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const now = Date.now();

    for (let index = 0; index < MIX_ADMISSIONS_PER_PRINCIPAL; index += 1) {
      const date = `2026-01-${String(index + 1).padStart(2, "0")}`;
      const result = await ensure(t, {
        storeId,
        startDate: date,
        endDate: date,
        now,
      });
      expect(result.lifecycle.state).toBe("queued_pending");
    }

    const saturated = await ensure(t, {
      storeId,
      startDate: "2026-01-25",
      endDate: "2026-01-25",
      now,
    });
    expect(saturated.requestKey).toBeNull();
    expect(saturated.lifecycle.state).toBe("backpressure");
    const retryAfterMs =
      saturated.lifecycle.state === "backpressure"
        ? saturated.lifecycle.retryAfterMs
        : 0;
    expect(retryAfterMs).toBeGreaterThanOrEqual(MIX_BACKPRESSURE_RETRY_MS);
    expect(retryAfterMs).toBeLessThan(
      MIX_BACKPRESSURE_RETRY_MS + MIX_RETRY_JITTER_MS,
    );

    // A fresh window admits again.
    const later = await ensure(t, {
      storeId,
      startDate: "2026-01-25",
      endDate: "2026-01-25",
      now: now + MIX_ADMISSION_WINDOW_MS,
    });
    expect(later.lifecycle.state).toBe("queued_pending");
  });

  it("keys buckets under the sku_mix scope, leaving movement's budgets untouched", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const now = Date.now();

    // Saturate the mix principal budget entirely.
    for (let index = 0; index < MIX_ADMISSIONS_PER_PRINCIPAL; index += 1) {
      const date = `2026-02-${String(index + 1).padStart(2, "0")}`;
      await ensure(t, { storeId, startDate: date, endDate: date, now });
    }
    const saturated = await ensure(t, {
      storeId,
      startDate: "2026-02-25",
      endDate: "2026-02-25",
      now,
    });
    expect(saturated.lifecycle.state).toBe("backpressure");

    // The mix bucket is scoped; movement's raw-key bucket is untouched, so a
    // movement request over the very same dates still admits.
    const mixBucket = await t.run((ctx) =>
      ctx.db
        .query("reportMovementAdmission")
        .withIndex("by_scope_key", (q) =>
          q.eq("scope", "principal").eq("key", "sku_mix:principal-1"),
        )
        .unique(),
    );
    expect(mixBucket!.count).toBe(MIX_ADMISSIONS_PER_PRINCIPAL);

    const movement = await t.run((ctx) =>
      ensureMovementRangeCore(ctx, {
        storeId,
        principalKey: "principal-1",
        startDate: "2026-02-25",
        endDate: "2026-02-25",
        now,
      }),
    );
    expect(movement.lifecycle.state).toBe("queued_pending");
    expect(
      movement.requestKey!.startsWith(REPORT_MOVEMENT_REQUEST_KEY_PREFIX),
    ).toBe(true);
  });

  it("saturates per store across principals", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const now = Date.now();

    let admittedCount = 0;
    for (let principal = 0; principal < 3; principal += 1) {
      for (let index = 0; index < MIX_ADMISSIONS_PER_PRINCIPAL; index += 1) {
        const operatingDate = isoDateOffset(
          "2026-03-01",
          principal * MIX_ADMISSIONS_PER_PRINCIPAL + index,
        );
        const result = await ensure(t, {
          storeId,
          startDate: operatingDate,
          endDate: operatingDate,
          principalKey: `principal-${principal}`,
          now,
        });
        if (admittedCount < MIX_ADMISSIONS_PER_STORE) {
          expect(result.lifecycle.state).toBe("queued_pending");
          admittedCount += 1;
        } else {
          expect(result.lifecycle.state).toBe("backpressure");
        }
      }
    }
    expect(admittedCount).toBe(MIX_ADMISSIONS_PER_STORE);
  });

  it("duplicate ensures reuse one request without a second admission charge", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);

    const first = await ensure(t, {
      storeId,
      startDate: "2026-05-01",
      endDate: "2026-05-02",
    });
    const second = await ensure(t, {
      storeId,
      startDate: "2026-05-01",
      endDate: "2026-05-02",
    });
    expect(first.lifecycle.state).toBe("queued_pending");
    expect(second).toEqual({
      requestKey: first.requestKey,
      lifecycle: { state: "queued_pending" },
    });

    const headers = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture read
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(headers).toHaveLength(1);

    const bucket = await t.run((ctx) =>
      ctx.db
        .query("reportMovementAdmission")
        .withIndex("by_scope_key", (q) =>
          q.eq("scope", "principal").eq("key", "sku_mix:principal-1"),
        )
        .unique(),
    );
    expect(bucket!.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle at scale — the R6 guarantee the sync reader cannot make
// ---------------------------------------------------------------------------

describe("lifecycle at scale", () => {
  it(
    "completes a 184-day range over 5,520 SKU-day rows across bounded batches with exact totals",
    { timeout: 120_000 },
    async () => {
      const t = convexTest(schema, modules);
      const { storeId } = await seedStore(t);
      allow(storeId);
      const skuIds = await seedSkus(t, storeId, 30);

      // 184 inclusive days × 30 SKUs = 5,520 source rows — beyond the sync
      // reader's 5,000-row cap. sku0 sells zero every day (it must not count
      // toward skuCount); every other SKU sells `index` units per day.
      const dates: string[] = [];
      {
        const cursor = new Date(Date.UTC(2026, 0, 1));
        for (let day = 0; day < 184; day += 1) {
          dates.push(cursor.toISOString().slice(0, 10));
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
      expect(dates[0]).toBe("2026-01-01");
      expect(dates[183]).toBe("2026-07-03");
      for (let start = 0; start < dates.length; start += 8) {
        const chunk = dates.slice(start, start + 8);
        await t.run(async (ctx) => {
          for (const date of chunk) {
            await certifyDay(
              ctx,
              storeId,
              date,
              1,
              skuIds.map((productSkuId, index) => ({
                productSkuId,
                unitsSold: index,
              })),
            );
          }
        });
      }

      const { requestKey, header } = await admitOne(
        t,
        storeId,
        "2026-01-01",
        "2026-07-03",
      );
      const { row, steps } = await drive(t, header._id);

      // One bounded batch per day plus the reset pass.
      expect(steps).toBeGreaterThan(184);
      expect(row.movementPhase).toBe("completed");
      expect(row.status).toBe("completed");
      expect(row.movementEligibleAt).toBeUndefined();

      // Exact totals, derived independently: sku1..sku29 sell index×184.
      const expectedTotal = ((29 * 30) / 2) * 184;
      expect(row.movementTotals).toEqual({
        unitsSold: expectedTotal,
        unitsReturned: 0,
        netUnits: expectedTotal,
        skuCount: 29,
      });

      // No truncation: every selling SKU has exactly one child row, none has
      // any rank field, and the zero-seller wrote no child at all.
      const children = await mixChildren(t, storeId, header._id);
      expect(children).toHaveLength(29);
      expect(children.every((child) => !("rank" in child))).toBe(true);
      expect(
        children.find((child) => child.productSkuId === skuIds[0]),
      ).toBeUndefined();
      for (const child of children) {
        const index = skuIds.indexOf(child.productSkuId);
        expect(child.unitsSold).toBe(index * 184);
        expect(child.unitsSoldSortKey).toBe(-index * 184);
      }

      // Top 5 + Other through the sort-key index, shares in basis points.
      const view = await visible(t, storeId, requestKey);
      expect(view.data.totalUnitsSold).toBe(expectedTotal);
      expect(view.data.skuCount).toBe(29);
      expect(view.data.rows).toHaveLength(REPORT_MIX_VISIBLE_ROW_LIMIT + 1);
      expect(
        view.data.rows
          .slice(0, REPORT_MIX_VISIBLE_ROW_LIMIT)
          .map((r: { productSkuId: string }) => r.productSkuId),
      ).toEqual([29, 28, 27, 26, 25].map((index) => String(skuIds[index])));
      const other = view.data.rows[REPORT_MIX_VISIBLE_ROW_LIMIT]!;
      const visibleUnits = (29 + 28 + 27 + 26 + 25) * 184;
      expect(other).toEqual({
        key: "other",
        label: "Other SKUs",
        unitsSold: expectedTotal - visibleUnits,
        shareBasisPoints: Math.round(
          ((expectedTotal - visibleUnits) / expectedTotal) * 10_000,
        ),
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Presentation parity with the synchronous reader
// ---------------------------------------------------------------------------

describe("presentation parity", () => {
  it("matches listRangeSkuMix exactly on a range both paths can serve", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const skuIds = await seedSkus(t, storeId, 8);

    // Two certified days. sku7 never sells (returns only); sku6 sells on day
    // one but records an explicit zero row on day two — it must still count.
    const dayOne: SkuMixSpec[] = skuIds.map((productSkuId, index) => ({
      productSkuId,
      unitsSold: index === 7 ? 0 : (index + 1) * 3,
      unitsReturned: index === 7 ? 2 : 0,
    }));
    const dayTwo: SkuMixSpec[] = skuIds.map((productSkuId, index) => ({
      productSkuId,
      unitsSold: index === 7 || index === 6 ? 0 : index + 1,
    }));
    await t.run(async (ctx) => {
      await certifyDay(ctx, storeId, "2026-07-01", 1, dayOne);
      await certifyDay(ctx, storeId, "2026-07-02", 1, dayTwo);
    });

    const { requestKey, header } = await admitOne(
      t,
      storeId,
      "2026-07-01",
      "2026-07-02",
    );
    await drive(t, header._id);

    const sync = await t.run((ctx) =>
      handlerOf(listRangeSkuMix)(ctx, {
        storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    );
    const view = await visible(t, storeId, requestKey);
    // Visible rows, share basis points, Other bucket, total, and SKU count —
    // the exact contract, row for row.
    expect(view.data).toEqual(sync);
    expect(sync.skuCount).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Other-bucket edges and the no-rank deterministic reader
// ---------------------------------------------------------------------------

describe("other bucket and top-5 determinism", () => {
  async function completedMix(
    t: Harness,
    storeId: Id<"store">,
    specs: SkuMixSpec[],
  ) {
    await t.run((ctx) => certifyDay(ctx, storeId, "2026-07-01", 1, specs));
    const { requestKey, header } = await admitOne(
      t,
      storeId,
      "2026-07-01",
      "2026-07-01",
    );
    await drive(t, header._id);
    return { requestKey, header };
  }

  it("omits Other when five or fewer SKUs sold — including exactly five", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const skuIds = await seedSkus(t, storeId, 5);
    const { requestKey } = await completedMix(
      t,
      storeId,
      skuIds.map((productSkuId, index) => ({
        productSkuId,
        unitsSold: (index + 1) * 10,
      })),
    );
    const view = await visible(t, storeId, requestKey);
    expect(view.data.rows).toHaveLength(5);
    expect(view.data.rows.some((r: { key: string }) => r.key === "other")).toBe(
      false,
    );
    expect(view.data.totalUnitsSold).toBe(150);
    expect(view.data.skuCount).toBe(5);
    // Shares still sum sensibly against the authoritative total.
    expect(view.data.rows[0]).toMatchObject({
      productSkuId: String(skuIds[4]),
      unitsSold: 50,
      shareBasisPoints: Math.round((50 / 150) * 10_000),
    });
  });

  it("computes a dominant Other bucket from header totals minus visible", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const skuIds = await seedSkus(t, storeId, 40);
    // Five leaders at 20 units; a 35-SKU tail of 10 units each dominates.
    const { requestKey } = await completedMix(
      t,
      storeId,
      skuIds.map((productSkuId, index) => ({
        productSkuId,
        unitsSold: index < 5 ? 20 : 10,
      })),
    );
    const view = await visible(t, storeId, requestKey);
    const total = 5 * 20 + 35 * 10;
    expect(view.data.totalUnitsSold).toBe(total);
    expect(view.data.skuCount).toBe(40);
    const other = view.data.rows.at(-1)!;
    expect(other).toEqual({
      key: "other",
      label: "Other SKUs",
      unitsSold: 350,
      shareBasisPoints: Math.round((350 / total) * 10_000),
    });
    // The Other bucket carries no SKU identity — no detail link target.
    expect("productSkuId" in other).toBe(false);
    expect("identity" in other).toBe(false);
  });

  it("selects a deterministic top 5 through the sort-key index with the SKU-id tie-break", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const skuIds = await seedSkus(t, storeId, 8);
    // Three SKUs tie at the visible boundary; identity breaks the tie.
    const { requestKey } = await completedMix(
      t,
      storeId,
      skuIds.map((productSkuId, index) => ({
        productSkuId,
        unitsSold: index < 3 ? 50 : index < 6 ? 30 : 5,
      })),
    );
    const view = await visible(t, storeId, requestKey);
    const tiedLeaders = skuIds.slice(0, 3).map(String).sort();
    const tiedBoundary = skuIds.slice(3, 6).map(String).sort();
    expect(
      view.data.rows
        .slice(0, 5)
        .map((r: { productSkuId: string }) => r.productSkuId),
    ).toEqual([...tiedLeaders, ...tiedBoundary.slice(0, 2)]);
    // Reading twice yields the identical selection — no rank was stored.
    const again = await visible(t, storeId, requestKey);
    expect(again.data).toEqual(view.data);
  });
});

// ---------------------------------------------------------------------------
// Freshness races, fencing, and publication
// ---------------------------------------------------------------------------

describe("races and fencing", () => {
  async function twoDayFixture(t: Harness) {
    const { storeId } = await seedStore(t);
    allow(storeId);
    const [skuId] = await seedSkus(t, storeId, 1);
    await t.run(async (ctx) => {
      await certifyDay(ctx, storeId, "2026-07-01", 1, [
        { productSkuId: skuId!, unitsSold: 2 },
      ]);
      await certifyDay(ctx, storeId, "2026-07-02", 1, [
        { productSkuId: skuId!, unitsSold: 3 },
      ]);
    });
    const admitted = await admitOne(t, storeId, "2026-07-01", "2026-07-02");
    return { storeId, skuId: skuId!, ...admitted };
  }

  async function step(t: Harness, id: Id<"reportRangeResult">) {
    const row = (await t.run((ctx) => ctx.db.get("reportRangeResult", id)))!;
    return t.run((ctx) =>
      runMixBatchCore(ctx, {
        rangeResultId: id,
        expectedPhase: row.movementPhase!,
        expectedFence: row.movementFence!,
      }),
    );
  }

  it("a day that changes revision after admission terminates as sanitized source-stale", async () => {
    const t = convexTest(schema, modules);
    const { storeId, header } = await twoDayFixture(t);

    await step(t, header._id); // queued → aggregating
    await step(t, header._id); // day 1 accumulated

    await t.run(async (ctx) => {
      const day = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-02"),
        )
        .unique();
      await ctx.db.patch("reportDay", day!._id, { certifiedFoldRevision: 2 });
    });

    const intent = await step(t, header._id);
    expect(intent).toEqual({ next: "done" });
    const row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(row.movementPhase).toBe("terminal_error");
    expect(row.movementErrorCode).toBe(MIX_ERROR_CODE_SOURCE_STALE);
    expect(row.movementCorrelationId).toBeDefined();
    expect(row.status).toBe("failed");
    // A terminal row carries no totals, partial or otherwise.
    expect(row.movementTotals).toBeUndefined();
  });

  it("the final-batch publication recheck refuses a vector that moved earlier in the range", async () => {
    const t = convexTest(schema, modules);
    const { storeId, header } = await twoDayFixture(t);
    await step(t, header._id); // reset
    await step(t, header._id); // day 1

    // Day 1 refolds AFTER its batch ran; day 2's own check passes, so only
    // the publication recheck (inside the final aggregation batch — mix has
    // no ranking finalization) can catch it.
    await t.run(async (ctx) => {
      const day = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-01"),
        )
        .unique();
      await ctx.db.patch("reportDay", day!._id, { certifiedFoldRevision: 5 });
    });

    await step(t, header._id); // final day → recheck fails
    const row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(row.movementPhase).toBe("terminal_error");
    expect(row.movementErrorCode).toBe(MIX_ERROR_CODE_SOURCE_STALE);
    expect(row.movementTotals).toBeUndefined();
    // The reader shows only the sanitized terminal lifecycle, no data.
    const view = await visible(t, storeId, header.requestKey);
    expect(view.lifecycle.state).toBe("terminal_error");
    expect(view.data).toBeNull();
  });

  it("a duplicate worker carrying a spent fence is a no-op and cannot double-count", async () => {
    const t = convexTest(schema, modules);
    const { header, storeId } = await twoDayFixture(t);

    await step(t, header._id); // queued → aggregating
    const before = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    const spentFence = before.movementFence!;

    const first = await t.run((ctx) =>
      runMixBatchCore(ctx, {
        rangeResultId: header._id,
        expectedPhase: "aggregating",
        expectedFence: spentFence,
      }),
    );
    expect(first.next).toBe("continue");
    const duplicate = await t.run((ctx) =>
      runMixBatchCore(ctx, {
        rangeResultId: header._id,
        expectedPhase: "aggregating",
        expectedFence: spentFence,
      }),
    );
    expect(duplicate).toEqual({ next: "stale" });

    const children = await mixChildren(t, storeId, header._id);
    expect(children).toHaveLength(1);
    expect(children[0]!.unitsSold).toBe(2); // day 1 exactly once
    const row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(row.movementTotals).toMatchObject({ unitsSold: 2, skuCount: 1 });
  });

  it("mix and movement snapshots over identical dates are distinct requests that do not interfere", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const [skuId] = await seedSkus(t, storeId, 1);
    await t.run((ctx) =>
      certifyDay(ctx, storeId, "2026-07-01", 1, [
        { productSkuId: skuId!, unitsSold: 4, unitsReturned: 1 },
      ]),
    );

    const mix = await admitOne(t, storeId, "2026-07-01", "2026-07-01");
    const movement = await t.run((ctx) =>
      ensureMovementRangeCore(ctx, {
        storeId,
        principalKey: "principal-1",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
      }),
    );
    expect(movement.requestKey).not.toBe(mix.requestKey);

    await drive(t, mix.header._id);
    const view = await visible(t, storeId, mix.requestKey);
    expect(view.data).toMatchObject({ totalUnitsSold: 4, skuCount: 1 });
    // Mix wrote only its own child table; movement's stayed empty.
    const movementChildren = await t.run((ctx) =>
      (ctx as unknown as MutationCtx).db
        .query("reportRangeMovementSku")
        .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
          q.eq("storeId", storeId),
        )
        .take(5),
    );
    expect(movementChildren).toHaveLength(0);
    // The movement request is still its own pending row.
    const movementHeader = await headerByKey(t, storeId, movement.requestKey!);
    expect(movementHeader!.kind).toBe("sku_movement");
    expect(movementHeader!.movementPhase).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// Rollback, retry metadata, and the separate failure transaction
// ---------------------------------------------------------------------------

describe("failure lane", () => {
  it("rolls the batch back whole — children, header totals, cursor, fence — then resumes exactly", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const skuIds = await seedSkus(t, storeId, 3);
    const rows = skuIds.map((productSkuId, index) => ({
      productSkuId,
      unitsSold: index + 1,
    }));
    await t.run(async (ctx) => {
      await certifyDay(ctx, storeId, "2026-07-01", 1, rows);
      await certifyDay(ctx, storeId, "2026-07-02", 1, rows);
    });
    const { header } = await admitOne(t, storeId, "2026-07-01", "2026-07-02");

    // reset + day 1.
    for (let i = 0; i < 2; i += 1) {
      const row = (await t.run((ctx) =>
        ctx.db.get("reportRangeResult", header._id),
      ))!;
      await t.run((ctx) =>
        runMixBatchCore(ctx, {
          rangeResultId: header._id,
          expectedPhase: row.movementPhase!,
          expectedFence: row.movementFence!,
        }),
      );
    }
    const beforeFailure = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(beforeFailure.movementSourceDayCursor).toBe("2026-07-02");
    expect(beforeFailure.movementTotals).toMatchObject({
      unitsSold: 6,
      skuCount: 3,
    });

    // Fail mid-day-2 — after at least one child upsert would have written.
    // Driving through t.mutation gives convex-test transaction semantics.
    const BATCH_REF = makeFunctionReference<"mutation">(
      "reports/skuMixRange:runMixBatch",
    );
    sortKeyControl.failAfterCalls = sortKeyControl.callCount + 1;
    await expect(
      (t.mutation as (ref: unknown, args: unknown) => Promise<unknown>)(
        BATCH_REF,
        {
          rangeResultId: header._id,
          expectedPhase: "aggregating",
          expectedFence: beforeFailure.movementFence!,
        },
      ),
    ).rejects.toThrow(/SECRET_INTERNAL_DETAIL/);
    sortKeyControl.failAfterCalls = Infinity;

    // Children, running totals, cursor, and fence rolled back together.
    const afterFailure = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(afterFailure.movementFence).toBe(beforeFailure.movementFence);
    expect(afterFailure.movementSourceDayCursor).toBe("2026-07-02");
    expect(afterFailure.movementTotals).toEqual(beforeFailure.movementTotals);
    const children = await mixChildren(t, storeId, header._id);
    expect(children.map((child) => child.unitsSold).sort()).toEqual([1, 2, 3]);

    // The SEPARATE failure transaction records backoff without touching work.
    const now = Date.now();
    const outcome = await t.run((ctx) =>
      recordMixWorkerFailureCore(ctx, {
        rangeResultId: header._id,
        expectedFence: beforeFailure.movementFence!,
        now,
      }),
    );
    expect(outcome.recorded).toBe(true);
    const retryRow = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(retryRow.movementPhase).toBe("retry_wait");
    expect(retryRow.movementAttempt).toBe(1);
    expect(retryRow.movementEligibleAt).toBe(now + MIX_RETRY_BASE_MS);

    // Resuming completes with each day counted exactly once.
    const { row } = await drive(t, header._id);
    expect(row.movementPhase).toBe("completed");
    expect(row.movementTotals).toEqual({
      unitsSold: 12,
      unitsReturned: 0,
      netUnits: 12,
      skuCount: 3,
    });
    // The injected internal text never reached any public header field.
    expect(JSON.stringify(row)).not.toContain("SECRET_INTERNAL_DETAIL");
  });

  it("the worker action catches an escaped defect and records sanitized terminal state at the attempt cap", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const [skuId] = await seedSkus(t, storeId, 1);
    await t.run((ctx) =>
      certifyDay(ctx, storeId, "2026-07-01", 1, [
        { productSkuId: skuId!, unitsSold: 1 },
      ]),
    );
    const { header } = await admitOne(t, storeId, "2026-07-01", "2026-07-01");
    await t.run((ctx) =>
      ctx.db.patch("reportRangeResult", header._id, {
        movementPhase: "aggregating",
        movementAttempt: MIX_MAX_ATTEMPTS - 1,
      }),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    sortKeyControl.failAfterCalls = sortKeyControl.callCount;
    await (t.action as (ref: unknown, args: unknown) => Promise<unknown>)(
      WORKER_REF,
      {
        rangeResultId: header._id,
        expectedPhase: "aggregating",
        expectedFence: header.movementFence!,
      },
    );
    sortKeyControl.failAfterCalls = Infinity;
    consoleError.mockRestore();

    const row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(row.movementPhase).toBe("terminal_error");
    expect(row.movementErrorCode).toBe(MIX_ERROR_CODE_WORKER_FAILED);
    expect(row.movementCorrelationId).toBeDefined();
    expect(row.movementEligibleAt).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("SECRET_INTERNAL_DETAIL");
  });

  it("backoff doubles per attempt and caps", () => {
    expect(mixRetryBackoffMs(1)).toBe(MIX_RETRY_BASE_MS);
    expect(mixRetryBackoffMs(2)).toBe(MIX_RETRY_BASE_MS * 2);
    expect(mixRetryBackoffMs(3)).toBe(MIX_RETRY_BASE_MS * 4);
    expect(mixRetryBackoffMs(50)).toBe(MIX_RETRY_MAX_MS);
  });

  it("ignores a failure report for a superseded fence", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const { header } = await admitOne(t, storeId, "2026-08-01", "2026-08-01");
    const outcome = await t.run((ctx) =>
      recordMixWorkerFailureCore(ctx, {
        rangeResultId: header._id,
        expectedFence: header.movementFence! + 7,
      }),
    );
    expect(outcome).toEqual({ recorded: false });
    const row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(row.movementPhase).toBe("queued");
    expect(row.movementAttempt).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Retry of a terminal request
// ---------------------------------------------------------------------------

describe("terminal retry", () => {
  it("resets the same identity under a new fence, clears stale children AND totals, and completes cleanly", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const [skuId] = await seedSkus(t, storeId, 1);
    await t.run(async (ctx) => {
      await certifyDay(ctx, storeId, "2026-07-01", 1, [
        { productSkuId: skuId!, unitsSold: 4 },
      ]);
      await certifyDay(ctx, storeId, "2026-07-02", 1, [
        { productSkuId: skuId!, unitsSold: 6 },
      ]);
    });
    const { requestKey, header } = await admitOne(
      t,
      storeId,
      "2026-07-01",
      "2026-07-02",
    );

    // Aggregate day one (children AND running totals now exist), then force
    // a worker-failed terminal so both must be discarded by the retry reset.
    for (let i = 0; i < 2; i += 1) {
      const row = (await t.run((ctx) =>
        ctx.db.get("reportRangeResult", header._id),
      ))!;
      await t.run((ctx) =>
        runMixBatchCore(ctx, {
          rangeResultId: header._id,
          expectedPhase: row.movementPhase!,
          expectedFence: row.movementFence!,
        }),
      );
    }
    await t.run(async (ctx) => {
      const row = (await ctx.db.get("reportRangeResult", header._id))!;
      expect(row.movementTotals).toMatchObject({ unitsSold: 4 });
      await ctx.db.patch("reportRangeResult", header._id, {
        status: "failed",
        movementPhase: "terminal_error",
        movementErrorCode: MIX_ERROR_CODE_WORKER_FAILED,
        movementCorrelationId: "test-correlation",
        movementFence: row.movementFence! + 1,
        movementEligibleAt: undefined,
      });
    });

    const retried = await t.run((ctx) =>
      retryTerminalMixRequest(ctx, {
        storeId,
        requestKey,
        principalKey: "principal-1",
      }),
    );
    expect(retried).toEqual({
      requestKey,
      lifecycle: { state: "queued_pending" },
    });
    const reset = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(reset.movementPhase).toBe("queued");
    expect(reset.movementAttempt).toBe(0);
    expect(reset.movementErrorCode).toBeUndefined();
    expect(reset.movementCorrelationId).toBeUndefined();
    expect(reset.movementSourceDayCursor).toBe("2026-07-01");
    // The running accumulator was erased with the reset — without this, day
    // one would double-count on re-aggregation.
    expect(reset.movementTotals).toBeUndefined();

    const { row } = await drive(t, header._id);
    expect(row.movementPhase).toBe("completed");
    expect(row.movementTotals).toEqual({
      unitsSold: 10,
      unitsReturned: 0,
      netUnits: 10,
      skuCount: 1,
    });
  });

  it("admits the successor identity when the source vector moved past a terminal row", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const [skuId] = await seedSkus(t, storeId, 1);
    await t.run((ctx) =>
      certifyDay(ctx, storeId, "2026-07-01", 1, [
        { productSkuId: skuId!, unitsSold: 2 },
      ]),
    );
    const { requestKey, header } = await admitOne(
      t,
      storeId,
      "2026-07-01",
      "2026-07-01",
    );
    await t.run((ctx) =>
      ctx.db.patch("reportRangeResult", header._id, {
        status: "failed",
        movementPhase: "terminal_error",
        movementErrorCode: MIX_ERROR_CODE_SOURCE_STALE,
        movementCorrelationId: "test-correlation",
      }),
    );
    await t.run(async (ctx) => {
      const day = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-01"),
        )
        .unique();
      await ctx.db.patch("reportDay", day!._id, { certifiedFoldRevision: 2 });
      const skuRow = await ctx.db
        .query("reportSkuDay")
        .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-01"),
        )
        .unique();
      await ctx.db.patch("reportSkuDay", skuRow!._id, {
        certifiedFoldRevision: 2,
      });
    });

    const retried = await t.run((ctx) =>
      retryTerminalMixRequest(ctx, {
        storeId,
        requestKey,
        principalKey: "principal-1",
      }),
    );
    expect(retried.lifecycle.state).toBe("queued_pending");
    expect(retried.requestKey).not.toBe(requestKey);
    const failed = await headerByKey(t, storeId, requestKey);
    expect(failed!.movementPhase).toBe("terminal_error");
    const successor = await headerByKey(t, storeId, retried.requestKey!);
    expect(successor!.movementPhase).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// Public boundary: authorization, registry, isolation, payload bounds
// ---------------------------------------------------------------------------

describe("public boundary", () => {
  it("both public mutations are registered for the generation capability, which the shared demo may never hold", () => {
    // Was `classifyAthenaPublicWrite(...)` against a hand-maintained
    // module -> capability map. The map is deleted; the definition IS the
    // registration, so the capability is read off it directly.
    for (const definition of [
      ensureMixRangeOperationDefinition,
      retryMixRangeOperationDefinition,
    ]) {
      expect(definition.capability, definition.functionName).toBe(
        "reporting.generate",
      );
      expect(definition.actors.sharedDemo, definition.functionName).toBe(
        "deny",
      );
    }
    expect(isSharedDemoCapabilityAllowed("reporting.generate")).toBe(false);
  });

  /**
   * The retired `requireSharedDemoCapabilityIfApplicable(ctx,
   * "reporting.generate")` call site. Its successor is a definition field, so
   * the assertion is on the declaration; the demo principal is denied end to
   * end against the real adapter chain in `reportsAdmission.test.ts`.
   */
  it("declares the demo denial that the retired handler check used to perform", () => {
    for (const definition of [
      ensureMixRangeOperationDefinition,
      retryMixRangeOperationDefinition,
    ]) {
      expect(definition.capability).toBe("reporting.generate");
      expect(definition.actors.sharedDemo).toBe("deny");
      expect(definition.actors.public).toBe("deny");
      expect(definition.actors.normalUser).toBe("admit");
    }
  });

  it("fails closed for an unauthenticated caller through the real access gate", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    vi.mocked(requireReportsStoreAccess).mockImplementation(
      actualAccess.requireReportsStoreAccess,
    );
    // Identity resolution is the rail's, so an absent Athena user is an
    // admission denial now rather than a gate denial. Either way nothing runs.
    vi.mocked(requireAuthenticatedAthenaUserWithCtx).mockResolvedValue(
      null as never,
    );
    await expect(
      t.run((ctx) =>
        handlerOf(ensureMixRange)(ctx, {
          storeId,
          startDate: "2026-07-01",
          endDate: "2026-07-01",
        }),
      ),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("cross-store substitution returns no data", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t, "store-a");
    const { storeId: otherStoreId } = await seedStore(t, "store-b");
    allow(storeId, otherStoreId);
    const [skuId] = await seedSkus(t, storeId, 1);
    await t.run((ctx) =>
      certifyDay(ctx, storeId, "2026-07-01", 1, [
        { productSkuId: skuId!, unitsSold: 2 },
      ]),
    );
    const { requestKey, header } = await admitOne(
      t,
      storeId,
      "2026-07-01",
      "2026-07-01",
    );
    await drive(t, header._id);

    const foreignStatus = await t.run((ctx) =>
      handlerOf(getMixRange)(ctx, { storeId: otherStoreId, requestKey }),
    );
    expect(foreignStatus).toBeNull();
    const foreignVisible = await t.run((ctx) =>
      handlerOf(getMixRangeVisible)(ctx, {
        storeId: otherStoreId,
        requestKey,
      }),
    );
    expect(foreignVisible).toBeNull();
  });

  it("getMixRange exposes only the sanitized public lifecycle and hides expired rows", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const { requestKey, header } = await admitOne(
      t,
      storeId,
      "2026-09-01",
      "2026-09-01",
    );
    const pendingStatus = await t.run((ctx) =>
      handlerOf(getMixRange)(ctx, { storeId, requestKey }),
    );
    expect(pendingStatus).toEqual({
      requestKey,
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      lifecycle: { state: "queued_pending" },
    });
    // Before completion, the visible reader is an honest pending shape.
    const pendingVisible = await visible(t, storeId, requestKey);
    expect(pendingVisible).toMatchObject({
      lifecycle: { state: "queued_pending" },
      data: null,
    });

    await drive(t, header._id);
    const completedStatus = await t.run((ctx) =>
      handlerOf(getMixRange)(ctx, { storeId, requestKey }),
    );
    expect(completedStatus!.lifecycle).toMatchObject({
      state: "completed",
      totals: { totalUnitsSold: 0, skuCount: 0 },
    });
    // No cursors, fences, vectors, or attempts cross the boundary.
    expect(JSON.stringify(completedStatus)).not.toMatch(
      /fence|cursor|revision|attempt/i,
    );

    // An expired request reads as absent, racing cleanup notwithstanding.
    await t.run((ctx) =>
      ctx.db.patch("reportRangeResult", header._id, {
        expiresAt: Date.now() - 1,
      }),
    );
    expect(
      await t.run((ctx) =>
        handlerOf(getMixRange)(ctx, { storeId, requestKey }),
      ),
    ).toBeNull();
    expect(await visible(t, storeId, requestKey)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cleanup sizing and expiry
// ---------------------------------------------------------------------------

describe("cleanup budget", () => {
  it("steady-state cleanup throughput exceeds steady-state child creation", () => {
    const ticksPerDay = (24 * 60 * 60 * 1000) / REPORTS_SWEEP_INTERVAL_MS;
    const deletableChildrenPerDay = ticksPerDay * MIX_CLEANUP_CHILD_BATCH;
    const createdChildrenPerDay =
      MIX_STEADY_STATE_REQUESTS_PER_DAY * MIX_STEADY_STATE_CHILDREN_PER_REQUEST;
    expect(deletableChildrenPerDay).toBeGreaterThan(createdChildrenPerDay);
  });

  it("expiry lifetimes are inherited and cleanup deletes children before the header", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const skuIds = await seedSkus(t, storeId, 3);
    await t.run((ctx) =>
      certifyDay(
        ctx,
        storeId,
        "2026-07-01",
        1,
        skuIds.map((productSkuId, index) => ({
          productSkuId,
          unitsSold: index + 1,
        })),
      ),
    );
    const { header } = await admitOne(t, storeId, "2026-07-01", "2026-07-01");
    await drive(t, header._id);
    const children = await mixChildren(t, storeId, header._id);
    expect(children).toHaveLength(3);
    for (const child of children) {
      expect(child.expiresAt).toBe(header.expiresAt);
    }
    expect(header.expiresAt - header.requestedAt).toBe(REPORT_RANGE_TTL_MS);

    // Expire the snapshot and run the kinded cleanup: children first, then
    // the header once none remain.
    const past = header.expiresAt + 1;
    await t.run(async (ctx) => {
      const result = await cleanupExpiredRangeSnapshots(ctx, past, [
        MOVEMENT_RANGE_SNAPSHOT_KIND,
        MIX_RANGE_SNAPSHOT_KIND,
      ]);
      expect(result.childrenDeleted).toBe(3);
      expect(result.headersDeleted).toBe(1);
    });
    expect(await mixChildren(t, storeId, header._id)).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", header._id)),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Contract helpers
// ---------------------------------------------------------------------------

describe("contract helpers", () => {
  it("normalizes the zero sort key and negates units sold", () => {
    expect(Object.is(mixUnitsSoldSortKey(0), 0)).toBe(true);
    expect(Object.is(mixUnitsSoldSortKey(0), -0)).toBe(false);
    expect(mixUnitsSoldSortKey(25)).toBe(-25);
  });
});
