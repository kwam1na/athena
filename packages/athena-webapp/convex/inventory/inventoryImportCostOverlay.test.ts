import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const admissionMocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireReportingStoreAccess: vi.fn(),
}));

vi.mock("../sharedDemo/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sharedDemo/actor")>()),
  getSharedDemoActorWithCtx: admissionMocks.getSharedDemoActorWithCtx,
}));

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    admissionMocks.requireAuthenticatedAthenaUserWithCtx,
}));

vi.mock("../reporting/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../reporting/access")>()),
  requireReportingStoreAccess: admissionMocks.requireReportingStoreAccess,
}));

import {
  abandonCostOverlayRun,
  assertCostOverlayTransition,
  assertCostOverlayActiveRunCapacity,
  buildCostOverlaySourceDescriptor,
  assertConstructionCheckpoint,
  buildCostOverlayActorAuditFields,
  buildCostOverlayCreateRequestFingerprint,
  buildCostOverlayDecisionTransition,
  classifyCostOverlayRetryableWork,
  confirmCostOverlayApply,
  costOverlayRowMatchesScope,
  createCostOverlayRun,
  resolveCostOverlayRunFromUrl,
  getCostOverlaySourceProjectionVersion,
  prepareCostOverlayRun,
  refreshCostOverlayUndoPreview,
  reopenCostOverlayRun,
  requestCostOverlayUndo,
  resolveCostOverlayAbandonResult,
  resolveCostOverlayCreateReplay,
  retryCostOverlayWork,
  scheduleCostOverlayContinuation,
  listCostOverlayRowsPageWithScope,
  listRecentCostOverlayRunsWithActive,
  processCostOverlayBulkDecision,
  readCostOverlayConstructionAnchors,
  appendCostOverlayConstructionBatch,
  updateCostOverlayDecision,
  updateCostOverlayDecisionsBulk,
} from "./inventoryImportCostOverlay";
import schema from "../schema";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("cost overlay row filters", () => {
  it("matches only rows with known unequal legacy and Athena costs", () => {
    const row = {
      barcode: undefined,
      currentUnitCostMinor: 1_000,
      decision: "not_selected" as const,
      eligibility: "eligible" as const,
      normalizedCostMinor: 1_250,
      productName: "Straight bob",
      sku: "BOB-12",
      sourceRowKey: "source-1",
      workStatus: undefined,
    };

    expect(
      costOverlayRowMatchesScope(row, { filter: "different" }),
    ).toBe(true);
    expect(
      costOverlayRowMatchesScope(
        { ...row, normalizedCostMinor: 1_000 },
        { filter: "different" },
      ),
    ).toBe(false);
    expect(
      costOverlayRowMatchesScope(
        { ...row, currentUnitCostMinor: undefined },
        { filter: "different" },
      ),
    ).toBe(false);
  });
});

type OverlayTestRow = Record<string, unknown> & { _id: string };

function createPublicMutationHarness(
  seed: Partial<Record<string, OverlayTestRow[]>> = {},
) {
  const tables = new Map<string, Map<string, OverlayTestRow>>();
  const scheduled: Array<{
    args: Record<string, unknown>;
    delay: number;
    name: string;
  }> = [];

  const tableFor = (table: string) => {
    if (!tables.has(table)) tables.set(table, new Map());
    return tables.get(table)!;
  };
  for (const [tableName, rows] of Object.entries(seed)) {
    for (const row of rows ?? []) {
      tableFor(tableName).set(row._id, { ...row });
    }
  }

  const db = {
    normalizeId(table: string, id: string) {
      return table === "inventoryImportCostOverlayRun" &&
        tableFor(table).has(id)
        ? id
        : null;
    },
    async get(table: string, id: string) {
      return tableFor(table).get(id) ?? null;
    },
    async insert(table: string, value: Record<string, unknown>) {
      const id = `${table}-${tableFor(table).size + 1}`;
      tableFor(table).set(id, { _id: id, ...value });
      return id;
    },
    async patch(table: string, id: string, patch: Record<string, unknown>) {
      const current = tableFor(table).get(id);
      if (!current) throw new Error(`Missing ${table}:${id}`);
      Object.assign(current, patch);
    },
    query(table: string) {
      const filters: Array<[string, unknown]> = [];
      let descending = false;
      const rows = () => {
        const filtered = Array.from(tableFor(table).values()).filter((row) =>
          filters.every(([field, value]) => row[field] === value),
        );
        return filtered.sort((left, right) => {
          const difference =
            Number(left.createdAt ?? left.updatedAt ?? 0) -
            Number(right.createdAt ?? right.updatedAt ?? 0);
          return descending ? -difference : difference;
        });
      };
      const chain = {
        withIndex(
          _name: string,
          callback: (q: {
            eq(field: string, value: unknown): unknown;
          }) => unknown,
        ) {
          const q = {
            eq(field: string, value: unknown) {
              filters.push([field, value]);
              return q;
            },
          };
          callback(q);
          return chain;
        },
        order(direction: "asc" | "desc") {
          descending = direction === "desc";
          return chain;
        },
        async first() {
          return rows()[0] ?? null;
        },
        async take(limit: number) {
          return rows().slice(0, limit);
        },
      };
      return chain;
    },
  };
  const ctx = {
    auth: { getUserIdentity: vi.fn(async () => ({ subject: "operator" })) },
    db,
    scheduler: {
      async runAfter(
        delay: number,
        reference: Parameters<typeof getFunctionName>[0],
        args: Record<string, unknown>,
      ) {
        scheduled.push({ args, delay, name: getFunctionName(reference) });
      },
    },
  };

  return {
    ctx,
    scheduled,
    row(table: string, id: string) {
      return tableFor(table).get(id);
    },
  };
}

function overlayRun(overrides: Record<string, unknown> = {}): OverlayTestRow {
  return {
    _id: "run-1",
    constructionComplete: true,
    decisionRevision: 4,
    epoch: 2,
    organizationId: "org-1",
    selectedRowCount: 1,
    status: "ready",
    storeId: "store-1",
    updatedAt: Date.now() - 120_000,
    ...overrides,
  };
}

describe("inventory import cost overlay contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T14:00:00.000Z"));
    admissionMocks.getSharedDemoActorWithCtx.mockReset();
    admissionMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    admissionMocks.requireAuthenticatedAthenaUserWithCtx.mockReset();
    admissionMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "operator-1",
    });
    admissionMocks.requireReportingStoreAccess.mockReset();
    admissionMocks.requireReportingStoreAccess.mockResolvedValue({
      athenaUser: { _id: "operator-1" },
      store: {
        _id: "store-1",
        currency: " ghS ",
        organizationId: "org-1",
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("owns the source projection version on the server", () => {
    expect(getCostOverlaySourceProjectionVersion()).toBe("1");
  });

  it("loads onboarded lineage for the store instead of the selected review version", async () => {
    const withIndex = vi.fn(
      (
        _name: string,
        applyIndex: (q: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown,
      ) => {
        const q = { eq: vi.fn(() => q) };
        applyIndex(q);
        return {
          paginate: vi.fn(async () => ({
            continueCursor: "",
            isDone: true,
            page: [],
          })),
        };
      },
    );

    await getHandler(readCostOverlayConstructionAnchors)(
      {
        db: {
          get: vi.fn(async () => ({
            _id: "run-1",
            reviewVersionId: "review-30",
            status: "draft",
            storeId: "store-1",
          })),
          query: vi.fn(() => ({ withIndex })),
        },
      },
      {
        paginationOpts: { cursor: null, numItems: 100 },
        runId: "run-1",
      },
    );

    expect(withIndex).toHaveBeenCalledWith("by_storeId", expect.any(Function));
  });

  it("resolves URL run ids without admitting malformed values to typed queries", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [
        overlayRun({
          bulkDecisionRequestKey: "bulk-a",
          bulkDecisionStatus: "processing",
        }),
      ],
    });

    await expect(
      getHandler(resolveCostOverlayRunFromUrl)(harness.ctx, {
        runId: " malformed ",
        storeId: "store-1",
      }),
    ).resolves.toBeNull();
    await expect(
      getHandler(resolveCostOverlayRunFromUrl)(harness.ctx, {
        runId: " run-1 ",
        storeId: "store-1",
      }),
    ).resolves.toMatchObject({
      _id: "run-1",
      retryableWork: "bulk decision",
      status: "ready",
    });
    expect(admissionMocks.requireReportingStoreAccess).toHaveBeenCalledWith(
      expect.anything(),
      "store-1",
    );
  });

  it("derives create replay identity from the exact review and column", () => {
    const first = buildCostOverlayCreateRequestFingerprint({
      reviewVersionId: "review-1",
      selectedColumn: { kind: "csv", label: "Legacy Cost", ordinal: 1 },
    });
    expect(
      buildCostOverlayCreateRequestFingerprint({
        reviewVersionId: "review-1",
        selectedColumn: { kind: "csv", label: "Legacy Cost", ordinal: 2 },
      }),
    ).not.toBe(first);
    expect(
      buildCostOverlayCreateRequestFingerprint({
        reviewVersionId: "review-2",
        selectedColumn: { kind: "csv", label: "Legacy Cost", ordinal: 1 },
      }),
    ).not.toBe(first);
  });

  it("returns a bounded legacy source descriptor without raw review payload", () => {
    const descriptor = buildCostOverlaySourceDescriptor({
      _id: "review-1" as never,
      fileName: "legacy.csv",
      rawContent: `sku,Legacy Cost\nA,${"4".repeat(500)}`,
      rowCount: 1,
      sourceColumns: undefined,
      sourceFormat: "csv",
      sourceProjectionVersion: undefined,
      versionNumber: 3,
    });

    expect(descriptor).toMatchObject({
      descriptorStatus: "available",
      reviewVersionId: "review-1",
      sourceProjectionVersion: 1,
      versionNumber: 3,
    });
    expect(descriptor.columns[1].sampleValues[0]).toHaveLength(160);
    expect(descriptor.columns[1].sampleValidity).toEqual({
      invalid: 1,
      valid: 0,
    });
    expect(descriptor).not.toHaveProperty("rawContent");
  });

  it("classifies only stale active checkpoints as retryable", () => {
    const now = 100_000;
    expect(
      classifyCostOverlayRetryableWork(
        {
          constructionComplete: false,
          status: "draft",
          updatedAt: now - 60_001,
        },
        now,
      ),
    ).toBe("construction");
    expect(
      classifyCostOverlayRetryableWork(
        {
          bulkDecisionStatus: "processing",
          constructionComplete: true,
          status: "ready",
          updatedAt: now - 60_001,
        },
        now,
      ),
    ).toBe("bulk decision");
    expect(
      classifyCostOverlayRetryableWork(
        {
          bulkDecisionStatus: "processing",
          constructionComplete: true,
          status: "ready",
          updatedAt: now - 10,
        },
        now,
      ),
    ).toBeNull();
    expect(
      classifyCostOverlayRetryableWork(
        {
          constructionComplete: true,
          status: "applying",
          updatedAt: now - 10,
        },
        now,
      ),
    ).toBeNull();
    expect(
      classifyCostOverlayRetryableWork(
        {
          constructionComplete: true,
          status: "applied",
          updatedAt: 0,
        },
        now,
      ),
    ).toBeNull();
  });

  it("continues sparse filtered scans without multiple database paginations", async () => {
    const nonMatches = Array.from({ length: 10 }, (_, rowOrdinal) => ({
      _id: `row-${rowOrdinal}`,
      rowOrdinal,
      productName: `Alpha ${rowOrdinal}`,
      sourceRowKey: String(rowOrdinal),
      eligibility: "eligible",
      decision: "not_selected",
    }));
    const take = vi
      .fn()
      .mockResolvedValueOnce(nonMatches)
      .mockResolvedValueOnce([
        {
          _id: "row-needle",
          rowOrdinal: 10,
          productName: "Needle Product",
          sourceRowKey: "10",
          eligibility: "eligible",
          decision: "not_selected",
        },
      ]);
    const range = {
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
    };
    const ctx = {
      db: {
        query: () => ({
          withIndex: (
            _index: string,
            buildRange: (query: typeof range) => unknown,
          ) => {
            buildRange(range);
            return { take };
          },
        }),
      },
    } as never;

    const firstPage = await listCostOverlayRowsPageWithScope(ctx, {
      runId: "run-1" as never,
      paginationOpts: { cursor: null, numItems: 1 },
      search: "needle",
    });
    expect(firstPage.page).toEqual([]);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await listCostOverlayRowsPageWithScope(ctx, {
      runId: "run-1" as never,
      paginationOpts: {
        cursor: firstPage.continueCursor,
        numItems: 1,
      },
      search: "needle",
    });
    expect(secondPage.page.map((row) => row._id)).toEqual(["row-needle"]);
    expect(secondPage.isDone).toBe(true);
    expect(take).toHaveBeenCalledTimes(2);
    expect(range.gt).toHaveBeenCalledWith("rowOrdinal", 9);
  });

  it("expires incompatible pagination cursors without replaying earlier rows", async () => {
    const take = vi.fn();
    const result = await listCostOverlayRowsPageWithScope(
      {
        db: {
          query: () => ({
            withIndex: () => ({ take }),
          }),
        },
      } as never,
      {
        runId: "run-1" as never,
        paginationOpts: { cursor: "legacy-native-cursor", numItems: 15 },
      },
    );

    expect(result).toEqual({
      continueCursor: "legacy-native-cursor",
      isDone: true,
      page: [],
    });
    expect(take).not.toHaveBeenCalled();
  });

  it("processes bulk decisions in bounded continuation batches", async () => {
    const rows = Array.from({ length: 51 }, (_, rowOrdinal) => ({
      _id: `row-${rowOrdinal}`,
      rowOrdinal,
      productName: `Product ${rowOrdinal}`,
      sourceRowKey: String(rowOrdinal),
      eligibility: "eligible",
      decision: "not_selected",
      currentUnitCostMinor: undefined,
    }));
    const run = {
      _id: "run-1",
      status: "ready",
      totalRowCount: 51,
      decisionRevision: 4,
      selectedRowCount: 0,
      bulkDecisionStatus: "processing",
      bulkDecisionRequestKey: "bulk-1",
      bulkDecision: "selected_missing_cost",
      bulkDecisionFilter: "all",
      bulkDecisionCursor: 0,
    };
    const request = {
      _id: "request-1",
      runId: "run-1",
      requestKey: "bulk-1",
      requestFingerprint:
        '{"decision":"selected_missing_cost","filter":"all","search":""}',
      status: "processing",
      updatedCount: 0,
    };
    const runAfter = vi.fn();
    const handler = getHandler(processCostOverlayBulkDecision);
    await expect(
      handler(
        {
          db: {
            get: vi.fn(async () => run),
            query: () => ({
              withIndex: () => ({ first: async () => request }),
            }),
          },
          scheduler: { runAfter },
        },
        { generation: 2, runId: "run-1", requestKey: "bulk-1" },
      ),
    ).resolves.toEqual({ disposition: "stale" });
    expect(runAfter).not.toHaveBeenCalled();

    const result = await handler(
      {
        db: {
          get: vi.fn(async () => run),
          patch: vi.fn(async (table, id, value) => {
            if (table === "inventoryImportCostOverlayRun")
              Object.assign(run, value);
            else if (table === "inventoryImportCostOverlayBulkDecisionRequest")
              Object.assign(request, value);
            else
              Object.assign(
                rows.find((row) => row._id === id)!,
                value,
              );
          }),
          query: (table: string) => ({
            withIndex: () =>
              table === "inventoryImportCostOverlayBulkDecisionRequest"
                ? { first: async () => request }
                : {
                    take: async (limit: number) =>
                      rows.slice(
                        Number(run.bulkDecisionCursor ?? 0),
                        Number(run.bulkDecisionCursor ?? 0) + limit,
                      ),
                  },
          }),
        },
        scheduler: { runAfter },
      },
      { generation: 1, runId: "run-1", requestKey: "bulk-1" },
    );
    expect(result).toEqual({ disposition: "continued", updatedCount: 50 });
    expect(run.selectedRowCount).toBe(50);
    expect(run.bulkDecisionCursor).toBe(50);
    expect(request).toMatchObject({
      status: "processing",
      updatedCount: 50,
    });
    expect(runAfter).toHaveBeenCalledTimes(1);

    await expect(
      handler(
        {
          db: {
            get: vi.fn(async () => run),
            patch: vi.fn(async (table, id, value) => {
              if (table === "inventoryImportCostOverlayRun")
                Object.assign(run, value);
              else if (
                table === "inventoryImportCostOverlayBulkDecisionRequest"
              )
                Object.assign(request, value);
              else
                Object.assign(
                  rows.find((row) => row._id === id)!,
                  value,
                );
            }),
            query: (table: string) => ({
              withIndex: () =>
                table === "inventoryImportCostOverlayBulkDecisionRequest"
                  ? { first: async () => request }
                  : {
                      take: async (limit: number) =>
                        rows.slice(
                          Number(run.bulkDecisionCursor ?? 0),
                          Number(run.bulkDecisionCursor ?? 0) + limit,
                        ),
                    },
            }),
          },
          scheduler: { runAfter },
        },
        { generation: 1, runId: "run-1", requestKey: "bulk-1" },
      ),
    ).resolves.toEqual({ disposition: "completed", updatedCount: 1 });
    expect(request).toMatchObject({
      completedAt: Date.now(),
      status: "completed",
      updatedCount: 51,
    });
  });

  it("bulk-overwrites only compatible rows and reports only actual changes", async () => {
    const rows = [
      {
        _id: "known-row",
        rowOrdinal: 0,
        productName: "Known",
        sourceRowKey: "1",
        eligibility: "eligible",
        decision: "not_selected",
        currentUnitCostMinor: 0,
      },
      {
        _id: "missing-row",
        rowOrdinal: 1,
        productName: "Missing",
        sourceRowKey: "2",
        eligibility: "eligible",
        decision: "not_selected",
        currentUnitCostMinor: undefined,
      },
      {
        _id: "ineligible-row",
        rowOrdinal: 2,
        productName: "Ineligible",
        sourceRowKey: "3",
        eligibility: "ineligible",
        decision: "ineligible",
        currentUnitCostMinor: 700,
      },
      {
        _id: "already-overwrite-row",
        rowOrdinal: 3,
        productName: "Already selected",
        sourceRowKey: "4",
        eligibility: "eligible",
        decision: "overwrite_selected",
        currentUnitCostMinor: 900,
      },
    ];
    const run = {
      _id: "run-1",
      status: "ready",
      totalRowCount: rows.length,
      decisionRevision: 4,
      selectedRowCount: 1,
      bulkDecisionStatus: "processing",
      bulkDecisionRequestKey: "bulk-1",
      bulkDecision: "overwrite_selected",
      bulkDecisionFilter: "all",
      bulkDecisionCursor: 0,
    };
    const request = {
      _id: "request-1",
      runId: "run-1",
      requestKey: "bulk-1",
      requestFingerprint:
        '{"decision":"overwrite_selected","filter":"all","search":""}',
      generation: 1,
      status: "processing",
      updatedCount: 0,
    };

    const result = await getHandler(processCostOverlayBulkDecision)(
      {
        db: {
          get: vi.fn(async () => run),
          patch: vi.fn(async (table, id, value) => {
            if (table === "inventoryImportCostOverlayRun") {
              Object.assign(run, value);
            } else if (
              table === "inventoryImportCostOverlayBulkDecisionRequest"
            ) {
              Object.assign(request, value);
            } else {
              Object.assign(
                rows.find((row) => row._id === id)!,
                value,
              );
            }
          }),
          query: (table: string) => ({
            withIndex: () =>
              table === "inventoryImportCostOverlayBulkDecisionRequest"
                ? { first: async () => request }
                : { take: async () => rows },
          }),
        },
        scheduler: { runAfter: vi.fn() },
      },
      { generation: 1, runId: "run-1", requestKey: "bulk-1" },
    );

    expect(result).toEqual({ disposition: "completed", updatedCount: 1 });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: "known-row",
          decision: "overwrite_selected",
        }),
        expect.objectContaining({
          _id: "missing-row",
          decision: "not_selected",
        }),
        expect.objectContaining({
          _id: "ineligible-row",
          decision: "ineligible",
        }),
      ]),
    );
    expect(request).toMatchObject({ status: "completed", updatedCount: 1 });
    expect(run).toMatchObject({
      decisionRevision: 5,
      selectedRowCount: 2,
    });
  });

  it("keeps construction writes behind an exact epoch and cursor checkpoint", () => {
    expect(() =>
      assertConstructionCheckpoint({
        actualCursor: 20,
        actualEpoch: 3,
        expectedCursor: 10,
        expectedEpoch: 3,
        status: "draft",
      }),
    ).toThrow("Cost overlay construction checkpoint is stale.");

    expect(() =>
      assertConstructionCheckpoint({
        actualCursor: 20,
        actualEpoch: 3,
        expectedCursor: 20,
        expectedEpoch: 2,
        status: "draft",
      }),
    ).toThrow("Cost overlay construction checkpoint is stale.");
  });

  it("locks a partial construction to the complete source digest", async () => {
    const run = {
      _id: "run-1",
      constructionCursor: 0,
      decisionRevision: 0,
      eligibleRowCount: 0,
      epoch: 1,
      ineligibleRowCount: 0,
      organizationId: "org-1",
      selectedRowCount: 0,
      sourceDigest: undefined,
      constructionSnapshotDigest: undefined,
      constructionSnapshotRowCount: undefined,
      status: "draft",
      storeId: "store-1",
      totalRowCount: 0,
    };
    const handler = getHandler(appendCostOverlayConstructionBatch);
    const ctx = {
      db: {
        get: vi.fn(async () => run),
        insert: vi.fn(async () => "row-1"),
        patch: vi.fn(async (_table, _id, patch) => Object.assign(run, patch)),
      },
    };
    const row = {
      decision: "not_selected",
      eligibility: "eligible",
      rowOrdinal: 0,
    };
    await handler(ctx, {
      expectedCursor: 0,
      expectedEpoch: 1,
      isDone: false,
      rows: [row],
      runId: "run-1",
      sourceDigest: "complete-source-a",
      constructionSnapshotDigest: "complete-snapshot-a",
      constructionSnapshotRowCount: 2,
    });
    expect(run.sourceDigest).toBe("complete-source-a");
    expect(run.constructionSnapshotDigest).toBe("complete-snapshot-a");
    await expect(
      handler(ctx, {
        expectedCursor: 1,
        expectedEpoch: 1,
        isDone: true,
        rows: [],
        runId: "run-1",
        sourceDigest: "complete-source-b",
        constructionSnapshotDigest: "complete-snapshot-a",
        constructionSnapshotRowCount: 2,
      }),
    ).rejects.toThrow("Cost overlay construction source changed.");
    await expect(
      handler(ctx, {
        expectedCursor: 1,
        expectedEpoch: 1,
        isDone: true,
        rows: [],
        runId: "run-1",
        sourceDigest: "complete-source-a",
        constructionSnapshotDigest: "complete-snapshot-b",
        constructionSnapshotRowCount: 2,
      }),
    ).rejects.toThrow("Cost overlay construction snapshot changed.");
  });

  it("allows only the owned draft-ready-prepared lifecycle", () => {
    expect(() => assertCostOverlayTransition("draft", "ready")).not.toThrow();
    expect(() =>
      assertCostOverlayTransition("ready", "preparing"),
    ).not.toThrow();
    expect(() =>
      assertCostOverlayTransition("preparing", "prepared"),
    ).not.toThrow();
    expect(() =>
      assertCostOverlayTransition("prepared", "ready"),
    ).not.toThrow();
    expect(() => assertCostOverlayTransition("preparing", "abandoned")).toThrow(
      "Invalid cost overlay lifecycle transition.",
    );
    expect(() => assertCostOverlayTransition("abandoned", "ready")).toThrow(
      "Invalid cost overlay lifecycle transition.",
    );
  });

  it("increments deterministic decision evidence and invalidates preparation", () => {
    expect(
      buildCostOverlayDecisionTransition({
        currentDecision: "not_selected",
        currentRevision: 7,
        nextDecision: "overwrite_selected",
      }),
    ).toMatchObject({
      changed: true,
      decision: "overwrite_selected",
      decisionRevision: 8,
      selectedCountDelta: 1,
      rowPatch: {
        decision: "overwrite_selected",
        decisionRevision: 8,
        manifestEntryDigest: undefined,
        manifestOrdinal: undefined,
      },
    });
  });

  it("reschedules authoritative construction and preparation continuations", async () => {
    const runAfter = vi.fn();

    await scheduleCostOverlayContinuation(
      { scheduler: { runAfter } } as never,
      {
        _id: "run-draft",
        constructionComplete: false,
        epoch: 3,
        status: "draft",
      } as never,
    );
    await scheduleCostOverlayContinuation(
      { scheduler: { runAfter } } as never,
      {
        _id: "run-preparing",
        epoch: 4,
        preparedDecisionRevision: 9,
        status: "preparing",
      } as never,
    );

    expect(runAfter.mock.calls[0]).toMatchObject([
      0,
      expect.any(Object),
      { expectedEpoch: 3, runId: "run-draft" },
    ]);
    expect(runAfter.mock.calls[1]).toMatchObject([
      0,
      expect.any(Object),
      {
        expectedDecisionRevision: 9,
        expectedEpoch: 4,
        runId: "run-preparing",
      },
    ]);
  });

  it("requeues an exact incomplete-draft create replay", async () => {
    const runAfter = vi.fn();
    const result = await resolveCostOverlayCreateReplay(
      {
        db: { patch: vi.fn() },
        scheduler: { runAfter },
      } as never,
      {
        _id: "run-draft",
        constructionComplete: false,
        epoch: 2,
        requestFingerprint: "fingerprint",
        status: "draft",
        updatedAt: Date.now() - 60_001,
      } as never,
      "fingerprint",
    );

    expect(result).toEqual({ runId: "run-draft", status: "draft" });
    expect(runAfter).toHaveBeenCalledOnce();
  });

  it("keeps a healthy incomplete-draft create replay on its existing chain", async () => {
    const runAfter = vi.fn();
    const patch = vi.fn();

    await expect(
      resolveCostOverlayCreateReplay(
        {
          db: { patch },
          scheduler: { runAfter },
        } as never,
        {
          _id: "run-draft",
          constructionComplete: false,
          epoch: 2,
          requestFingerprint: "fingerprint",
          status: "draft",
          updatedAt: Date.now() - 1,
        } as never,
        "fingerprint",
      ),
    ).resolves.toEqual({ runId: "run-draft", status: "draft" });

    expect(patch).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("persists the admitted apply confirmer and undo requester", () => {
    const actor = {
      athenaUserId: "admin-1",
      kind: "normal_user",
    } as const;

    expect(buildCostOverlayActorAuditFields(actor as never, "apply")).toEqual({
      applyConfirmedByUserId: "admin-1",
    });
    expect(buildCostOverlayActorAuditFields(actor as never, "undo")).toEqual({
      undoRequestedByUserId: "admin-1",
    });
  });

  it("returns the same terminal result for repeated abandon", () => {
    expect(resolveCostOverlayAbandonResult("abandoned")).toEqual({
      status: "abandoned",
    });
  });

  it("bounds active runs so discovery cannot hide unfinished work", () => {
    expect(() => assertCostOverlayActiveRunCapacity(9)).not.toThrow();
    expect(() => assertCostOverlayActiveRunCapacity(10)).toThrow(
      "Resolve an existing inventory cost overlay before starting another.",
    );
  });

  it("keeps an older active run discoverable behind ten newer terminal runs", async () => {
    const runs = [
      ...Array.from({ length: 10 }, (_, index) => ({
        _id: `terminal-${index}`,
        storeId: "store-1",
        status: "applied",
        createdAt: 100 + index,
        updatedAt: 100 + index,
      })),
      {
        _id: "active-old",
        storeId: "store-1",
        status: "applying",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const db = {
      query() {
        const matches: Record<string, unknown> = {};
        let descending = false;
        const queryApi = {
          withIndex(
            _name: string,
            callback: (q: {
              eq(field: string, value: unknown): unknown;
            }) => unknown,
          ) {
            const q = {
              eq(field: string, value: unknown) {
                matches[field] = value;
                return q;
              },
            };
            callback(q);
            return queryApi;
          },
          order(direction: "asc" | "desc") {
            descending = direction === "desc";
            return queryApi;
          },
          async take(limit: number) {
            const filtered = runs.filter((run) =>
              Object.entries(matches).every(
                ([field, value]) => run[field as keyof typeof run] === value,
              ),
            );
            if (descending) {
              filtered.sort((left, right) => right.createdAt - left.createdAt);
            }
            return filtered.slice(0, limit);
          },
        };
        return queryApi;
      },
    };

    const discovered = await listRecentCostOverlayRunsWithActive(
      { db } as never,
      "store-1" as never,
    );

    expect(discovered).toHaveLength(11);
    expect(discovered.map((run) => run._id)).toContain("active-old");
  });

  it("defines exact compound lineage lookup identity", () => {
    const indexes = ((schema as any).tables.inventoryImportProvisionalSku
      .indexes ?? []) as Array<{ indexDescriptor: string; fields: string[] }>;

    expect(indexes).toContainEqual({
      indexDescriptor: "by_storeId_reviewVersionId_productSkuId_status",
      fields: ["storeId", "reviewVersionId", "productSkuId", "status"],
    });
  });

  it("denies a shared-demo principal at the exported mutation boundary", async () => {
    admissionMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "demo-user",
      kind: "shared_demo",
      organizationId: "org-1",
      storeId: "store-1",
    });

    await expect(
      getHandler(confirmCostOverlayApply)(
        {
          auth: { getUserIdentity: vi.fn(async () => ({ subject: "demo" })) },
          db: {},
        },
        {
          expectedManifestDigest: "manifest",
          runId: "run-1",
          storeId: "store-1",
        },
      ),
    ).rejects.toThrow();
  });
});

describe("inventory import cost overlay public mutation handlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T14:00:00.000Z"));
    admissionMocks.getSharedDemoActorWithCtx.mockReset();
    admissionMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    admissionMocks.requireAuthenticatedAthenaUserWithCtx.mockReset();
    admissionMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "operator-1",
    });
    admissionMocks.requireReportingStoreAccess.mockReset();
    admissionMocks.requireReportingStoreAccess.mockResolvedValue({
      athenaUser: { _id: "operator-1" },
      store: {
        _id: "store-1",
        currency: " ghS ",
        organizationId: "org-1",
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a draft with operator evidence and schedules exact construction work", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportReviewVersion: [
        {
          _id: "review-1",
          storeId: "store-1",
          versionNumber: 7,
        },
      ],
    });

    const result = await getHandler(createCostOverlayRun)(harness.ctx, {
      requestKey: "create-1",
      reviewVersionId: "review-1",
      selectedColumn: { kind: "csv", label: "Legacy Cost", ordinal: 2 },
      storeId: "store-1",
    });

    expect(result).toEqual({
      runId: "inventoryImportCostOverlayRun-1",
      status: "draft",
    });
    expect(
      harness.row(
        "inventoryImportCostOverlayRun",
        "inventoryImportCostOverlayRun-1",
      ),
    ).toMatchObject({
      constructionComplete: false,
      constructionCursor: 0,
      createdByUserId: "operator-1",
      currencyCode: "GHS",
      decisionRevision: 0,
      eligibleRowCount: 0,
      epoch: 1,
      ineligibleRowCount: 0,
      organizationId: "org-1",
      preparationCursor: 0,
      requestKey: "create-1",
      reviewVersionId: "review-1",
      reviewVersionNumber: 7,
      selectedRowCount: 0,
      sourceProjectionVersion: "1",
      status: "draft",
      storeId: "store-1",
      totalRowCount: 0,
    });
    expect(harness.scheduled).toEqual([
      {
        args: {
          expectedEpoch: 1,
          runId: "inventoryImportCostOverlayRun-1",
        },
        delay: 0,
        name: "inventory/inventoryImportCostOverlayConstruction:constructCostOverlayRun",
      },
    ]);
  });

  it("replays an exact create and rejects conflicting request-key reuse", async () => {
    const selectedColumn = {
      kind: "csv" as const,
      label: "Legacy Cost",
      ordinal: 2,
    };
    const replay = overlayRun({
      constructionComplete: false,
      epoch: 5,
      requestFingerprint: buildCostOverlayCreateRequestFingerprint({
        reviewVersionId: "review-1",
        selectedColumn,
      }),
      requestKey: "create-1",
      status: "draft",
    });
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [replay],
      inventoryImportReviewVersion: [
        {
          _id: "review-1",
          storeId: "store-1",
          versionNumber: 7,
        },
      ],
    });

    await expect(
      getHandler(createCostOverlayRun)(harness.ctx, {
        requestKey: "create-1",
        reviewVersionId: "review-1",
        selectedColumn,
        storeId: "store-1",
      }),
    ).resolves.toEqual({ runId: "run-1", status: "draft" });
    expect(harness.scheduled[0]).toMatchObject({
      args: { expectedEpoch: 6, runId: "run-1" },
      name: "inventory/inventoryImportCostOverlayConstruction:constructCostOverlayRun",
    });

    await expect(
      getHandler(createCostOverlayRun)(harness.ctx, {
        requestKey: "create-1",
        reviewVersionId: "review-1",
        selectedColumn: { ...selectedColumn, ordinal: 3 },
        storeId: "store-1",
      }),
    ).rejects.toThrow("Cost overlay request key was reused.");
  });

  it("updates an eligible row and invalidates prepared evidence", async () => {
    const run = overlayRun({
      decisionRevision: 4,
      manifestDigest: "old-manifest",
      preparedDecisionRevision: 4,
      selectedRowCount: 1,
    });
    const row = {
      _id: "row-1",
      decision: "selected_missing_cost",
      eligibility: "eligible",
      manifestEntryDigest: "old-entry",
      manifestOrdinal: 0,
      runId: "run-1",
      storeId: "store-1",
    };
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRow: [row],
      inventoryImportCostOverlayRun: [run],
    });

    await expect(
      getHandler(updateCostOverlayDecision)(harness.ctx, {
        decision: "not_selected",
        rowId: "row-1",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).resolves.toEqual({
      decision: "not_selected",
      decisionRevision: 5,
      manifestDigest: undefined,
      preparedDecisionRevision: undefined,
    });
    expect(harness.row("inventoryImportCostOverlayRow", "row-1")).toMatchObject(
      {
        decision: "not_selected",
        decisionRevision: 5,
        manifestEntryDigest: undefined,
        manifestOrdinal: undefined,
      },
    );
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        decisionRevision: 5,
        manifestDigest: undefined,
        preparedDecisionRevision: undefined,
        selectedRowCount: 0,
      },
    );
  });

  it("excludes system-owned decisions from public command validators", () => {
    const singleArgs = String(
      (
        updateCostOverlayDecision as unknown as { exportArgs(): unknown }
      ).exportArgs(),
    );
    const bulkArgs = String(
      (
        updateCostOverlayDecisionsBulk as unknown as {
          exportArgs(): unknown;
        }
      ).exportArgs(),
    );

    expect(singleArgs).not.toContain('"value":"ineligible"');
    expect(bulkArgs).not.toContain('"value":"ineligible"');
    expect(singleArgs).toContain('"value":"selected_missing_cost"');
    expect(singleArgs).toContain('"value":"overwrite_selected"');
    expect(singleArgs).toContain('"value":"not_selected"');
    expect(bulkArgs).toContain('"value":"selected_missing_cost"');
    expect(bulkArgs).toContain('"value":"overwrite_selected"');
    expect(bulkArgs).toContain('"value":"not_selected"');
  });

  it("rejects decisions that contradict an eligible row's current-cost state", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRow: [
        {
          _id: "missing-row",
          currentUnitCostMinor: undefined,
          decision: "not_selected",
          eligibility: "eligible",
          runId: "run-1",
          storeId: "store-1",
        },
        {
          _id: "known-row",
          currentUnitCostMinor: 0,
          decision: "not_selected",
          eligibility: "eligible",
          runId: "run-1",
          storeId: "store-1",
        },
      ],
      inventoryImportCostOverlayRun: [
        overlayRun({ decisionRevision: 2, selectedRowCount: 0 }),
      ],
    });

    await expect(
      getHandler(updateCostOverlayDecision)(harness.ctx, {
        decision: "overwrite_selected",
        rowId: "missing-row",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow(
      "Cost overlay decision does not match the row's current-cost state.",
    );
    await expect(
      getHandler(updateCostOverlayDecision)(harness.ctx, {
        decision: "selected_missing_cost",
        rowId: "known-row",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow(
      "Cost overlay decision does not match the row's current-cost state.",
    );
    expect(
      harness.row("inventoryImportCostOverlayRow", "missing-row"),
    ).toMatchObject({ decision: "not_selected" });
    expect(
      harness.row("inventoryImportCostOverlayRow", "known-row"),
    ).toMatchObject({ decision: "not_selected" });
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        decisionRevision: 2,
        selectedRowCount: 0,
      },
    );
  });

  it("allows the explicit overwrite path for a known current cost", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRow: [
        {
          _id: "row-1",
          currentUnitCostMinor: 0,
          decision: "not_selected",
          eligibility: "eligible",
          runId: "run-1",
          storeId: "store-1",
        },
      ],
      inventoryImportCostOverlayRun: [
        overlayRun({ decisionRevision: 2, selectedRowCount: 0 }),
      ],
    });

    await expect(
      getHandler(updateCostOverlayDecision)(harness.ctx, {
        decision: "overwrite_selected",
        rowId: "row-1",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).resolves.toMatchObject({
      decision: "overwrite_selected",
      decisionRevision: 3,
    });
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        decisionRevision: 3,
        selectedRowCount: 1,
      },
    );
  });

  it("starts a normalized bulk request with a durable ledger and exact continuation", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [
        overlayRun({
          manifestDigest: "prepared-manifest",
          preparedDecisionRevision: 4,
        }),
      ],
    });

    await expect(
      getHandler(updateCostOverlayDecisionsBulk)(harness.ctx, {
        decision: "selected_missing_cost",
        filter: "eligible",
        requestKey: "bulk-a",
        runId: "run-1",
        search: "  Rice  ",
        storeId: "store-1",
      }),
    ).resolves.toEqual({ status: "processing", updatedCount: 0 });
    expect(
      harness.row(
        "inventoryImportCostOverlayBulkDecisionRequest",
        "inventoryImportCostOverlayBulkDecisionRequest-1",
      ),
    ).toMatchObject({
      createdAt: Date.now(),
      requestFingerprint:
        '{"decision":"selected_missing_cost","filter":"eligible","search":"Rice"}',
      requestKey: "bulk-a",
      runId: "run-1",
      status: "processing",
      updatedAt: Date.now(),
      updatedCount: 0,
    });
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        bulkDecision: "selected_missing_cost",
        bulkDecisionCursor: 0,
        bulkDecisionFilter: "eligible",
        bulkDecisionRequestKey: "bulk-a",
        bulkDecisionSearch: "Rice",
        bulkDecisionStatus: "processing",
        manifestDigest: undefined,
        preparedDecisionRevision: undefined,
      },
    );
    expect(harness.scheduled).toEqual([
      {
        args: { generation: 1, requestKey: "bulk-a", runId: "run-1" },
        delay: 0,
        name: "inventory/inventoryImportCostOverlay:processCostOverlayBulkDecision",
      },
    ]);
  });

  it("rejects a distinct bulk request while one is processing without side effects", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [
        overlayRun({
          bulkDecision: "selected_missing_cost",
          bulkDecisionCursor: 10,
          bulkDecisionRequestKey: "bulk-a",
          bulkDecisionStatus: "processing",
        }),
      ],
    });

    await expect(
      getHandler(updateCostOverlayDecisionsBulk)(harness.ctx, {
        decision: "not_selected",
        requestKey: "bulk-b",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow("A cost overlay bulk decision is already processing.");
    expect(
      harness.row(
        "inventoryImportCostOverlayBulkDecisionRequest",
        "inventoryImportCostOverlayBulkDecisionRequest-1",
      ),
    ).toBeUndefined();
    expect(harness.scheduled).toHaveLength(0);
  });

  it("replays the exact historical bulk result without changing newer decisions", async () => {
    const run = overlayRun({
      bulkDecisionRequestKey: "bulk-b",
      bulkDecisionStatus: "completed",
    });
    const row = {
      _id: "row-1",
      decision: "not_selected",
      decisionRevision: 6,
      eligibility: "eligible",
      runId: "run-1",
      storeId: "store-1",
    };
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayBulkDecisionRequest: [
        {
          _id: "request-a",
          completedAt: Date.now() - 2_000,
          createdAt: Date.now() - 3_000,
          requestFingerprint:
            '{"decision":"selected_missing_cost","filter":"all","search":""}',
          requestKey: "bulk-a",
          runId: "run-1",
          status: "completed",
          updatedAt: Date.now() - 2_000,
          updatedCount: 1,
        },
        {
          _id: "request-b",
          completedAt: Date.now() - 500,
          createdAt: Date.now() - 1_000,
          requestFingerprint:
            '{"decision":"not_selected","filter":"all","search":""}',
          requestKey: "bulk-b",
          runId: "run-1",
          status: "completed",
          updatedAt: Date.now() - 500,
          updatedCount: 2,
        },
      ],
      inventoryImportCostOverlayRow: [row],
      inventoryImportCostOverlayRun: [run],
    });

    await expect(
      getHandler(updateCostOverlayDecisionsBulk)(harness.ctx, {
        decision: "selected_missing_cost",
        requestKey: "bulk-a",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).resolves.toEqual({ status: "completed", updatedCount: 1 });
    expect(harness.row("inventoryImportCostOverlayRow", "row-1")).toMatchObject(
      {
        decision: "not_selected",
        decisionRevision: 6,
      },
    );
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        bulkDecisionRequestKey: "bulk-b",
        bulkDecisionStatus: "completed",
      },
    );
    expect(harness.scheduled).toHaveLength(0);
  });

  it("rejects conflicting historical bulk request-key reuse", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayBulkDecisionRequest: [
        {
          _id: "request-a",
          completedAt: Date.now() - 2_000,
          createdAt: Date.now() - 3_000,
          requestFingerprint:
            '{"decision":"selected_missing_cost","filter":"all","search":""}',
          requestKey: "bulk-a",
          runId: "run-1",
          status: "completed",
          updatedAt: Date.now() - 2_000,
          updatedCount: 1,
        },
      ],
      inventoryImportCostOverlayRun: [overlayRun()],
    });

    await expect(
      getHandler(updateCostOverlayDecisionsBulk)(harness.ctx, {
        decision: "not_selected",
        requestKey: "bulk-a",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow("Cost overlay bulk request key was reused.");
    expect(harness.scheduled).toHaveLength(0);
  });

  it("returns active bulk replay progress without scheduling duplicate work", async () => {
    const fingerprint =
      '{"decision":"selected_missing_cost","filter":"all","search":""}';
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayBulkDecisionRequest: [
        {
          _id: "request-a",
          createdAt: Date.now() - 1_000,
          requestFingerprint: fingerprint,
          requestKey: "bulk-a",
          runId: "run-1",
          status: "processing",
          updatedAt: Date.now() - 500,
          updatedCount: 17,
        },
      ],
      inventoryImportCostOverlayRun: [
        overlayRun({
          bulkDecisionRequestKey: "bulk-a",
          bulkDecisionStatus: "processing",
        }),
      ],
    });

    await expect(
      getHandler(updateCostOverlayDecisionsBulk)(harness.ctx, {
        decision: "selected_missing_cost",
        requestKey: "bulk-a",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).resolves.toEqual({ status: "processing", updatedCount: 17 });
    expect(harness.scheduled).toHaveLength(0);
  });

  it("claims one new generation when an exact bulk replay is stale", async () => {
    const fingerprint =
      '{"decision":"selected_missing_cost","filter":"all","search":""}';
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayBulkDecisionRequest: [
        {
          _id: "request-a",
          createdAt: Date.now() - 120_000,
          generation: 3,
          requestFingerprint: fingerprint,
          requestKey: "bulk-a",
          runId: "run-1",
          status: "processing",
          updatedAt: Date.now() - 60_001,
          updatedCount: 17,
        },
      ],
      inventoryImportCostOverlayRun: [
        overlayRun({
          bulkDecisionGeneration: 3,
          bulkDecisionRequestKey: "bulk-a",
          bulkDecisionStatus: "processing",
        }),
      ],
    });
    const args = {
      decision: "selected_missing_cost" as const,
      requestKey: "bulk-a",
      runId: "run-1",
      storeId: "store-1",
    };

    await expect(
      getHandler(updateCostOverlayDecisionsBulk)(harness.ctx, args),
    ).resolves.toEqual({ status: "processing", updatedCount: 17 });
    await expect(
      getHandler(updateCostOverlayDecisionsBulk)(harness.ctx, args),
    ).resolves.toEqual({ status: "processing", updatedCount: 17 });

    expect(harness.scheduled).toEqual([
      {
        args: { generation: 4, requestKey: "bulk-a", runId: "run-1" },
        delay: 0,
        name: "inventory/inventoryImportCostOverlay:processCostOverlayBulkDecision",
      },
    ]);
    expect(
      harness.row("inventoryImportCostOverlayBulkDecisionRequest", "request-a"),
    ).toMatchObject({ generation: 4, updatedAt: Date.now() });
  });

  it("recovers an interrupted same-key undo preview and keeps a healthy replay quiet", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [
        overlayRun({
          status: "applied",
          undoPreviewCursor: 10,
          undoPreviewGeneration: 2,
          undoPreviewHeartbeatAt: Date.now() - 60_001,
          undoPreviewRequestKey: "preview-a",
          undoPreviewStatus: "processing",
        }),
      ],
    });
    const args = {
      requestKey: "preview-a",
      runId: "run-1",
      storeId: "store-1",
    };

    await expect(
      getHandler(refreshCostOverlayUndoPreview)(harness.ctx, args),
    ).resolves.toEqual({ status: "processing" });
    await expect(
      getHandler(refreshCostOverlayUndoPreview)(harness.ctx, args),
    ).resolves.toEqual({ status: "processing" });

    expect(harness.scheduled).toEqual([
      {
        args: { generation: 3, requestKey: "preview-a", runId: "run-1" },
        delay: 0,
        name: "inventory/inventoryImportCostOverlayWork:processCostOverlayUndoPreviewBatch",
      },
    ]);
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        undoPreviewCursor: 10,
        undoPreviewGeneration: 3,
        undoPreviewHeartbeatAt: Date.now(),
      },
    );
  });

  it("rejects stale and ineligible decision edits without persisting changes", async () => {
    const run = overlayRun({ decisionRevision: 2 });
    const row = {
      _id: "row-1",
      decision: "ineligible",
      eligibility: "ineligible",
      runId: "run-1",
      storeId: "store-1",
    };
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRow: [row],
      inventoryImportCostOverlayRun: [run],
    });

    await expect(
      getHandler(updateCostOverlayDecision)(harness.ctx, {
        decision: "not_selected",
        rowId: "row-1",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow("Ineligible cost overlay rows cannot be changed.");
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toEqual(run);

    const staleHarness = createPublicMutationHarness({
      inventoryImportCostOverlayRow: [row],
      inventoryImportCostOverlayRun: [
        overlayRun({ decisionRevision: 2, status: "prepared" }),
      ],
    });
    await expect(
      getHandler(updateCostOverlayDecision)(staleHarness.ctx, {
        decision: "not_selected",
        rowId: "row-1",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow("Cost overlay decisions are not editable.");
  });

  it("prepares from the exact decision checkpoint and resets manifest counters", async () => {
    const run = overlayRun({
      decisionRevision: 6,
      epoch: 3,
      impactAfterMinor: 900,
      impactBeforeMinor: 400,
      preparationCursor: 12,
      selectedRowCount: 4,
    });
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [run],
    });

    await expect(
      getHandler(prepareCostOverlayRun)(harness.ctx, {
        expectedDecisionRevision: 6,
        runId: "run-1",
        storeId: "store-1",
      }),
    ).resolves.toEqual({ status: "preparing" });
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        impactAfterMinor: 0,
        impactBeforeMinor: 0,
        manifestDigest: "",
        preparationCursor: 0,
        preparedDecisionRevision: 6,
        selectedRowCount: 0,
        status: "preparing",
      },
    );
    expect(harness.scheduled).toEqual([
      {
        args: {
          expectedDecisionRevision: 6,
          expectedEpoch: 3,
          runId: "run-1",
        },
        delay: 0,
        name: "inventory/inventoryImportCostOverlayWork:prepareCostOverlayManifest",
      },
    ]);
  });

  it("rejects a stale preparation checkpoint without scheduling", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [
        overlayRun({ decisionRevision: 6, status: "ready" }),
      ],
    });

    await expect(
      getHandler(prepareCostOverlayRun)(harness.ctx, {
        expectedDecisionRevision: 5,
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow("Cost overlay preparation checkpoint is stale.");
    expect(harness.scheduled).toEqual([]);
  });

  it("confirms the exact manifest with actor evidence and fresh apply counters", async () => {
    const run = overlayRun({
      appliedRowCount: 9,
      applyCursor: 9,
      applyExceptionCount: 2,
      epoch: 8,
      manifestDigest: "manifest-1",
      status: "prepared",
    });
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [run],
    });

    await expect(
      getHandler(confirmCostOverlayApply)(harness.ctx, {
        expectedManifestDigest: "manifest-1",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).resolves.toEqual({ epoch: 9, status: "applying" });
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        appliedRowCount: 0,
        applyConfirmedByUserId: "operator-1",
        applyCursor: 0,
        applyExceptionCount: 0,
        epoch: 9,
        status: "applying",
      },
    );
    expect(harness.scheduled).toEqual([
      {
        args: { expectedEpoch: 9, runId: "run-1" },
        delay: 0,
        name: "inventory/inventoryImportCostOverlayWork:processCostOverlayApplyBatch",
      },
    ]);
  });

  it("rejects stale apply confirmation without actor evidence or work", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [
        overlayRun({ manifestDigest: "manifest-1", status: "prepared" }),
      ],
    });

    await expect(
      getHandler(confirmCostOverlayApply)(harness.ctx, {
        expectedManifestDigest: "manifest-stale",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow("Cost overlay apply confirmation is stale.");
    expect(
      harness.row("inventoryImportCostOverlayRun", "run-1"),
    ).not.toHaveProperty("applyConfirmedByUserId");
    expect(harness.scheduled).toEqual([]);
  });

  it("requests undo once with actor evidence and exact replay semantics", async () => {
    const run = overlayRun({
      epoch: 10,
      status: "applied_with_exceptions",
      undoCursor: 12,
      undoExceptionCount: 4,
      undoneRowCount: 8,
    });
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [run],
    });
    const handler = getHandler(requestCostOverlayUndo);
    const args = {
      requestKey: "undo-1",
      runId: "run-1",
      storeId: "store-1",
    };

    await expect(handler(harness.ctx, args)).resolves.toEqual({
      epoch: 11,
      status: "undoing",
    });
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        epoch: 11,
        status: "undoing",
        undoCursor: 0,
        undoExceptionCount: 0,
        undoRequestFingerprint:
          '{"runId":"run-1","operation":"inventory_cost_overlay_undo_v1"}',
        undoRequestKey: "undo-1",
        undoRequestedByUserId: "operator-1",
        undoneRowCount: 0,
      },
    );
    expect(harness.scheduled).toEqual([
      {
        args: { expectedEpoch: 11, runId: "run-1" },
        delay: 0,
        name: "inventory/inventoryImportCostOverlayWork:processCostOverlayUndoBatch",
      },
    ]);

    await expect(handler(harness.ctx, args)).resolves.toEqual({
      epoch: 11,
      status: "undoing",
    });
    expect(harness.scheduled).toHaveLength(1);

    await expect(
      handler(harness.ctx, { ...args, requestKey: "undo-conflict" }),
    ).rejects.toThrow("Cost overlay undo request conflicts.");
    expect(harness.scheduled).toHaveLength(1);
  });

  it("rejects undo from an invalid lifecycle without consuming the key", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [overlayRun({ status: "prepared" })],
    });

    await expect(
      getHandler(requestCostOverlayUndo)(harness.ctx, {
        requestKey: "undo-1",
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow("Cost overlay run cannot be undone.");
    expect(
      harness.row("inventoryImportCostOverlayRun", "run-1"),
    ).not.toHaveProperty("undoRequestKey");
    expect(harness.scheduled).toEqual([]);
  });

  it("retries interrupted apply work with the persisted epoch and exact worker", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [
        overlayRun({
          epoch: 14,
          status: "applying",
          updatedAt: Date.now() - 60_001,
        }),
      ],
    });

    await expect(
      getHandler(retryCostOverlayWork)(harness.ctx, {
        runId: "run-1",
        storeId: "store-1",
      }),
    ).resolves.toEqual({ epoch: 15, status: "applying", work: "apply" });
    expect(harness.scheduled).toEqual([
      {
        args: { expectedEpoch: 15, runId: "run-1" },
        delay: 0,
        name: "inventory/inventoryImportCostOverlayWork:processCostOverlayApplyBatch",
      },
    ]);

    await expect(
      getHandler(retryCostOverlayWork)(harness.ctx, {
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow(
      "Cost overlay work is still active or cannot be retried.",
    );
    expect(harness.scheduled).toHaveLength(1);
  });

  it("claims and resumes stale bulk decision work from the persisted request ledger", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayBulkDecisionRequest: [
        {
          _id: "request-a",
          createdAt: Date.now() - 120_000,
          generation: 3,
          requestFingerprint:
            '{"decision":"selected_missing_cost","filter":"all","search":""}',
          requestKey: "bulk-a",
          runId: "run-1",
          status: "processing",
          updatedAt: Date.now() - 60_001,
          updatedCount: 17,
        },
      ],
      inventoryImportCostOverlayRun: [
        overlayRun({
          bulkDecisionCursor: 75,
          bulkDecisionGeneration: 3,
          bulkDecisionRequestKey: "bulk-a",
          bulkDecisionStatus: "processing",
          status: "ready",
          updatedAt: Date.now() - 60_001,
        }),
      ],
    });
    const args = { runId: "run-1", storeId: "store-1" };

    await expect(
      getHandler(retryCostOverlayWork)(harness.ctx, args),
    ).resolves.toEqual({
      epoch: 2,
      status: "ready",
      work: "bulk decision",
    });
    await expect(
      getHandler(retryCostOverlayWork)(harness.ctx, args),
    ).rejects.toThrow(
      "Cost overlay work is still active or cannot be retried.",
    );

    expect(harness.scheduled).toEqual([
      {
        args: { generation: 4, requestKey: "bulk-a", runId: "run-1" },
        delay: 0,
        name: "inventory/inventoryImportCostOverlay:processCostOverlayBulkDecision",
      },
    ]);
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        bulkDecisionCursor: 75,
        bulkDecisionGeneration: 4,
        updatedAt: Date.now(),
      },
    );
    expect(
      harness.row("inventoryImportCostOverlayBulkDecisionRequest", "request-a"),
    ).toMatchObject({ generation: 4, updatedAt: Date.now() });
  });

  it("does not recover healthy bulk decision work", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayBulkDecisionRequest: [
        {
          _id: "request-a",
          createdAt: Date.now() - 1_000,
          generation: 3,
          requestFingerprint:
            '{"decision":"selected_missing_cost","filter":"all","search":""}',
          requestKey: "bulk-a",
          runId: "run-1",
          status: "processing",
          updatedAt: Date.now() - 10,
          updatedCount: 17,
        },
      ],
      inventoryImportCostOverlayRun: [
        overlayRun({
          bulkDecisionCursor: 75,
          bulkDecisionGeneration: 3,
          bulkDecisionRequestKey: "bulk-a",
          bulkDecisionStatus: "processing",
          status: "ready",
          updatedAt: Date.now() - 10,
        }),
      ],
    });

    await expect(
      getHandler(retryCostOverlayWork)(harness.ctx, {
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow(
      "Cost overlay work is still active or cannot be retried.",
    );
    expect(harness.scheduled).toEqual([]);
    expect(
      harness.row("inventoryImportCostOverlayBulkDecisionRequest", "request-a"),
    ).toMatchObject({ generation: 3, updatedAt: Date.now() - 10 });
  });

  it("rejects retry while resumable work is still fresh", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [
        overlayRun({
          epoch: 14,
          status: "applying",
          updatedAt: Date.now() - 1,
        }),
      ],
    });

    await expect(
      getHandler(retryCostOverlayWork)(harness.ctx, {
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow(
      "Cost overlay work is still active or cannot be retried.",
    );
    expect(harness.scheduled).toEqual([]);
  });

  it("reopens prepared work and clears every preparation artifact", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [
        overlayRun({
          epoch: 4,
          impactAfterMinor: 800,
          impactBeforeMinor: 300,
          largestImpacts: [{ deltaMinor: 500 }],
          manifestDigest: "manifest",
          preparationCursor: 5,
          preparedAt: Date.now() - 1_000,
          preparedDecisionRevision: 4,
          status: "prepared",
        }),
      ],
    });

    await expect(
      getHandler(reopenCostOverlayRun)(harness.ctx, {
        runId: "run-1",
        storeId: "store-1",
      }),
    ).resolves.toEqual({ status: "ready" });
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        epoch: 5,
        impactAfterMinor: undefined,
        impactBeforeMinor: undefined,
        largestImpacts: undefined,
        manifestDigest: undefined,
        preparationCursor: 0,
        preparedAt: undefined,
        preparedDecisionRevision: undefined,
        status: "ready",
      },
    );
  });

  it("rejects reopening outside the prepared lifecycle", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [overlayRun({ status: "applied" })],
    });

    await expect(
      getHandler(reopenCostOverlayRun)(harness.ctx, {
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow("Invalid cost overlay lifecycle transition.");
  });

  it("abandons draft work with an epoch fence and replays terminal success", async () => {
    const run = overlayRun({ epoch: 2, status: "draft" });
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [run],
    });
    const handler = getHandler(abandonCostOverlayRun);
    const args = { runId: "run-1", storeId: "store-1" };

    await expect(handler(harness.ctx, args)).resolves.toEqual({
      status: "abandoned",
    });
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")).toMatchObject(
      {
        abandonedAt: Date.now(),
        epoch: 3,
        status: "abandoned",
        updatedAt: Date.now(),
      },
    );

    await expect(handler(harness.ctx, args)).resolves.toEqual({
      status: "abandoned",
    });
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")?.epoch).toBe(
      3,
    );
  });

  it("rejects abandoning active apply work", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [overlayRun({ status: "applying" })],
    });

    await expect(
      getHandler(abandonCostOverlayRun)(harness.ctx, {
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow("Invalid cost overlay lifecycle transition.");
  });

  it("rejects abandoning while a bulk decision is processing", async () => {
    const harness = createPublicMutationHarness({
      inventoryImportCostOverlayRun: [
        overlayRun({
          bulkDecisionRequestKey: "bulk-a",
          bulkDecisionStatus: "processing",
          status: "ready",
        }),
      ],
    });

    await expect(
      getHandler(abandonCostOverlayRun)(harness.ctx, {
        runId: "run-1",
        storeId: "store-1",
      }),
    ).rejects.toThrow("Cost overlay bulk decision is still processing.");
    expect(harness.row("inventoryImportCostOverlayRun", "run-1")?.status).toBe(
      "ready",
    );
  });
});
