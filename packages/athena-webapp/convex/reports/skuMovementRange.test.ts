/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Failure-injection seam for the atomic batch mutation: the sort-key helper
 * runs once per accumulated source row, so tripping it mid-day proves the
 * batch rolls back aggregates, cursor, and fence TOGETHER while the separate
 * failure mutation still records retry metadata.
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
    movementAbsNetUnitsSortKey: (netUnits: number) => {
      sortKeyControl.callCount += 1;
      if (sortKeyControl.callCount > sortKeyControl.failAfterCalls) {
        throw new Error("SECRET_INTERNAL_DETAIL: injected batch defect");
      }
      return actual.movementAbsNetUnitsSortKey(netUnits);
    },
  };
});

vi.mock("./access", () => ({ requireReportsStoreAccess: vi.fn() }));
import { requireReportsStoreAccess } from "./access";
const actualAccess = await vi.importActual<typeof import("./access")>(
  "./access",
);

/**
 * The admission rail's identity port. convex-test has no auth provider, so
 * without a stub every exported handler is an anonymous denial and these
 * suites would test admission rather than the fenced state machine. The rail's
 * behaviour on these four functions is covered end to end, with real
 * identities and a real demo principal, in `reportsAdmission.test.ts`.
 */
vi.mock("../lib/athenaUserAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/athenaUserAuth")>()),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
}));
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";

import {
  REPORTS_FOLD_VERSION,
  REPORT_MOVEMENT_PAGE_SIZE,
  REPORT_MOVEMENT_RANGE_MAX_DAYS,
  REPORT_RANGE_TTL_MS,
} from "../../shared/reportsContract";
import {
  isSharedDemoCapabilityAllowed,
} from "../platform/capabilityCatalog";
import {
  ensureMovementRangeOperationDefinition,
  retryMovementRangeOperationDefinition,
} from "../operationAdmission/domains/u8_reports_definitions";
import { REPORTS_SWEEP_STORE_ALLOWLIST_ENV } from "./sweeper";
import { requestRangeCore } from "./customRange";
import {
  MOVEMENT_ADMISSIONS_PER_PRINCIPAL,
  MOVEMENT_ADMISSIONS_PER_STORE,
  MOVEMENT_ADMISSION_WINDOW_MS,
  MOVEMENT_BACKPRESSURE_RETRY_MS,
  MOVEMENT_CLEANUP_CHILD_BATCH,
  MOVEMENT_ERROR_CODE_SOURCE_STALE,
  MOVEMENT_ERROR_CODE_WORKER_FAILED,
  MOVEMENT_MAX_ATTEMPTS,
  MOVEMENT_RETRY_BASE_MS,
  MOVEMENT_RETRY_JITTER_MS,
  MOVEMENT_RETRY_MAX_MS,
  MOVEMENT_STEADY_STATE_CHILDREN_PER_REQUEST,
  MOVEMENT_STEADY_STATE_REQUESTS_PER_DAY,
  MOVEMENT_WAITING_RETRY_MS,
  REPORTS_SWEEP_INTERVAL_MS,
  ensureMovementRange,
  ensureMovementRangeCore,
  getMovementRange,
  getMovementRangePage,
  movementRetryBackoffMs,
  recordMovementWorkerFailureCore,
  retryTerminalMovementRequest,
  runMovementBatchCore,
} from "./skuMovementRange";

// Path-string function references (the worker/batch continuation chain) need
// module keys rooted at the convex directory, so remap the test-relative glob
// exactly as customRange.test.ts does.
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);

type Harness = ReturnType<typeof convexTest>;

const BATCH_REF = makeFunctionReference<"mutation">(
  "reports/skuMovementRange:runMovementBatch",
);
const WORKER_REF = makeFunctionReference<"action">(
  "reports/skuMovementRange:runMovementWorker",
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

async function seedStore(t: Harness, slug = "movement") {
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
  slug = "movement",
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

type SkuMovementSpec = {
  productSkuId: Id<"productSku">;
  unitsSold: number;
  unitsReturned: number;
};

/** Write one certified (day, SKU rows) generation, revisions stamped alike. */
async function certifyDay(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  revision: number,
  skuRows: SkuMovementSpec[],
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
      unitsReturned: row.unitsReturned,
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
    ensureMovementRangeCore(ctx, {
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
  // The helper's Harness type collapses convexTest's schema generic, so the
  // ctx is re-widened to the app MutationCtx for the indexed read.
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
      runMovementBatchCore(ctx, {
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

// ---------------------------------------------------------------------------
// Enablement, validation, and the waiting gate
// ---------------------------------------------------------------------------

describe("ensure gates", () => {
  it("returns sanitized not_available for a non-allowlisted store, writing nothing", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    // Deliberately NOT allowlisted — and with garbage dates, which must not
    // even reach validation for a disabled store.
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

  it("rejects malformed dates and spans beyond the 184-day movement ceiling", async () => {
    // U7 deliberately widened movement from its 92-day rollout ceiling to the
    // shared drill-down ceiling; 185 stays rejected.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    await expect(
      ensure(t, { storeId, startDate: "2026-02-30", endDate: "2026-03-01" }),
    ).rejects.toThrow(/Invalid startDate/);
    await expect(
      ensure(t, { storeId, startDate: "2026-01-01", endDate: "2026-07-04" }),
    ).rejects.toThrow(/maximum is 184 days/);
  });

  it("waits (no write) while any included day is dirty", async () => {
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
    expect(result.requestKey).toBeNull();
    expect(result.lifecycle.state).toBe("waiting");
    const retryAfterMs =
      result.lifecycle.state === "waiting" ? result.lifecycle.retryAfterMs : 0;
    expect(retryAfterMs).toBeGreaterThanOrEqual(MOVEMENT_WAITING_RETRY_MS);
    expect(retryAfterMs).toBeLessThan(
      MOVEMENT_WAITING_RETRY_MS + MOVEMENT_RETRY_JITTER_MS,
    );
    const rows = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture read
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  it("waits for an allowlisted store whose history is not yet revision-certified", async () => {
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
      endDate: "2026-07-01",
    });
    expect(result.lifecycle.state).toBe("waiting");
  });

  it("admits a full 184-day range of empty days within the bounded ensure read", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    // 2026-01-01 .. 2026-07-03 inclusive is exactly 184 days, all empty.
    // This is the pre-admission revision-vector read that runs on EVERY
    // ensure call (including waiting-state polls) — re-asserted at the U7
    // ceiling: the vector fills the full widened window.
    const result = await ensure(t, {
      storeId,
      startDate: "2026-01-01",
      endDate: "2026-07-03",
    });
    expect(result.lifecycle.state).toBe("queued_pending");
    const header = await headerByKey(t, storeId, result.requestKey!);
    expect(REPORT_MOVEMENT_RANGE_MAX_DAYS).toBe(184);
    expect(header!.movementRevisionVector).toHaveLength(
      REPORT_MOVEMENT_RANGE_MAX_DAYS,
    );
    expect(
      header!.movementRevisionVector!.every(
        (entry) => entry.revision === "empty",
      ),
    ).toBe(true);

    // An all-empty snapshot still completes honestly: zero totals, one page.
    const { row } = await drive(t, header!._id);
    expect(row.movementPhase).toBe("completed");
    expect(row.movementTotals).toEqual({
      unitsSold: 0,
      unitsReturned: 0,
      netUnits: 0,
      skuCount: 0,
    });
    const page = await t.run((ctx) =>
      handlerOf(getMovementRangePage)(ctx, {
        storeId,
        requestKey: result.requestKey!,
        page: 1,
      }),
    );
    expect(page.lifecycle.state).toBe("completed");
    expect(page.pageCount).toBe(1);
    expect(page.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Admission windows
// ---------------------------------------------------------------------------

describe("admission", () => {
  it("saturates per principal with retryable backpressure and zero writes", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const now = Date.now();

    for (let index = 0; index < MOVEMENT_ADMISSIONS_PER_PRINCIPAL; index += 1) {
      const date = `2026-01-0${index + 1}`;
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
      startDate: "2026-01-09",
      endDate: "2026-01-09",
      now,
    });
    expect(saturated.requestKey).toBeNull();
    expect(saturated.lifecycle.state).toBe("backpressure");
    const retryAfterMs =
      saturated.lifecycle.state === "backpressure"
        ? saturated.lifecycle.retryAfterMs
        : 0;
    expect(retryAfterMs).toBeGreaterThanOrEqual(
      MOVEMENT_BACKPRESSURE_RETRY_MS,
    );
    expect(retryAfterMs).toBeLessThan(
      MOVEMENT_BACKPRESSURE_RETRY_MS + MOVEMENT_RETRY_JITTER_MS,
    );

    const rows = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture read
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(rows).toHaveLength(MOVEMENT_ADMISSIONS_PER_PRINCIPAL);

    // A fresh window admits again.
    const later = await ensure(t, {
      storeId,
      startDate: "2026-01-09",
      endDate: "2026-01-09",
      now: now + MOVEMENT_ADMISSION_WINDOW_MS,
    });
    expect(later.lifecycle.state).toBe("queued_pending");
  });

  it("saturates per store across principals", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const now = Date.now();

    let admittedCount = 0;
    for (let principal = 0; principal < 3; principal += 1) {
      for (
        let index = 0;
        index < MOVEMENT_ADMISSIONS_PER_PRINCIPAL;
        index += 1
      ) {
        const day = String(admittedCount + 1).padStart(2, "0");
        const result = await ensure(t, {
          storeId,
          startDate: `2026-03-${day}`,
          endDate: `2026-03-${day}`,
          principalKey: `principal-${principal}`,
          now,
        });
        if (admittedCount < MOVEMENT_ADMISSIONS_PER_STORE) {
          expect(result.lifecycle.state).toBe("queued_pending");
          admittedCount += 1;
        } else {
          expect(result.lifecycle.state).toBe("backpressure");
        }
      }
    }
    expect(admittedCount).toBe(MOVEMENT_ADMISSIONS_PER_STORE);
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
          q.eq("scope", "principal").eq("key", "principal-1"),
        )
        .unique(),
    );
    expect(bucket!.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: aggregation, ranking, completion — at scale
// ---------------------------------------------------------------------------

describe("lifecycle at scale", () => {
  it("completes 146 SKUs over 5,110 SKU-day rows across many bounded batches", { timeout: 60_000 }, async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const skuIds = await seedSkus(t, storeId, 146);

    // 2026-06-01 .. 2026-07-05 = 35 inclusive days; one row per SKU per day
    // = 5,110 source rows. sku0 is a net-returner; sku1 and sku2 tie on
    // absolute movement (the R8 identity tie-break); the rest are distinct.
    const dailyFor = (index: number) =>
      index === 0
        ? { unitsSold: 0, unitsReturned: 1 }
        : index === 1
          ? { unitsSold: 2, unitsReturned: 0 }
          : { unitsSold: index, unitsReturned: 0 };

    const dates: string[] = [];
    for (let day = 0; day < 35; day += 1) {
      const june = day < 30;
      const dayOfMonth = june ? day + 1 : day - 29;
      dates.push(
        `2026-${june ? "06" : "07"}-${String(dayOfMonth).padStart(2, "0")}`,
      );
    }
    for (const date of dates) {
      await t.run((ctx) =>
        certifyDay(
          ctx,
          storeId,
          date,
          1,
          skuIds.map((productSkuId, index) => ({
            productSkuId,
            ...dailyFor(index),
          })),
        ),
      );
    }

    const { requestKey, header } = await admitOne(
      t,
      storeId,
      "2026-06-01",
      "2026-07-05",
    );
    const { row, steps } = await drive(t, header._id);

    // Multiple source batches (one per day) plus reset and ranking passes.
    expect(steps).toBeGreaterThan(35);
    expect(row.movementPhase).toBe("completed");
    expect(row.status).toBe("completed");
    expect(row.movementEligibleAt).toBeUndefined();

    // Expected totals, derived independently from the fixture spec.
    const perSku = skuIds.map((productSkuId, index) => {
      const daily = dailyFor(index);
      return {
        id: String(productSkuId),
        unitsSold: daily.unitsSold * 35,
        unitsReturned: daily.unitsReturned * 35,
        netUnits: (daily.unitsSold - daily.unitsReturned) * 35,
      };
    });
    expect(row.movementTotals).toEqual({
      unitsSold: perSku.reduce((total, sku) => total + sku.unitsSold, 0),
      unitsReturned: perSku.reduce(
        (total, sku) => total + sku.unitsReturned,
        0,
      ),
      netUnits: perSku.reduce((total, sku) => total + sku.netUnits, 0),
      skuCount: 146,
    });

    // Deterministic ordering: |net| descending, SKU id ascending on ties.
    const expectedOrder = [...perSku].sort(
      (a, b) =>
        Math.abs(b.netUnits) - Math.abs(a.netUnits) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    const pageOne = await t.run((ctx) =>
      handlerOf(getMovementRangePage)(ctx, { storeId, requestKey, page: 1 }),
    );
    expect(pageOne.lifecycle.state).toBe("completed");
    expect(pageOne.pageCount).toBe(8);
    expect(pageOne.rows).toHaveLength(REPORT_MOVEMENT_PAGE_SIZE);
    expect(pageOne.rows.map((r: { productSkuId: string }) => r.productSkuId)).toEqual(
      expectedOrder.slice(0, 20).map((sku) => sku.id),
    );
    expect(pageOne.rows.map((r: { rank: number }) => r.rank)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );

    // Every SKU is reachable through the eight bounded pages, exactly once,
    // in one global ordering — including the net-negative SKU with its sign.
    const allRows: Array<{ productSkuId: string; netUnits: number }> = [];
    for (let page = 1; page <= pageOne.pageCount; page += 1) {
      const result = await t.run((ctx) =>
        handlerOf(getMovementRangePage)(ctx, { storeId, requestKey, page }),
      );
      expect(result.rows.length).toBeLessThanOrEqual(
        REPORT_MOVEMENT_PAGE_SIZE,
      );
      allRows.push(...result.rows);
    }
    expect(allRows.map((r) => r.productSkuId)).toEqual(
      expectedOrder.map((sku) => sku.id),
    );
    const negativeRow = allRows.find(
      (r) => r.productSkuId === String(skuIds[0]),
    );
    expect(negativeRow?.netUnits).toBe(-35);
  });

  it("completes a full 184-day range with production-like SKU breadth across bounded batches", { timeout: 180_000 }, async () => {
    // U7 scale scenario: the widened ceiling end to end. 30 SKUs active on
    // every one of the 184 days (2026-01-01 .. 2026-07-03) = 5,520 source
    // rows — the per-day resumable design must aggregate one bounded batch
    // per day and still rank and paginate the result completely.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const skuIds = await seedSkus(t, storeId, 30);

    const dates: string[] = [];
    const cursor = new Date(Date.UTC(2026, 0, 1));
    for (let day = 0; day < 184; day += 1) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    expect(dates[183]).toBe("2026-07-03");
    for (const date of dates) {
      await t.run((ctx) =>
        certifyDay(
          ctx,
          storeId,
          date,
          1,
          skuIds.map((productSkuId, index) => ({
            productSkuId,
            unitsSold: index + 1,
            unitsReturned: 0,
          })),
        ),
      );
    }

    const { requestKey, header } = await admitOne(
      t,
      storeId,
      "2026-01-01",
      "2026-07-03",
    );
    const { row, steps } = await drive(t, header._id);

    // At least one bounded source batch per included day, plus ranking.
    expect(steps).toBeGreaterThan(184);
    expect(row.movementPhase).toBe("completed");
    expect(row.status).toBe("completed");
    // sum(1..30) = 465 units per day, over all 184 days.
    expect(row.movementTotals).toEqual({
      unitsSold: 465 * 184,
      unitsReturned: 0,
      netUnits: 465 * 184,
      skuCount: 30,
    });

    const pageOne = await t.run((ctx) =>
      handlerOf(getMovementRangePage)(ctx, { storeId, requestKey, page: 1 }),
    );
    expect(pageOne.lifecycle.state).toBe("completed");
    expect(pageOne.pageCount).toBe(2);
    expect(pageOne.rows).toHaveLength(REPORT_MOVEMENT_PAGE_SIZE);
    // Highest daily mover ranks first with its full-span net.
    expect(pageOne.rows[0]).toMatchObject({
      productSkuId: String(skuIds[29]),
      rank: 1,
      netUnits: 30 * 184,
    });
  });

  it("reuses a completed snapshot on an unchanged vector and admits a successor after a refold", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const [skuId] = await seedSkus(t, storeId, 1);
    await t.run((ctx) =>
      certifyDay(ctx, storeId, "2026-07-01", 1, [
        { productSkuId: skuId!, unitsSold: 3, unitsReturned: 1 },
      ]),
    );

    const first = await admitOne(t, storeId, "2026-07-01", "2026-07-01");
    await drive(t, first.header._id);

    const reopened = await ensure(t, {
      storeId,
      startDate: "2026-07-01",
      endDate: "2026-07-01",
    });
    expect(reopened.requestKey).toBe(first.requestKey);
    expect(reopened.lifecycle.state).toBe("completed");

    // A custom-summary request over the same dates stays fully independent.
    const summary = await t.run((ctx) =>
      requestRangeCore(ctx, {
        storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-01",
      }),
    );
    expect(summary.requestKey).not.toBe(first.requestKey);
    expect(summary.requestKey.startsWith("range:")).toBe(true);

    // Refold the day: revision changes, so the identity changes.
    await t.run(async (ctx) => {
      const skuRows = await ctx.db
        .query("reportSkuDay")
        .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-01"),
        )
        .take(10);
      for (const skuRow of skuRows) {
        await ctx.db.delete("reportSkuDay", skuRow._id);
      }
      await certifyDay(ctx, storeId, "2026-07-01", 2, [
        { productSkuId: skuId!, unitsSold: 5, unitsReturned: 0 },
      ]);
    });

    const successor = await ensure(t, {
      storeId,
      startDate: "2026-07-01",
      endDate: "2026-07-01",
    });
    expect(successor.lifecycle.state).toBe("queued_pending");
    expect(successor.requestKey).not.toBe(first.requestKey);
    // The completed predecessor still exists untouched until TTL.
    const predecessor = await headerByKey(t, storeId, first.requestKey);
    expect(predecessor!.movementPhase).toBe("completed");
  });

  it("ranks a net returner ahead of a smaller positive mover, keeping both signs and zero-net SKUs", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const [returner, seller, cancelled] = await seedSkus(t, storeId, 3);
    await t.run((ctx) =>
      certifyDay(ctx, storeId, "2026-07-10", 1, [
        { productSkuId: returner!, unitsSold: 0, unitsReturned: 24 },
        { productSkuId: seller!, unitsSold: 18, unitsReturned: 0 },
        // Fully cancelled movement: activity with net zero stays reachable.
        { productSkuId: cancelled!, unitsSold: 5, unitsReturned: 5 },
      ]),
    );

    const { requestKey, header } = await admitOne(
      t,
      storeId,
      "2026-07-10",
      "2026-07-10",
    );
    const { row } = await drive(t, header._id);
    expect(row.movementTotals).toEqual({
      unitsSold: 23,
      unitsReturned: 29,
      netUnits: -6,
      skuCount: 3,
    });

    const page = await t.run((ctx) =>
      handlerOf(getMovementRangePage)(ctx, { storeId, requestKey, page: 1 }),
    );
    expect(
      page.rows.map((r: { productSkuId: string; netUnits: number; rank: number }) => [
        r.productSkuId,
        r.netUnits,
        r.rank,
      ]),
    ).toEqual([
      [String(returner), -24, 1],
      [String(seller), 18, 2],
      [String(cancelled), 0, 3],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Freshness races and fencing
// ---------------------------------------------------------------------------

describe("races and fencing", () => {
  async function twoDayFixture(t: Harness) {
    const { storeId } = await seedStore(t);
    allow(storeId);
    const [skuId] = await seedSkus(t, storeId, 1);
    await t.run(async (ctx) => {
      await certifyDay(ctx, storeId, "2026-07-01", 1, [
        { productSkuId: skuId!, unitsSold: 2, unitsReturned: 0 },
      ]);
      await certifyDay(ctx, storeId, "2026-07-02", 1, [
        { productSkuId: skuId!, unitsSold: 3, unitsReturned: 0 },
      ]);
    });
    const admitted = await admitOne(t, storeId, "2026-07-01", "2026-07-02");
    return { storeId, skuId: skuId!, ...admitted };
  }

  async function step(t: Harness, id: Id<"reportRangeResult">) {
    const row = (await t.run((ctx) => ctx.db.get("reportRangeResult", id)))!;
    return t.run((ctx) =>
      runMovementBatchCore(ctx, {
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

    // Day 2 refolds (revision advances) before its batch runs.
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
    expect(row.movementErrorCode).toBe(MOVEMENT_ERROR_CODE_SOURCE_STALE);
    expect(row.movementCorrelationId).toBeDefined();
    expect(row.status).toBe("failed");
  });

  it("a dirty mark appearing mid-flight also refuses publication", async () => {
    const t = convexTest(schema, modules);
    const { storeId, header } = await twoDayFixture(t);
    await step(t, header._id);
    await step(t, header._id);
    await t.run((ctx) =>
      ctx.db.insert("reportDirtyDay", {
        storeId,
        operatingDate: "2026-07-02",
        reason: "late_fact",
        markedAt: Date.now(),
      }),
    );
    await step(t, header._id);
    const row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(row.movementPhase).toBe("terminal_error");
    expect(row.movementErrorCode).toBe(MOVEMENT_ERROR_CODE_SOURCE_STALE);
  });

  it("the final publication recheck refuses a vector that moved after aggregation", async () => {
    const t = convexTest(schema, modules);
    const { storeId, header } = await twoDayFixture(t);
    await step(t, header._id); // reset
    await step(t, header._id); // day 1
    await step(t, header._id); // day 2 → ranking

    await t.run(async (ctx) => {
      const day = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-01"),
        )
        .unique();
      await ctx.db.patch("reportDay", day!._id, { certifiedFoldRevision: 5 });
    });

    await step(t, header._id); // ranking finalization → recheck fails
    const row = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(row.movementPhase).toBe("terminal_error");
    expect(row.movementErrorCode).toBe(MOVEMENT_ERROR_CODE_SOURCE_STALE);
    expect(row.movementTotals).toBeUndefined();
  });

  it("a duplicate worker carrying a spent fence is a no-op and cannot double-count", async () => {
    const t = convexTest(schema, modules);
    const { header, storeId } = await twoDayFixture(t);

    await step(t, header._id); // queued → aggregating, fence now 2
    const before = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    const spentFence = before.movementFence!;

    const first = await t.run((ctx) =>
      runMovementBatchCore(ctx, {
        rangeResultId: header._id,
        expectedPhase: "aggregating",
        expectedFence: spentFence,
      }),
    );
    expect(first.next).toBe("continue");
    const duplicate = await t.run((ctx) =>
      runMovementBatchCore(ctx, {
        rangeResultId: header._id,
        expectedPhase: "aggregating",
        expectedFence: spentFence,
      }),
    );
    expect(duplicate).toEqual({ next: "stale" });

    const children = await t.run((ctx) =>
      ctx.db
        .query("reportRangeMovementSku")
        .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
          q.eq("storeId", storeId).eq("rangeResultId", header._id),
        )
        .take(10),
    );
    expect(children).toHaveLength(1);
    expect(children[0]!.unitsSold).toBe(2); // day 1 exactly once
  });
});

// ---------------------------------------------------------------------------
// Rollback, retry metadata, and the separate failure transaction
// ---------------------------------------------------------------------------

describe("failure lane", () => {
  it("rolls the batch back whole, records retry in a separate transaction, and retries without double-counting", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const skuIds = await seedSkus(t, storeId, 3);
    const rows = skuIds.map((productSkuId, index) => ({
      productSkuId,
      unitsSold: index + 1,
      unitsReturned: 0,
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
        runMovementBatchCore(ctx, {
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

    // Fail mid-day-2 — after at least one child upsert would have written.
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

    // Aggregates, cursor, and fence rolled back together.
    const afterFailure = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    expect(afterFailure.movementFence).toBe(beforeFailure.movementFence);
    expect(afterFailure.movementSourceDayCursor).toBe("2026-07-02");
    const children = await t.run((ctx) =>
      ctx.db
        .query("reportRangeMovementSku")
        .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
          q.eq("storeId", storeId).eq("rangeResultId", header._id),
        )
        .take(10),
    );
    expect(children.map((child) => child.unitsSold).sort()).toEqual([1, 2, 3]);

    // The SEPARATE failure transaction records backoff without touching work.
    const now = Date.now();
    const outcome = await t.run((ctx) =>
      recordMovementWorkerFailureCore(ctx, {
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
    expect(retryRow.movementEligibleAt).toBe(now + MOVEMENT_RETRY_BASE_MS);

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
        { productSkuId: skuId!, unitsSold: 1, unitsReturned: 0 },
      ]),
    );
    const { header } = await admitOne(t, storeId, "2026-07-01", "2026-07-01");
    await t.run((ctx) =>
      ctx.db.patch("reportRangeResult", header._id, {
        movementPhase: "aggregating",
        movementAttempt: MOVEMENT_MAX_ATTEMPTS - 1,
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
    expect(row.movementErrorCode).toBe(MOVEMENT_ERROR_CODE_WORKER_FAILED);
    expect(row.movementCorrelationId).toBeDefined();
    expect(row.movementEligibleAt).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("SECRET_INTERNAL_DETAIL");
  });

  it("backoff doubles per attempt and caps", () => {
    expect(movementRetryBackoffMs(1)).toBe(MOVEMENT_RETRY_BASE_MS);
    expect(movementRetryBackoffMs(2)).toBe(MOVEMENT_RETRY_BASE_MS * 2);
    expect(movementRetryBackoffMs(3)).toBe(MOVEMENT_RETRY_BASE_MS * 4);
    expect(movementRetryBackoffMs(50)).toBe(MOVEMENT_RETRY_MAX_MS);
  });

  it("ignores a failure report for a superseded fence", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const { header } = await admitOne(t, storeId, "2026-08-01", "2026-08-01");
    const outcome = await t.run((ctx) =>
      recordMovementWorkerFailureCore(ctx, {
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
  it("resets the same identity under a new fence, clears stale children, and completes cleanly", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const [skuId] = await seedSkus(t, storeId, 1);
    await t.run(async (ctx) => {
      await certifyDay(ctx, storeId, "2026-07-01", 1, [
        { productSkuId: skuId!, unitsSold: 4, unitsReturned: 1 },
      ]);
      await certifyDay(ctx, storeId, "2026-07-02", 1, [
        { productSkuId: skuId!, unitsSold: 6, unitsReturned: 0 },
      ]);
    });
    const { requestKey, header } = await admitOne(
      t,
      storeId,
      "2026-07-01",
      "2026-07-02",
    );

    // Aggregate day one, then force a worker-failed terminal state so a
    // stale child row survives into the retry.
    const rowBefore = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    await t.run((ctx) =>
      runMovementBatchCore(ctx, {
        rangeResultId: header._id,
        expectedPhase: rowBefore.movementPhase!,
        expectedFence: rowBefore.movementFence!,
      }),
    );
    const aggRow = (await t.run((ctx) =>
      ctx.db.get("reportRangeResult", header._id),
    ))!;
    await t.run((ctx) =>
      runMovementBatchCore(ctx, {
        rangeResultId: header._id,
        expectedPhase: aggRow.movementPhase!,
        expectedFence: aggRow.movementFence!,
      }),
    );
    await t.run(async (ctx) => {
      const row = (await ctx.db.get("reportRangeResult", header._id))!;
      await ctx.db.patch("reportRangeResult", header._id, {
        status: "failed",
        movementPhase: "terminal_error",
        movementErrorCode: MOVEMENT_ERROR_CODE_WORKER_FAILED,
        movementCorrelationId: "test-correlation",
        movementFence: row.movementFence! + 1,
        movementEligibleAt: undefined,
      });
    });

    const retried = await t.run((ctx) =>
      retryTerminalMovementRequest(ctx, {
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

    const { row } = await drive(t, header._id);
    expect(row.movementPhase).toBe("completed");
    // Day one was aggregated once before the failure and once after the
    // reset — the queued reset must have cleared the stale child.
    expect(row.movementTotals).toEqual({
      unitsSold: 10,
      unitsReturned: 1,
      netUnits: 9,
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
        { productSkuId: skuId!, unitsSold: 2, unitsReturned: 0 },
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
        movementErrorCode: MOVEMENT_ERROR_CODE_SOURCE_STALE,
        movementCorrelationId: "test-correlation",
      }),
    );
    // The day refolds; the terminal identity can never publish.
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
      retryTerminalMovementRequest(ctx, {
        storeId,
        requestKey,
        principalKey: "principal-1",
      }),
    );
    expect(retried.lifecycle.state).toBe("queued_pending");
    expect(retried.requestKey).not.toBe(requestKey);
    // The failed row is untouched; the successor is a distinct fenced row.
    const failed = await headerByKey(t, storeId, requestKey);
    expect(failed!.movementPhase).toBe("terminal_error");
    const successor = await headerByKey(t, storeId, retried.requestKey!);
    expect(successor!.movementPhase).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// Public boundary: authorization, isolation, validation, payload bounds
// ---------------------------------------------------------------------------

describe("public boundary", () => {
  it("is registered for the generation capability, which the shared demo may never hold", () => {
    // Was `classifyAthenaPublicWrite(...)` against a hand-maintained
    // module -> capability map. The map is deleted; the definition IS the
    // registration, so the capability is read off it directly.
    expect(ensureMovementRangeOperationDefinition.functionName).toBe(
      "reports/skuMovementRange:ensureMovementRange",
    );
    expect(ensureMovementRangeOperationDefinition.capability).toBe(
      "reporting.generate",
    );
    expect(ensureMovementRangeOperationDefinition.actors.sharedDemo).toBe(
      "deny",
    );
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
      ensureMovementRangeOperationDefinition,
      retryMovementRangeOperationDefinition,
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
        handlerOf(ensureMovementRange)(ctx, {
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
        { productSkuId: skuId!, unitsSold: 2, unitsReturned: 0 },
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
      handlerOf(getMovementRange)(ctx, {
        storeId: otherStoreId,
        requestKey,
      }),
    );
    expect(foreignStatus).toBeNull();
    const foreignPage = await t.run((ctx) =>
      handlerOf(getMovementRangePage)(ctx, {
        storeId: otherStoreId,
        requestKey,
        page: 1,
      }),
    );
    expect(foreignPage).toBeNull();
  });

  it("validates and canonicalizes page input", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const [skuId] = await seedSkus(t, storeId, 1);
    await t.run((ctx) =>
      certifyDay(ctx, storeId, "2026-07-01", 1, [
        { productSkuId: skuId!, unitsSold: 2, unitsReturned: 0 },
      ]),
    );
    const { requestKey, header } = await admitOne(
      t,
      storeId,
      "2026-07-01",
      "2026-07-01",
    );

    for (const page of [0, -1, 1.5, Number.NaN, Infinity, 2 ** 53]) {
      await expect(
        t.run((ctx) =>
          handlerOf(getMovementRangePage)(ctx, { storeId, requestKey, page }),
        ),
      ).rejects.toThrow(/positive integer/);
    }

    // Before completion: an honest pending shape with no rows or pages.
    const pending = await t.run((ctx) =>
      handlerOf(getMovementRangePage)(ctx, { storeId, requestKey, page: 5 }),
    );
    expect(pending).toMatchObject({
      lifecycle: { state: "queued_pending" },
      page: 1,
      pageCount: 0,
      rows: [],
    });

    await drive(t, header._id);
    // An out-of-range page canonicalizes against the authoritative count.
    const canonical = await t.run((ctx) =>
      handlerOf(getMovementRangePage)(ctx, {
        storeId,
        requestKey,
        page: 999,
      }),
    );
    expect(canonical.page).toBe(1);
    expect(canonical.pageCount).toBe(1);
    expect(canonical.rows).toHaveLength(1);
  });

  it("getMovementRange exposes only the sanitized public lifecycle", async () => {
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
      handlerOf(getMovementRange)(ctx, { storeId, requestKey }),
    );
    expect(pendingStatus).toEqual({
      requestKey,
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      lifecycle: { state: "queued_pending" },
    });

    await drive(t, header._id);
    const completedStatus = await t.run((ctx) =>
      handlerOf(getMovementRange)(ctx, { storeId, requestKey }),
    );
    expect(completedStatus!.lifecycle).toMatchObject({
      state: "completed",
      pageCount: 1,
      totals: { skuCount: 0 },
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
        handlerOf(getMovementRange)(ctx, { storeId, requestKey }),
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cleanup sizing
// ---------------------------------------------------------------------------

describe("cleanup budget", () => {
  it("steady-state cleanup throughput exceeds steady-state child creation", () => {
    const ticksPerDay = (24 * 60 * 60 * 1000) / REPORTS_SWEEP_INTERVAL_MS;
    const deletableChildrenPerDay = ticksPerDay * MOVEMENT_CLEANUP_CHILD_BATCH;
    const createdChildrenPerDay =
      MOVEMENT_STEADY_STATE_REQUESTS_PER_DAY *
      MOVEMENT_STEADY_STATE_CHILDREN_PER_REQUEST;
    expect(deletableChildrenPerDay).toBeGreaterThan(createdChildrenPerDay);
  });

  it("expiry lifetimes are inherited: children carry the header's expiresAt", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    allow(storeId);
    const [skuId] = await seedSkus(t, storeId, 1);
    await t.run((ctx) =>
      certifyDay(ctx, storeId, "2026-07-01", 1, [
        { productSkuId: skuId!, unitsSold: 2, unitsReturned: 0 },
      ]),
    );
    const { header } = await admitOne(t, storeId, "2026-07-01", "2026-07-01");
    await drive(t, header._id);
    const child = await t.run((ctx) =>
      ctx.db
        .query("reportRangeMovementSku")
        .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
          q.eq("storeId", storeId).eq("rangeResultId", header._id),
        )
        .unique(),
    );
    expect(child!.expiresAt).toBe(header.expiresAt);
    expect(header.expiresAt - header.requestedAt).toBe(REPORT_RANGE_TTL_MS);
  });
});
