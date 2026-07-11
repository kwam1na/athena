import { describe, expect, it } from "vitest";
import { accumulateCustomActiveDates, accumulateCustomActiveDays, activateVerifiedReportsWorkspaceEpoch, materializationPageMatchesEpoch, materializeActiveReportsWorkspace, selectReadableWorkspaceEpochId, startReportsWorkspaceMaterialization, workspaceEpochNeedsRefresh } from "./materialize";

describe("Reports workspace production materialization", () => {
  it("persists an activation block without scheduler polling churn", async () => {
    const epoch: any = { _id: "epoch-1", projectionKind: "store_day", sourceGenerationId: "generation-1", sourceWatermark: 10, status: "verified", storeId: "store-1" };
    const source: any = { _id: "generation-1", projectionKind: "store_day", stableWatermark: 10, status: "active" };
    let scheduled = 0;
    const patched: any[] = [];
    const handler = (activateVerifiedReportsWorkspaceEpoch as unknown as { _handler: Function })._handler;
    const result = await handler({ db: { get: async (table: string) => table === "reportingWorkspaceMaterializationEpoch" ? epoch : source, patch: async (_id: string, value: any) => patched.push(value) }, runQuery: async () => ({ ready: false, sourceGenerationId: source._id, sourceWatermark: 10 }), scheduler: { runAfter: async () => { scheduled += 1; } } }, { epochId: epoch._id });
    expect(result).toEqual({ reason: "historical_intraday_not_ready", status: "blocked" });
    expect(patched).toContainEqual(expect.objectContaining({ activationBlockedReason: "historical_intraday_not_ready" }));
    expect(scheduled).toBe(0);
  });
  it("activates a previously blocked verified epoch when readiness retries explicitly", async () => {
    const epoch: any = { _id: "epoch-1", activationBlockedReason: "historical_intraday_not_ready", projectionKind: "store_day", sourceGenerationId: "generation-1", sourceWatermark: 10, status: "verified", storeId: "store-1" };
    const source: any = { _id: "generation-1", projectionKind: "store_day", stableWatermark: 10, status: "active" };
    const inserted: any[] = []; const patched: any[] = [];
    const chain: any = { first: async () => null, order: () => chain, withIndex: (_name: string, apply: Function) => { const q: any = { eq: () => q }; apply(q); return chain; } };
    const handler = (activateVerifiedReportsWorkspaceEpoch as unknown as { _handler: Function })._handler;
    const result = await handler({ db: { get: async (table: string) => table === "reportingWorkspaceMaterializationEpoch" ? epoch : source, insert: async (_table: string, value: any) => inserted.push(value), patch: async (_id: string, value: any) => patched.push(value), query: () => chain }, runQuery: async () => ({ ready: true, sourceGenerationId: source._id, sourceWatermark: 10 }), scheduler: { runAfter: async () => undefined } }, { epochId: epoch._id });
    expect(result).toEqual({ status: "active", workspaceEpochId: epoch._id });
    expect(inserted).toHaveLength(1);
    expect(patched).toContainEqual(expect.objectContaining({ activationBlockedReason: undefined, status: "active" }));
  });
  it("keeps the old epoch visible while a replacement is building or verified", () => {
    for (const status of ["building", "verified"] as const) expect(selectReadableWorkspaceEpochId({ activeEpochId: "old", candidateEpoch: { epochId: "new", status } })).toBe("old");
  });
  it("switches visibility atomically only after candidate activation", () => {
    expect(selectReadableWorkspaceEpochId({ activeEpochId: "old", candidateEpoch: { epochId: "new", status: "active" } })).toBe("new");
  });
  it("starts a replacement when the source watermark advances", () => {
    expect(workspaceEpochNeedsRefresh({ epochWatermark: 10, sourceWatermark: 11 })).toBe(true);
    expect(workspaceEpochNeedsRefresh({ epochWatermark: 11, sourceWatermark: 11 })).toBe(false);
  });
  it("keeps custom presentation unavailable until its epoch switches active", () => {
    expect(selectReadableWorkspaceEpochId({ activeEpochId: null, candidateEpoch: { epochId: "custom", status: "verified" } })).toBeNull();
  });
  it("rejects stale and duplicate page deliveries after epoch progress advances", () => {
    const delivered = { cursor: "20", phase: "source", presetIndex: 0, sequence: 2 };
    expect(materializationPageMatchesEpoch({ ...delivered }, delivered)).toBe(true);
    expect(materializationPageMatchesEpoch({ cursor: "40", phase: "source", presetIndex: 0, sequence: 3 }, delivered)).toBe(false);
  });
  it("counts each persisted custom operating-day marker exactly once", () => {
    const metrics = ["net_sales", "__active_day:2026-07-01", "units_sold", "__active_day:2026-07-02"];
    expect(metrics.reduce(accumulateCustomActiveDays, 0)).toBe(2);
  });
  it("deduplicates active-day markers across retries and input order", () => {
    const metrics = ["__active_day:2026-07-02", "net_sales", "__active_day:2026-07-01", "__active_day:2026-07-02"];
    expect(metrics.reduce(accumulateCustomActiveDates, [])).toEqual(["2026-07-01", "2026-07-02"]);
  });
  it("does not start a second chain after a generation is complete", async () => {
    let scheduled = 0;
    const generation = { _id: "generation-1", stableWatermark: 10, storeId: "store-1" };
    const state = { _id: "epoch-1", sequence: 1, sourceGenerationId: generation._id, sourceWatermark: 10, status: "active", updatedAt: 10 };
    const builder: any = { eq: () => builder };
    const chain: any = { first: async () => state, withIndex: (_name: string, apply: Function) => { apply(builder); return chain; } };
    const handler = (startReportsWorkspaceMaterialization as unknown as { _handler: Function })._handler;
    const result = await handler({ db: { get: async () => generation, query: () => chain }, scheduler: { runAfter: async () => { scheduled += 1; } } }, { generationId: generation._id });
    expect(result).toEqual({ epochId: "epoch-1", status: "active" });
    expect(scheduled).toBe(0);
  });
  it("resumes through more than 1,001 source rows without truncation", async () => {
    const generation = { _id: "generation-1", factContractVersion: 1, metricContractVersion: 1, organizationId: "org-1", projectionContractVersion: 1, projectionKind: "current_inventory", sourceWatermark: 10, stableWatermark: 10, status: "active", storeId: "store-1" };
    const epoch: any = { _id: "epoch-1", phase: "source", presetIndex: 0, sequence: 1, sourceGenerationId: generation._id, sourceWatermark: 10, status: "building", updatedAt: 10 };
    const sourceRows = Array.from({ length: 1_205 }, (_, index) => ({ _id: `source-${index}`, asOf: 10, completeness: "complete", currencyCode: "GHS", currencyMinorUnitScale: 2, generationId: generation._id, knownValue: index, metric: "inventory_value", metricContractVersion: 1, organizationId: generation.organizationId, productSkuId: `sku-${index}`, projectedAt: 10, sourceWatermark: 10, storeId: generation.storeId }));
    const summaries: any[] = [];
    const scheduled: any[] = [];
    const filters: Array<[string, unknown]> = [];
    const query = (table: string) => {
      filters.length = 0;
      const builder = { eq(field: string, value: unknown) { filters.push([field, value]); return builder; } };
      const rows = () => (table === "reportingCurrentValuationProjection" ? sourceRows : summaries).filter((row) => filters.every(([field, value]) => row[field] === value));
      const chain: any = {
        first: async () => rows()[0] ?? null,
        paginate: async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => { const offset = cursor ? Number(cursor) : 0; const page = rows().slice(offset, offset + numItems); const next = offset + page.length; return { continueCursor: String(next), isDone: next >= rows().length, page }; },
        withIndex: (_name: string, apply: (q: typeof builder) => unknown) => { apply(builder); return chain; },
      };
      return chain;
    };
    const ctx: any = {
      db: {
        get: async (table: string, id: string) => table === "reportingProjectionGeneration" && id === generation._id ? generation : table === "reportingWorkspaceMaterializationEpoch" && id === epoch._id ? epoch : null,
        insert: async (_table: string, row: any) => { summaries.push({ ...row, _id: `summary-${summaries.length}` }); },
        patch: async (id: string, value: any) => { if (id === epoch._id) Object.assign(epoch, value); },
        query,
        replace: async (id: string, row: any) => { const index = summaries.findIndex((item) => item._id === id); summaries[index] = { ...row, _id: id }; },
      },
      scheduler: { runAfter: async (_delay: number, _reference: unknown, args: unknown) => { scheduled.push(args); } },
    };
    const handler = (materializeActiveReportsWorkspace as unknown as { _handler: Function })._handler;
    let args: any = { cursor: null, epochId: epoch._id, generationId: generation._id, phase: "source", presetIndex: 0, sequence: 1 };
    let calls = 0;
    while (args) {
      scheduled.length = 0;
      await handler(ctx, args);
      if (calls === 0) {
        const written = summaries.length;
        expect(await handler(ctx, args)).toEqual({ status: "stale_page" });
        expect(summaries).toHaveLength(written);
      }
      const next = scheduled.shift() ?? null;
      args = next?.generationId ? next : null;
      calls += 1;
    }
    expect(calls).toBeGreaterThan(50);
    expect(summaries).toHaveLength(sourceRows.length);
    expect(new Set(summaries.map((row) => row.productSkuId)).size).toBe(sourceRows.length);
  });
});
