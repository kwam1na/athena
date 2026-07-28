import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  COST_OVERLAY_CONSTRUCTION_ANCHOR_LIMIT,
  COST_OVERLAY_CONSTRUCTION_ANCHOR_PAGE_SIZE,
  COST_OVERLAY_CONSTRUCTION_BATCHES_PER_INVOCATION,
  COST_OVERLAY_CONSTRUCTION_MAX_FULL_REBUILDS,
  COST_OVERLAY_CONSTRUCTION_MAX_MUTATION_CALLS,
  COST_OVERLAY_CONSTRUCTION_MAX_QUERY_CALLS,
  COST_OVERLAY_SOURCE_RAW_VALUE_PREVIEW_MAX_BYTES,
  constructCostOverlayRun,
  costOverlayConstructionIdentity,
} from "./inventoryImportCostOverlayConstruction";
import {
  prepareCostOverlayManifest,
  processCostOverlayApplyBatch,
  processCostOverlayUndoBatch,
} from "./inventoryImportCostOverlayWork";

type Row = Record<string, unknown> & { _id: string };

function getHandler(definition: unknown) {
  return (
    definition as {
      _handler: (
        ctx: unknown,
        args: Record<string, unknown>,
      ) => Promise<unknown>;
    }
  )._handler;
}

function constructionAnchor(index: number) {
  const suffix = String(index).padStart(3, "0");
  return {
    provisionalSkuId: `provisional-${suffix}`,
    productSkuId: `sku-${suffix}`,
    rowKey: `${index + 2}:SKU-${suffix}::Product ${suffix}`,
    rowNumber: index + 2,
    status: "active" as const,
    provisionalUpdatedAt: 100 + index,
    sku: {
      inventoryCount: 2,
      productName: `Product ${suffix}`,
      quantityAvailable: 2,
      sku: `SKU-${suffix}`,
    },
  };
}

function constructionSource(rowCount: number) {
  return [
    "SKU,Legacy Cost",
    ...Array.from(
      { length: rowCount },
      (_, index) => `SKU-${String(index).padStart(3, "0")},${index + 1}.25`,
    ),
  ].join("\n");
}

function createConstructionHarness(args: {
  anchors?: ReturnType<typeof constructionAnchor>[];
  chunks?: Array<
    | { kind: "raw_content"; rawContent?: string }
    | { kind: "row_decisions" }
    | null
  >;
  rawContent?: string;
  rawContentChunkCount?: number;
  staleHeartbeatAt?: number;
  state?: Partial<{
    constructionSnapshotDigest: string;
    constructionSnapshotRowCount: number;
    cursor: number;
    epoch: number;
    sourceDigest: string;
    status: string;
  }>;
}) {
  const anchors = args.anchors ?? [];
  const chunks = args.chunks ?? [];
  const source = {
    fileName: "legacy.csv",
    payloadChunkCount: chunks.length || undefined,
    rawContent: args.rawContent,
    rawContentChunkCount: args.rawContentChunkCount,
  };
  const state = {
    cursor: 0,
    epoch: 7,
    status: "draft",
    reviewVersionId: "review-1",
    selectedColumn: { kind: "csv", label: "Legacy Cost", ordinal: 1 },
    sourceProjectionVersion: "1",
    currencyMinorUnitScale: 2,
    ...args.state,
  };
  const appended: Array<Record<string, unknown>> = [];
  const abandoned: Array<Record<string, unknown>> = [];
  const heartbeats: Array<Record<string, unknown>> = [];
  const persistedRows: Array<Record<string, unknown>> = [];
  const anchorCursors: Array<string | null> = [];
  const prefixStarts: number[] = [];
  const queryNames: string[] = [];
  const mutationNames: string[] = [];
  const scheduled: Array<{
    args: Record<string, unknown>;
    name: string;
  }> = [];
  const ctx = {
    async runQuery(
      reference: Parameters<typeof getFunctionName>[0],
      queryArgs: Record<string, unknown>,
    ) {
      const name = getFunctionName(reference);
      queryNames.push(name);
      if (name.endsWith(":readCostOverlayConstructionState")) return state;
      if (name.endsWith(":readCostOverlayReviewSource")) return source;
      if (name.endsWith(":readCostOverlayReviewSourceChunk")) {
        return chunks[queryArgs.chunkIndex as number] ?? null;
      }
      if (name.endsWith(":readCostOverlayConstructionAnchors")) {
        const paginationOpts = queryArgs.paginationOpts as {
          cursor: string | null;
          numItems: number;
        };
        anchorCursors.push(paginationOpts.cursor);
        const start =
          paginationOpts.cursor === null ? 0 : Number(paginationOpts.cursor);
        const page = anchors.slice(start, start + paginationOpts.numItems);
        const next = start + page.length;
        return {
          page,
          continueCursor: String(next),
          isDone: next >= anchors.length,
        };
      }
      if (name.endsWith(":readCostOverlayConstructionPrefixBatch")) {
        const start = queryArgs.startOrdinal as number;
        prefixStarts.push(start);
        return persistedRows.slice(start, start + 50);
      }
      throw new Error(`Unexpected query: ${name}`);
    },
    async runMutation(
      reference: Parameters<typeof getFunctionName>[0],
      mutationArgs: Record<string, unknown>,
    ) {
      const name = getFunctionName(reference);
      mutationNames.push(name);
      if (name.endsWith(":heartbeatCostOverlayConstruction")) {
        heartbeats.push(mutationArgs);
        return heartbeats.length !== args.staleHeartbeatAt &&
          state.status === "draft" &&
          state.epoch === mutationArgs.expectedEpoch
          ? { disposition: "active" }
          : { disposition: "stale" };
      }
      if (name.endsWith(":appendCostOverlayConstructionBatch")) {
        appended.push(mutationArgs);
        const rows = mutationArgs.rows as Array<Record<string, unknown>>;
        persistedRows.push(...rows);
        const result = {
          cursor: (mutationArgs.expectedCursor as number) + rows.length,
          status: mutationArgs.isDone ? "ready" : "draft",
        };
        Object.assign(state, {
          constructionSnapshotDigest:
            mutationArgs.constructionSnapshotDigest as string,
          constructionSnapshotRowCount:
            mutationArgs.constructionSnapshotRowCount as number,
          cursor: result.cursor,
          sourceDigest: mutationArgs.sourceDigest as string,
          status: result.status,
        });
        return result;
      }
      if (name.endsWith(":abandonStaleCostOverlayConstruction")) {
        abandoned.push(mutationArgs);
        return { disposition: "abandoned" };
      }
      throw new Error(`Unexpected mutation: ${name}`);
    },
    scheduler: {
      async runAfter(
        _delay: number,
        reference: Parameters<typeof getFunctionName>[0],
        scheduleArgs: Record<string, unknown>,
      ) {
        scheduled.push({
          args: scheduleArgs,
          name: getFunctionName(reference),
        });
      },
    },
  };
  return {
    abandoned,
    anchorCursors,
    appended,
    ctx,
    heartbeats,
    mutationNames,
    persistedRows,
    prefixStarts,
    queryNames,
    scheduled,
    source,
    state,
  };
}

type OrchestrationRun = Row & {
  applyCursor?: number;
  applyExceptionCount?: number;
  appliedRowCount?: number;
  decisionRevision: number;
  eligibleRowCount: number;
  epoch: number;
  ineligibleRowCount: number;
  preparationCursor: number;
  selectedRowCount: number;
  status: string;
  totalRowCount: number;
  undoCursor?: number;
  undoExceptionCount?: number;
  undoneRowCount?: number;
};

function createMutationHarness(run: OrchestrationRun, rows: Row[]) {
  const tables = {
    inventoryImportCostOverlayRow: new Map(rows.map((row) => [row._id, row])),
    inventoryImportCostOverlayRun: new Map([[run._id, run]]),
  };
  const scheduled: Array<{
    args: Record<string, unknown>;
    name: string;
  }> = [];
  const ctx = {
    db: {
      async get(table: keyof typeof tables, id: string) {
        return tables[table].get(id) ?? null;
      },
      async patch(
        table: keyof typeof tables,
        id: string,
        patch: Record<string, unknown>,
      ) {
        const current = tables[table].get(id);
        if (!current) throw new Error(`Missing ${table}:${id}`);
        Object.assign(current, patch);
      },
      query(table: keyof typeof tables) {
        const constraints: Array<{
          field: string;
          kind: "eq" | "gte";
          value: unknown;
        }> = [];
        const query = {
          withIndex(
            _name: string,
            callback: (q: {
              eq(field: string, value: unknown): unknown;
              gte(field: string, value: unknown): unknown;
            }) => unknown,
          ) {
            const q = {
              eq(field: string, value: unknown) {
                constraints.push({ field, kind: "eq", value });
                return q;
              },
              gte(field: string, value: unknown) {
                constraints.push({ field, kind: "gte", value });
                return q;
              },
            };
            callback(q);
            return query;
          },
          async take(limit: number) {
            return Array.from(tables[table].values())
              .filter((row) =>
                constraints.every((constraint) =>
                  constraint.kind === "eq"
                    ? row[constraint.field] === constraint.value
                    : Number(row[constraint.field]) >= Number(constraint.value),
                ),
              )
              .sort(
                (left, right) =>
                  Number(left.rowOrdinal ?? 0) - Number(right.rowOrdinal ?? 0),
              )
              .slice(0, limit);
          },
        };
        return query;
      },
    },
    scheduler: {
      async runAfter(
        _delay: number,
        reference: Parameters<typeof getFunctionName>[0],
        scheduleArgs: Record<string, unknown>,
      ) {
        scheduled.push({
          args: scheduleArgs,
          name: getFunctionName(reference),
        });
      },
    },
  };
  return { ctx, run, rows, scheduled, tables };
}

function preparedRow(
  ordinal: number,
  overrides: Record<string, unknown> = {},
): Row {
  return {
    _id: `row-${ordinal}`,
    decision: "selected_missing_cost",
    decisionRevision: 3,
    normalizedCostMinor: 200,
    preInventoryCount: 2,
    preKnownCostPoolMinor: 100,
    productName: `Product ${ordinal}`,
    productSkuId: `sku-${ordinal}`,
    provenanceDigest: `provenance-${ordinal}`,
    rowOrdinal: ordinal,
    runId: "run-1",
    sku: `SKU-${ordinal}`,
    workStatus: "pending",
    ...overrides,
  };
}

function orchestrationRun(
  overrides: Partial<OrchestrationRun> = {},
): OrchestrationRun {
  return {
    _id: "run-1",
    applyCursor: 0,
    applyExceptionCount: 0,
    appliedRowCount: 0,
    decisionRevision: 3,
    eligibleRowCount: 0,
    epoch: 7,
    ineligibleRowCount: 0,
    preparationCursor: 0,
    selectedRowCount: 0,
    status: "preparing",
    totalRowCount: 0,
    undoCursor: 0,
    undoExceptionCount: 0,
    undoneRowCount: 0,
    ...overrides,
  };
}

describe("cost overlay construction orchestration", () => {
  it("reconstructs ordered chunks within the bounded per-action mutation budget", async () => {
    const content = constructionSource(101);
    const split = content.indexOf("\n", Math.floor(content.length / 2)) + 1;
    const harness = createConstructionHarness({
      anchors: Array.from({ length: 101 }, (_, index) =>
        constructionAnchor(index),
      ),
      chunks: [
        { kind: "raw_content", rawContent: content.slice(0, split) },
        { kind: "row_decisions" },
        { kind: "raw_content", rawContent: content.slice(split) },
      ],
      rawContentChunkCount: 2,
    });

    await expect(
      getHandler(constructCostOverlayRun)(harness.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toMatchObject({ disposition: "completed", rowCount: 101 });

    expect(harness.anchorCursors).toEqual([null, "100"]);
    expect(
      harness.appended.map((batch) => ({
        cursor: batch.expectedCursor,
        done: batch.isDone,
        size: (batch.rows as unknown[]).length,
      })),
    ).toEqual([
      { cursor: 0, done: false, size: 50 },
      { cursor: 50, done: false, size: 50 },
      { cursor: 100, done: true, size: 1 },
    ]);
    expect(harness.appended).toHaveLength(3);
    expect(harness.scheduled).toEqual([]);
    expect(harness.appended.at(-1)).toMatchObject({
      expectedCursor: 100,
      isDone: true,
    });
    const rows = harness.appended.flatMap(
      (batch) => batch.rows as Array<Record<string, unknown>>,
    );
    expect(rows.map((row) => row.rowOrdinal)).toEqual(
      Array.from({ length: 101 }, (_, index) => index),
    );
    expect(rows[0]).toMatchObject({
      normalizedCostMinor: 125,
      productSkuId: "sku-000",
      sourceRawValue: "1.25",
    });
    expect(rows[100]).toMatchObject({
      normalizedCostMinor: 10125,
      productSkuId: "sku-100",
      sourceRawValue: "101.25",
    });
  });

  it("matches a persisted partial prefix before resuming only the suffix", async () => {
    const content = constructionSource(3);
    const initial = createConstructionHarness({
      anchors: Array.from({ length: 3 }, (_, index) =>
        constructionAnchor(index),
      ),
      rawContent: content,
    });
    await getHandler(constructCostOverlayRun)(initial.ctx, {
      expectedEpoch: 7,
      runId: "run-1",
    });
    const initialBatch = initial.appended[0];
    const initialRows = initialBatch.rows as Array<Record<string, unknown>>;

    const resumed = createConstructionHarness({
      anchors: Array.from({ length: 3 }, (_, index) =>
        constructionAnchor(index),
      ),
      rawContent: content,
      state: {
        constructionSnapshotDigest:
          initialBatch.constructionSnapshotDigest as string,
        constructionSnapshotRowCount: 3,
        cursor: 2,
        sourceDigest: initialBatch.sourceDigest as string,
      },
    });
    resumed.persistedRows.push(...initialRows.slice(0, 2));

    await expect(
      getHandler(constructCostOverlayRun)(resumed.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({
      disposition: "completed",
      rowCount: 3,
      sourceFileName: "legacy.csv",
    });

    expect(resumed.prefixStarts).toEqual([]);
    expect(resumed.abandoned).toEqual([]);
    expect(resumed.appended).toHaveLength(1);
    expect(resumed.appended[0]).toMatchObject({
      expectedCursor: 2,
      isDone: true,
    });
    expect(
      (resumed.appended[0].rows as Array<Record<string, unknown>>).map(
        (row) => row.rowOrdinal,
      ),
    ).toEqual([2]);
  });

  it("abandons a changed persisted prefix and a changed unpersisted suffix", async () => {
    const content = constructionSource(3);
    const initial = createConstructionHarness({
      anchors: Array.from({ length: 3 }, (_, index) =>
        constructionAnchor(index),
      ),
      rawContent: content,
    });
    await getHandler(constructCostOverlayRun)(initial.ctx, {
      expectedEpoch: 7,
      runId: "run-1",
    });
    const initialBatch = initial.appended[0];
    const initialRows = initialBatch.rows as Array<Record<string, unknown>>;

    const changedPrefix = createConstructionHarness({
      anchors: Array.from({ length: 3 }, (_, index) =>
        constructionAnchor(index),
      ),
      rawContent: content,
      state: { cursor: 2 },
    });
    changedPrefix.persistedRows.push(
      { ...initialRows[0], sourceRowDigest: "changed" },
      initialRows[1],
    );
    await expect(
      getHandler(constructCostOverlayRun)(changedPrefix.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "stale" });
    expect(changedPrefix.abandoned).toHaveLength(1);
    expect(changedPrefix.appended).toEqual([]);

    const suffixAnchors = Array.from({ length: 3 }, (_, index) =>
      constructionAnchor(index),
    );
    suffixAnchors[2] = {
      ...suffixAnchors[2],
      provisionalUpdatedAt: 999,
    };
    const changedSuffix = createConstructionHarness({
      anchors: suffixAnchors,
      rawContent: content,
      state: {
        constructionSnapshotDigest:
          initialBatch.constructionSnapshotDigest as string,
        constructionSnapshotRowCount: 3,
        cursor: 2,
        sourceDigest: initialBatch.sourceDigest as string,
      },
    });
    changedSuffix.persistedRows.push(...initialRows.slice(0, 2));
    await expect(
      getHandler(constructCostOverlayRun)(changedSuffix.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "stale" });
    expect(changedSuffix.abandoned).toHaveLength(1);
    expect(changedSuffix.prefixStarts).toEqual([]);
  });

  it("rejects incomplete payload chunks before writing", async () => {
    const harness = createConstructionHarness({
      anchors: [constructionAnchor(0)],
      chunks: [{ kind: "raw_content", rawContent: "SKU," }, null],
      rawContentChunkCount: 2,
    });

    await expect(
      getHandler(constructCostOverlayRun)(harness.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).rejects.toThrow("Saved review payload is incomplete.");
    expect(harness.appended).toEqual([]);
  });

  it("aborts when the epoch fence becomes stale after source or anchor loading", async () => {
    const afterSource = createConstructionHarness({
      anchors: [constructionAnchor(0)],
      rawContent: constructionSource(1),
      staleHeartbeatAt: 2,
    });
    await expect(
      getHandler(constructCostOverlayRun)(afterSource.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "stale" });
    expect(afterSource.heartbeats).toHaveLength(2);
    expect(afterSource.appended).toEqual([]);

    const duringAnchors = createConstructionHarness({
      anchors: Array.from({ length: 501 }, (_, index) =>
        constructionAnchor(index),
      ),
      rawContent: constructionSource(501),
      staleHeartbeatAt: 3,
    });
    await expect(
      getHandler(constructCostOverlayRun)(duringAnchors.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "stale" });
    expect(duringAnchors.anchorCursors).toHaveLength(5);
    expect(duringAnchors.appended).toEqual([]);
  });

  it("stores only a UTF-8 byte-bounded preview while digesting the full selected cell", async () => {
    const sharedPrefix = "🧾".repeat(
      Math.ceil(COST_OVERLAY_SOURCE_RAW_VALUE_PREVIEW_MAX_BYTES / 4),
    );
    const firstValue = `${sharedPrefix}${"a".repeat(1024 * 1024)}`;
    const secondValue = `${sharedPrefix}${"b".repeat(1024 * 1024)}`;
    const first = createConstructionHarness({
      anchors: [constructionAnchor(0)],
      rawContent: `SKU,Legacy Cost\nSKU-000,${firstValue}`,
    });
    const second = createConstructionHarness({
      anchors: [constructionAnchor(0)],
      rawContent: `SKU,Legacy Cost\nSKU-000,${secondValue}`,
    });

    await getHandler(constructCostOverlayRun)(first.ctx, {
      expectedEpoch: 7,
      runId: "run-1",
    });
    await getHandler(constructCostOverlayRun)(second.ctx, {
      expectedEpoch: 7,
      runId: "run-1",
    });

    const firstMutation = first.appended[0];
    const firstRow = (firstMutation.rows as Array<Record<string, unknown>>)[0];
    const secondRow = (
      second.appended[0].rows as Array<Record<string, unknown>>
    )[0];
    expect(
      new TextEncoder().encode(firstRow.sourceRawValue as string).byteLength,
    ).toBeLessThanOrEqual(COST_OVERLAY_SOURCE_RAW_VALUE_PREVIEW_MAX_BYTES);
    expect(
      new TextEncoder().encode(JSON.stringify(firstMutation)).byteLength,
    ).toBeLessThan(32 * 1024);
    expect(firstRow.sourceRawValue).toBe(secondRow.sourceRawValue);
    expect(firstRow.sourceRowDigest).not.toBe(secondRow.sourceRowDigest);
    expect(firstRow.provenanceDigest).not.toBe(secondRow.provenanceDigest);
  });

  it("caps high-row calls, heartbeats during load, and needs at most five full rebuilds", async () => {
    const rowCount = COST_OVERLAY_CONSTRUCTION_ANCHOR_LIMIT;
    const harness = createConstructionHarness({
      anchors: Array.from({ length: rowCount }, (_, index) =>
        constructionAnchor(index),
      ),
      rawContent: constructionSource(rowCount),
    });

    let result: unknown;
    let actionCount = 0;
    do {
      const queryStart = harness.queryNames.length;
      const mutationStart = harness.mutationNames.length;
      result = await getHandler(constructCostOverlayRun)(harness.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      });
      actionCount += 1;
      expect(harness.queryNames.length - queryStart).toBeLessThanOrEqual(
        COST_OVERLAY_CONSTRUCTION_MAX_QUERY_CALLS,
      );
      expect(harness.mutationNames.length - mutationStart).toBeLessThanOrEqual(
        COST_OVERLAY_CONSTRUCTION_MAX_MUTATION_CALLS,
      );
    } while (
      (result as { disposition: string }).disposition === "continued" &&
      actionCount <= COST_OVERLAY_CONSTRUCTION_MAX_FULL_REBUILDS
    );

    expect(result).toMatchObject({ disposition: "completed", rowCount });
    expect(actionCount).toBe(COST_OVERLAY_CONSTRUCTION_MAX_FULL_REBUILDS);
    expect(
      harness.queryNames.filter((name) =>
        name.endsWith(":readCostOverlayReviewSource"),
      ),
    ).toHaveLength(COST_OVERLAY_CONSTRUCTION_MAX_FULL_REBUILDS);
    expect(
      harness.anchorCursors.filter((cursor) => cursor === null),
    ).toHaveLength(COST_OVERLAY_CONSTRUCTION_MAX_FULL_REBUILDS);
    expect(harness.anchorCursors).toHaveLength(
      Math.ceil(
        COST_OVERLAY_CONSTRUCTION_ANCHOR_LIMIT /
          COST_OVERLAY_CONSTRUCTION_ANCHOR_PAGE_SIZE,
      ) * actionCount,
    );
    expect(harness.appended).toHaveLength(
      COST_OVERLAY_CONSTRUCTION_BATCHES_PER_INVOCATION * actionCount,
    );
    expect(harness.state.cursor).toBe(rowCount);
    expect(harness.prefixStarts).toEqual([]);
    expect(harness.heartbeats).toHaveLength(12 * actionCount);
    expect(harness.heartbeats).toEqual(
      expect.arrayContaining([
        { expectedEpoch: 7, runId: "run-1" },
      ]),
    );
  });

  it("durably abandons a source whose anchor scope exceeds the envelope", async () => {
    const rowCount = COST_OVERLAY_CONSTRUCTION_ANCHOR_LIMIT + 1;
    const harness = createConstructionHarness({
      anchors: Array.from({ length: rowCount }, (_, index) =>
        constructionAnchor(index),
      ),
      rawContent: constructionSource(rowCount),
    });

    await expect(
      getHandler(constructCostOverlayRun)(harness.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({
      disposition: "abandoned",
      reason: "construction_scope_too_large",
    });
    expect(harness.anchorCursors).toHaveLength(
      Math.ceil((COST_OVERLAY_CONSTRUCTION_ANCHOR_LIMIT + 1) / 100),
    );
    expect(harness.appended).toEqual([]);
    expect(harness.abandoned).toEqual([
      expect.objectContaining({
        failureReason: "construction_scope_too_large",
      }),
    ]);
  });

  it("fences a stale epoch without reading payload and completes a zero-row snapshot", async () => {
    const stale = createConstructionHarness({
      rawContent: "SKU,Legacy Cost",
      state: { epoch: 8 },
    });
    await expect(
      getHandler(constructCostOverlayRun)(stale.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "stale" });
    expect(stale.anchorCursors).toEqual([]);
    expect(stale.appended).toEqual([]);
    expect(stale.heartbeats).toHaveLength(1);

    const empty = createConstructionHarness({
      rawContent: constructionSource(1),
    });
    await expect(
      getHandler(constructCostOverlayRun)(empty.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toMatchObject({ disposition: "completed", rowCount: 0 });
    expect(empty.appended).toHaveLength(1);
    expect(empty.appended[0]).toMatchObject({
      constructionSnapshotRowCount: 0,
      expectedCursor: 0,
      isDone: true,
      rows: [],
    });
  });
});

describe("cost overlay manifest and work lifecycle orchestration", () => {
  it("continues manifest preparation, resumes its cursor, and finalizes exact counts", async () => {
    const rows = Array.from({ length: 51 }, (_, ordinal) =>
      preparedRow(
        ordinal,
        ordinal === 0
          ? { decision: "not_selected" }
          : ordinal === 1
            ? {
                normalizedCostMinor: Number.MAX_SAFE_INTEGER,
                preInventoryCount: 2,
              }
            : {},
      ),
    );
    const harness = createMutationHarness(
      orchestrationRun({
        eligibleRowCount: 51,
        status: "preparing",
        totalRowCount: 51,
      }),
      rows,
    );

    await expect(
      getHandler(prepareCostOverlayManifest)(harness.ctx, {
        expectedDecisionRevision: 3,
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "continued" });
    expect(harness.run).toMatchObject({
      eligibleRowCount: 50,
      ineligibleRowCount: 1,
      preparationCursor: 50,
      selectedRowCount: 48,
      status: "preparing",
    });
    expect(harness.scheduled).toEqual([
      {
        args: {
          expectedDecisionRevision: 3,
          expectedEpoch: 7,
          runId: "run-1",
        },
        name: "inventory/inventoryImportCostOverlayWork:prepareCostOverlayManifest",
      },
    ]);

    await expect(
      getHandler(prepareCostOverlayManifest)(harness.ctx, {
        expectedDecisionRevision: 3,
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "completed" });
    expect(harness.run).toMatchObject({
      eligibleRowCount: 50,
      ineligibleRowCount: 1,
      preparationCursor: 51,
      selectedRowCount: 49,
      status: "prepared",
    });
    expect(harness.run.manifestDigest).toEqual(expect.any(String));
    expect(rows[0]).not.toHaveProperty("manifestOrdinal");
    expect(rows[1]).toMatchObject({
      decision: "ineligible",
      eligibility: "ineligible",
      eligibilityReason: "safe_integer_overflow",
    });
    expect(rows[2]).toMatchObject({ manifestOrdinal: 0 });
    expect(rows[50]).toMatchObject({ manifestOrdinal: 48 });
  });

  it("fences stale manifest epochs and decision revisions without writes", async () => {
    const harness = createMutationHarness(
      orchestrationRun({ status: "preparing", totalRowCount: 1 }),
      [preparedRow(0)],
    );

    await expect(
      getHandler(prepareCostOverlayManifest)(harness.ctx, {
        expectedDecisionRevision: 2,
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "stale" });
    await expect(
      getHandler(prepareCostOverlayManifest)(harness.ctx, {
        expectedDecisionRevision: 3,
        expectedEpoch: 6,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "stale" });
    expect(harness.run).toMatchObject({
      preparationCursor: 0,
      status: "preparing",
    });
    expect(harness.scheduled).toEqual([]);
  });

  it("advances skipped apply rows, schedules continuations, and completes cleanly", async () => {
    const rows = [
      preparedRow(0, { decision: "not_selected" }),
      preparedRow(1, { workStatus: "applied" }),
    ];
    const harness = createMutationHarness(
      orchestrationRun({
        appliedRowCount: 1,
        status: "applying",
        totalRowCount: 2,
      }),
      rows,
    );

    await expect(
      getHandler(processCostOverlayApplyBatch)(harness.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "continued" });
    expect(harness.run.applyCursor).toBe(1);

    await expect(
      getHandler(processCostOverlayApplyBatch)(harness.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "completed", status: "applied" });
    expect(harness.run).toMatchObject({
      appliedRowCount: 1,
      applyCursor: 2,
      applyExceptionCount: 0,
      status: "applied",
    });
    expect(harness.scheduled).toHaveLength(1);
    expect(harness.scheduled[0]).toMatchObject({
      args: { expectedEpoch: 7, runId: "run-1" },
      name: "inventory/inventoryImportCostOverlayWork:processCostOverlayApplyBatch",
    });
  });

  it("isolates malformed apply and undo rows as terminal exceptions", async () => {
    const applyHarness = createMutationHarness(
      orchestrationRun({
        status: "applying",
        totalRowCount: 1,
      }),
      [preparedRow(0)],
    );
    await expect(
      getHandler(processCostOverlayApplyBatch)(applyHarness.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({
      disposition: "completed",
      status: "applied_with_exceptions",
    });
    expect(applyHarness.rows[0]).toMatchObject({
      applyExceptionReason: "row_authority_missing",
      workStatus: "apply_exception",
    });
    expect(applyHarness.run).toMatchObject({
      appliedRowCount: 0,
      applyCursor: 1,
      applyExceptionCount: 1,
      status: "applied_with_exceptions",
    });

    const undoHarness = createMutationHarness(
      orchestrationRun({
        status: "undoing",
        totalRowCount: 1,
      }),
      [preparedRow(0, { workStatus: "applied" })],
    );
    await expect(
      getHandler(processCostOverlayUndoBatch)(undoHarness.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({
      disposition: "completed",
      status: "undone_with_exceptions",
    });
    expect(undoHarness.rows[0]).toMatchObject({
      undoExceptionReason: "apply_evidence_missing",
      workStatus: "undo_exception",
    });
    expect(undoHarness.run).toMatchObject({
      status: "undone_with_exceptions",
      undoCursor: 1,
      undoExceptionCount: 1,
      undoneRowCount: 0,
    });
  });

  it("advances non-applied undo rows, completes empty tails, and fences stale epochs", async () => {
    const undoHarness = createMutationHarness(
      orchestrationRun({
        status: "undoing",
        totalRowCount: 2,
      }),
      [
        preparedRow(0, { workStatus: "undone" }),
        preparedRow(1, { workStatus: "apply_exception" }),
      ],
    );
    await expect(
      getHandler(processCostOverlayUndoBatch)(undoHarness.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "continued" });
    expect(undoHarness.run.undoCursor).toBe(1);
    expect(undoHarness.scheduled[0]).toMatchObject({
      args: { expectedEpoch: 7, runId: "run-1" },
      name: "inventory/inventoryImportCostOverlayWork:processCostOverlayUndoBatch",
    });
    await expect(
      getHandler(processCostOverlayUndoBatch)(undoHarness.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "completed", status: "undone" });
    expect(undoHarness.run).toMatchObject({
      status: "undone",
      undoCursor: 2,
      undoExceptionCount: 0,
      undoneRowCount: 0,
    });

    const emptyApply = createMutationHarness(
      orchestrationRun({
        applyCursor: 0,
        status: "applying",
        totalRowCount: 4,
      }),
      [],
    );
    await expect(
      getHandler(processCostOverlayApplyBatch)(emptyApply.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "completed", status: "applied" });
    expect(emptyApply.run).toMatchObject({
      applyCursor: 4,
      status: "applied",
    });

    const stale = createMutationHarness(
      orchestrationRun({
        epoch: 8,
        status: "applying",
        totalRowCount: 1,
      }),
      [preparedRow(0, { decision: "not_selected" })],
    );
    await expect(
      getHandler(processCostOverlayApplyBatch)(stale.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "stale" });
    expect(stale.run.applyCursor).toBe(0);
    expect(stale.scheduled).toEqual([]);

    stale.run.status = "undoing";
    await expect(
      getHandler(processCostOverlayUndoBatch)(stale.ctx, {
        expectedEpoch: 7,
        runId: "run-1",
      }),
    ).resolves.toEqual({ disposition: "stale" });
    expect(stale.run.undoCursor).toBe(0);
  });
});
