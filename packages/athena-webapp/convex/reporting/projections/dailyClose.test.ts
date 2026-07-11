import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Doc } from "../../_generated/dataModel";

import {
  applyDailyCloseFactWithCtx,
  buildDailyCloseSnapshot,
  decideDailyCloseLineage,
  reconcileDailyClose,
} from "./dailyClose";

type FakeRow = { _id: string; [field: string]: unknown };

function createDailyCloseCtx(input: {
  facts?: FakeRow[];
  projections?: FakeRow[];
}) {
  const tables: Record<string, FakeRow[]> = {
    reportingDailyCloseProjection: [...(input.projections ?? [])],
    reportingDailyCloseTrust: [],
    reportingFact: [...(input.facts ?? [])],
  };
  let nextId = 1;
  const db = {
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${nextId++}`;
      tables[table]!.push({ _id: id, ...value });
      return id;
    },
    patch: async (
      table: string,
      id: string,
      value: Record<string, unknown>,
    ) => {
      const row = tables[table]!.find((candidate) => candidate._id === id);
      if (!row) throw new Error(`Missing fake row ${table}:${id}`);
      Object.assign(row, value);
    },
    replace: async (
      table: string,
      id: string,
      value: Record<string, unknown>,
    ) => {
      const index = tables[table]!.findIndex((candidate) => candidate._id === id);
      if (index >= 0) {
        tables[table]![index] = { _id: id, ...value };
        return;
      }
      throw new Error(`Missing fake row ${table}:${id}`);
    },
    query: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const indexBuilder = {
        eq(field: string, value: unknown) {
          filters.push([field, value]);
          return indexBuilder;
        },
      };
      const matching = () =>
        tables[table]!.filter((row) =>
          filters.every(([field, value]) => row[field] === value),
        );
      const chain = {
        first: async () => matching()[0] ?? null,
        order: (_direction: "asc" | "desc") => {
          const originalMatching = matching;
          const ordered = () =>
            [...originalMatching()].sort(
              (left, right) =>
                Number(right.acceptedCloseVersion ?? 0) -
                Number(left.acceptedCloseVersion ?? 0),
            );
          chain.first = async () => ordered()[0] ?? null;
          chain.take = async (limit: number) => ordered().slice(0, limit);
          chain.unique = async () => {
            const rows = ordered();
            if (rows.length > 1) throw new Error("Fake unique query duplicated");
            return rows[0] ?? null;
          };
          return chain;
        },
        take: async (limit: number) => matching().slice(0, limit),
        unique: async () => {
          const rows = matching();
          if (rows.length > 1) throw new Error("Fake unique query duplicated");
          return rows[0] ?? null;
        },
        withIndex: (
          _name: string,
          apply: (builder: typeof indexBuilder) => unknown,
        ) => {
          apply(indexBuilder);
          return chain;
        },
      };
      return chain;
    },
  };
  return { ctx: { db } as never, tables };
}

const generation = {
  _id: "generation-1",
  factContractVersion: 1,
  metricContractVersion: 1,
  projectionContractVersion: 1,
  projectionKind: "store_day",
} as never;

function closeFact(input: {
  id: string;
  operatingDate: string;
  sourceId: string;
  supersedesCloseId?: string;
  version: number;
  lineage?: "policy" | "schedule";
}) {
  return {
    _creationTime: input.version,
    _id: input.id,
    acceptedAt: input.version * 100,
    businessEventKey: `daily_close:${input.sourceId}:completed:v${input.version}:close_snapshot`,
    closeSnapshot: {
      acceptedDeficitAdjustmentMinor: 0,
      acceptedNetSalesMinor: input.version * 1_000,
      acceptedRefundsMinor: 0,
      completeness: "complete",
      snapshotVersion: input.version,
      ...(input.supersedesCloseId
        ? { supersedesCloseId: input.supersedesCloseId }
        : {}),
    },
    completeness: "complete",
    currencyCode: "GHS",
    currencyMinorUnitScale: 2,
    factType: "close_snapshot",
    operatingDate: input.operatingDate,
    organizationId: "org-1",
    sourceDomain: "daily_close",
    status: "canonical",
    storeId: "store-1",
    ...(input.lineage === "policy"
      ? {
          historicalInterpretationPolicyHash: "policy-hash-1",
          historicalInterpretationPolicyId: "policy-1",
        }
      : { scheduleVersionId: "schedule-1" }),
  } as unknown as Doc<"reportingFact">;
}

function legacyCloseProjection(input: {
  businessEventKey: string;
  id: string;
  operatingDate: string;
  version: number;
}) {
  return {
    _id: input.id,
    acceptedCloseBusinessEventKey: input.businessEventKey,
    acceptedCloseVersion: input.version,
    generationId: "generation-1",
    operatingDate: input.operatingDate,
    scheduleVersionId: "schedule-1",
  };
}

describe("reporting Daily Close lineage", () => {
  it("preserves the accepted snapshot and reports late post-close delta", () => {
    expect(
      reconcileDailyClose({
        acceptedCloseId: "close-1",
        acceptedNetRevenueMinor: 10_000,
        currentNetRevenueMinor: 12_500,
        supersedesCloseId: null,
      }),
    ).toEqual({
      acceptedCloseId: "close-1",
      acceptedNetRevenueMinor: 10_000,
      currentNetRevenueMinor: 12_500,
      postCloseDeltaMinor: 2_500,
      supersedesCloseId: null,
    });
  });

  it("keeps reclosed source completeness and supersedes lineage immutable while current facts move", () => {
    const accepted = reconcileDailyClose({
      acceptedCloseId: "close-2",
      acceptedCloseVersion: 1,
      acceptedNetRevenueMinor: 12_000,
      acceptedSourceComplete: false,
      currentNetRevenueMinor: 12_000,
      supersedesCloseId: "close-1",
    });
    const afterLateSale = reconcileDailyClose({
      acceptedCloseId: accepted.acceptedCloseId,
      acceptedCloseVersion: accepted.acceptedCloseVersion,
      acceptedNetRevenueMinor: accepted.acceptedNetRevenueMinor,
      acceptedSourceComplete: accepted.acceptedSourceComplete,
      currentNetRevenueMinor: 14_500,
      supersedesCloseId: accepted.supersedesCloseId,
    });

    expect(afterLateSale).toMatchObject({
      acceptedCloseId: "close-2",
      acceptedCloseVersion: 1,
      acceptedCompleteness: "partial",
      acceptedNetRevenueMinor: 12_000,
      currentNetRevenueMinor: 14_500,
      postCloseDeltaMinor: 2_500,
      supersedesCloseId: "close-1",
    });
  });

  it("freezes accepted close values while updating only the current interpretation", () => {
    const accepted = buildDailyCloseSnapshot({
      acceptedCloseId: "close-3",
      acceptedCloseVersion: 2,
      acceptedCompleteness: "complete",
      acceptedDeficitAdjustmentMinor: 100,
      acceptedNetSalesMinor: 12_000,
      acceptedRefundsMinor: 500,
      currentDeficitAdjustmentMinor: 300,
      currentNetSalesMinor: 13_500,
      currentRefundsMinor: 700,
      supersedesCloseId: "close-2",
    });

    expect(accepted).toMatchObject({
      acceptedDeficitAdjustmentMinor: 100,
      acceptedNetSalesMinor: 12_000,
      acceptedRefundsMinor: 500,
      currentDeficitAdjustmentMinor: 300,
      currentNetSalesMinor: 13_500,
      currentRefundsMinor: 700,
      postCloseDeficitAdjustmentDeltaMinor: 200,
      postCloseKnownCogsDeltaMinor: 200,
      postCloseGrossProfitDeltaMinor: -200,
      postCloseNetSalesDeltaMinor: 1_500,
      postCloseRefundsDeltaMinor: 200,
    });
  });

  it("materializes through the shared incremental and rebuild processor", () => {
    const processor = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "processor.ts"),
      "utf8",
    );
    const dailyClose = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "dailyClose.ts"),
      "utf8",
    );
    expect(processor).toContain("await applyDailyCloseFactWithCtx(ctx, generation, fact)");
    expect(dailyClose).toContain('ctx.db.insert("reportingDailyCloseProjection"');
    expect(dailyClose).toContain("fact.closeSnapshot.acceptedNetSalesMinor");
    expect(dailyClose).toContain(
      'fact.adjustmentKind === "deficit_cogs_revaluation"',
    );
    expect(dailyClose).toContain('"by_gen_close_source"');
    expect(dailyClose).toContain(
      'predecessorBusinessEventKey(',
    );
    expect(dailyClose).toContain(
      'sourceDomain", "daily_close"',
    );
    expect(dailyClose).toContain("fact.cogsKnownMinor ?? 0");
    expect(dailyClose).not.toContain('.query("reportingStoreDayProjection")');
    expect(dailyClose).toContain('ctx.db.patch("reportingDailyCloseProjection", latest._id');
    expect(dailyClose).not.toContain('ctx.db.patch("reportingFact"');
  });

  it("orders close snapshots by immutable source version and supersedes identity", () => {
    expect(
      decideDailyCloseLineage({
        incomingSnapshotVersion: 1,
      }),
    ).toEqual({ action: "insert" });
    expect(
      decideDailyCloseLineage({
        incomingSnapshotVersion: 1,
        latestBusinessEventKey: "daily_close:close-2:completed:v2",
        latestSnapshotVersion: 2,
      }),
    ).toEqual({ action: "ignore_older_or_replayed" });
    expect(
      decideDailyCloseLineage({
        incomingSnapshotVersion: 3,
        incomingSupersedesCloseId: "close-2",
        latestBusinessEventKey: "daily_close:close-2:completed:v2",
        latestSnapshotVersion: 2,
      }),
    ).toEqual({ action: "insert" });
  });

  it("rejects gaps and mismatched Daily Close predecessors", () => {
    expect(() =>
      decideDailyCloseLineage({
        incomingSnapshotVersion: 1,
        incomingSupersedesCloseId: "impossible-predecessor",
      }),
    ).toThrow("predecessor is unavailable");
    expect(() =>
      decideDailyCloseLineage({
        incomingSnapshotVersion: 3,
        incomingSupersedesCloseId: "close-1",
        latestBusinessEventKey: "daily_close:close-1:completed:v1",
        latestSnapshotVersion: 1,
      }),
    ).toThrow("not contiguous");
    expect(() =>
      decideDailyCloseLineage({
        incomingSnapshotVersion: 2,
        incomingSupersedesCloseId: "other-close",
        latestBusinessEventKey: "daily_close:close-1:completed:v1",
        latestSnapshotVersion: 1,
      }),
    ).toThrow("does not match");
  });

  it("links an exact predecessor across operating dates", async () => {
    const first = closeFact({
      id: "fact-1",
      operatingDate: "2026-07-01",
      sourceId: "close-1",
      version: 1,
    });
    const second = closeFact({
      id: "fact-2",
      operatingDate: "2026-07-02",
      sourceId: "close-2",
      supersedesCloseId: "close-1",
      version: 2,
    });
    const { ctx, tables } = createDailyCloseCtx({ facts: [first, second] });

    await applyDailyCloseFactWithCtx(ctx, generation, first);
    await applyDailyCloseFactWithCtx(ctx, generation, second);

    const rows = tables.reportingDailyCloseProjection!;
    const firstRow = rows.find(
      (row) => row.acceptedCloseSourceId === "close-1",
    );
    const secondRow = rows.find(
      (row) => row.acceptedCloseSourceId === "close-2",
    );
    expect(secondRow).toMatchObject({
      operatingDate: "2026-07-02",
      supersedesDailyCloseProjectionId: firstRow?._id,
    });
  });

  it("preserves incoming policy lineage while superseding a schedule-backed close", async () => {
    const first = closeFact({
      id: "fact-1",
      operatingDate: "2026-07-01",
      sourceId: "close-1",
      version: 1,
    });
    const second = closeFact({
      id: "fact-2",
      lineage: "policy",
      operatingDate: "2026-07-01",
      sourceId: "close-2",
      supersedesCloseId: "close-1",
      version: 2,
    });
    const { ctx, tables } = createDailyCloseCtx({ facts: [first, second] });

    await applyDailyCloseFactWithCtx(ctx, generation, first);
    await applyDailyCloseFactWithCtx(ctx, generation, second);

    expect(
      tables.reportingDailyCloseProjection!.find(
        (row) => row.acceptedCloseSourceId === "close-2",
      ),
    ).toMatchObject({
      historicalInterpretationPolicyHash: "policy-hash-1",
      historicalInterpretationPolicyId: "policy-1",
      scheduleVersionId: undefined,
    });
  });

  it("projects canonical predecessors before an out-of-order dependent snapshot", async () => {
    const first = closeFact({
      id: "fact-1",
      operatingDate: "2026-07-01",
      sourceId: "close-1",
      version: 1,
    });
    const second = closeFact({
      id: "fact-2",
      operatingDate: "2026-07-02",
      sourceId: "close-2",
      supersedesCloseId: "close-1",
      version: 2,
    });
    const { ctx, tables } = createDailyCloseCtx({ facts: [second, first] });

    await applyDailyCloseFactWithCtx(ctx, generation, second);

    expect(
      tables.reportingDailyCloseProjection!.map(
        (row) => row.acceptedCloseSourceId,
      ),
    ).toEqual(["close-1", "close-2"]);
  });

  it("treats exact replay as a no-op and rejects conflicting source reuse", async () => {
    const first = closeFact({
      id: "fact-1",
      operatingDate: "2026-07-01",
      sourceId: "close-1",
      version: 1,
    });
    const { ctx, tables } = createDailyCloseCtx({ facts: [first] });

    await applyDailyCloseFactWithCtx(ctx, generation, first);
    await expect(
      applyDailyCloseFactWithCtx(ctx, generation, first),
    ).resolves.toBeNull();
    expect(tables.reportingDailyCloseProjection).toHaveLength(1);

    const conflict = closeFact({
      id: "fact-conflict",
      operatingDate: "2026-07-01",
      sourceId: "close-1",
      version: 2,
    });
    await expect(
      applyDailyCloseFactWithCtx(ctx, generation, conflict),
    ).rejects.toThrow("identity conflicts");
  });

  it("fails closed when the canonical predecessor is missing", async () => {
    const second = closeFact({
      id: "fact-2",
      operatingDate: "2026-07-02",
      sourceId: "close-2",
      supersedesCloseId: "close-1",
      version: 2,
    });
    const { ctx, tables } = createDailyCloseCtx({ facts: [second] });

    await expect(
      applyDailyCloseFactWithCtx(ctx, generation, second),
    ).rejects.toThrow("predecessor is unavailable");
    expect(tables.reportingDailyCloseProjection).toHaveLength(0);
  });

  it("adopts a legacy replay by exact key without inserting a duplicate", async () => {
    const first = closeFact({
      id: "fact-1",
      operatingDate: "2026-07-01",
      sourceId: "close-1",
      version: 1,
    });
    const legacy = legacyCloseProjection({
      businessEventKey: first.businessEventKey,
      id: "legacy-projection-1",
      operatingDate: "2026-07-01",
      version: 1,
    });
    const { ctx, tables } = createDailyCloseCtx({
      facts: [first],
      projections: [legacy],
    });

    await expect(
      applyDailyCloseFactWithCtx(ctx, generation, first),
    ).resolves.toBeNull();
    expect(tables.reportingDailyCloseProjection).toHaveLength(1);
    expect(tables.reportingDailyCloseProjection![0]).toMatchObject({
      _id: "legacy-projection-1",
      acceptedCloseSourceId: "close-1",
    });
  });

  it("links a new close to an exact legacy predecessor", async () => {
    const first = closeFact({
      id: "fact-1",
      operatingDate: "2026-07-01",
      sourceId: "close-1",
      version: 1,
    });
    const second = closeFact({
      id: "fact-2",
      operatingDate: "2026-07-02",
      sourceId: "close-2",
      supersedesCloseId: "close-1",
      version: 2,
    });
    const legacy = legacyCloseProjection({
      businessEventKey: first.businessEventKey,
      id: "legacy-projection-1",
      operatingDate: "2026-07-01",
      version: 1,
    });
    const { ctx, tables } = createDailyCloseCtx({
      facts: [second, first],
      projections: [legacy],
    });

    await applyDailyCloseFactWithCtx(ctx, generation, second);

    expect(tables.reportingDailyCloseProjection).toHaveLength(2);
    expect(
      tables.reportingDailyCloseProjection!.find(
        (row) => row.acceptedCloseSourceId === "close-2",
      ),
    ).toMatchObject({
      supersedesDailyCloseProjectionId: "legacy-projection-1",
    });
  });

  it("does not treat a different modern close as a legacy identity conflict", async () => {
    const incoming = closeFact({
      id: "fact-2",
      operatingDate: "2026-07-01",
      sourceId: "close-2",
      version: 1,
    });
    const modernSibling = {
      ...legacyCloseProjection({
        businessEventKey:
          "daily_close:close-1:completed:v1:close_snapshot",
        id: "modern-projection-1",
        operatingDate: "2026-07-01",
        version: 1,
      }),
      acceptedCloseSourceId: "close-1",
    };
    const { ctx, tables } = createDailyCloseCtx({
      facts: [incoming],
      projections: [modernSibling],
    });

    await applyDailyCloseFactWithCtx(ctx, generation, incoming);

    expect(tables.reportingDailyCloseProjection).toHaveLength(2);
    expect(
      tables.reportingDailyCloseProjection!.find(
        (row) => row.acceptedCloseSourceId === "close-2",
      ),
    ).toBeDefined();
  });

  it("finds an exact legacy replay even when modern siblings share its date and version", async () => {
    const incoming = closeFact({
      id: "fact-3",
      operatingDate: "2026-07-01",
      sourceId: "close-3",
      version: 1,
    });
    const modernSiblings = ["close-1", "close-2"].map((sourceId) => ({
      ...legacyCloseProjection({
        businessEventKey: `daily_close:${sourceId}:completed:v1:close_snapshot`,
        id: `modern-${sourceId}`,
        operatingDate: "2026-07-01",
        version: 1,
      }),
      acceptedCloseSourceId: sourceId,
    }));
    const legacy = legacyCloseProjection({
      businessEventKey: incoming.businessEventKey,
      id: "legacy-close-3",
      operatingDate: "2026-07-01",
      version: 1,
    });
    const { ctx, tables } = createDailyCloseCtx({
      facts: [incoming],
      projections: [...modernSiblings, legacy],
    });

    await expect(
      applyDailyCloseFactWithCtx(ctx, generation, incoming),
    ).resolves.toBeNull();
    expect(tables.reportingDailyCloseProjection).toHaveLength(3);
    expect(legacy).toMatchObject({ acceptedCloseSourceId: "close-3" });
  });

  it("fails closed for ambiguous legacy rows even when a modern sibling sorts first", async () => {
    const incoming = closeFact({
      id: "fact-2",
      operatingDate: "2026-07-01",
      sourceId: "close-2",
      version: 1,
    });
    const modern = {
      ...legacyCloseProjection({
        businessEventKey: "daily_close:close-1:completed:v1:close_snapshot",
        id: "modern-close-1",
        operatingDate: "2026-07-01",
        version: 1,
      }),
      acceptedCloseSourceId: "close-1",
    };
    const duplicateA = legacyCloseProjection({
      businessEventKey: incoming.businessEventKey,
      id: "legacy-a",
      operatingDate: "2026-07-01",
      version: 1,
    });
    const duplicateB = { ...duplicateA, _id: "legacy-b" };
    const { ctx } = createDailyCloseCtx({
      facts: [incoming],
      projections: [modern, duplicateA, duplicateB],
    });

    await expect(
      applyDailyCloseFactWithCtx(ctx, generation, incoming),
    ).rejects.toThrow("legacy projection identity is ambiguous");
  });

  it("fails closed for ambiguous or conflicting legacy identity", async () => {
    const first = closeFact({
      id: "fact-1",
      operatingDate: "2026-07-01",
      sourceId: "close-1",
      version: 1,
    });
    const duplicateA = legacyCloseProjection({
      businessEventKey: first.businessEventKey,
      id: "legacy-a",
      operatingDate: "2026-07-01",
      version: 1,
    });
    const duplicateB = legacyCloseProjection({
      businessEventKey: first.businessEventKey,
      id: "legacy-b",
      operatingDate: "2026-07-01",
      version: 1,
    });
    const ambiguous = createDailyCloseCtx({
      facts: [first],
      projections: [duplicateA, duplicateB],
    });
    await expect(
      applyDailyCloseFactWithCtx(ambiguous.ctx, generation, first),
    ).rejects.toThrow("legacy projection identity is ambiguous");

    const conflicting = createDailyCloseCtx({
      facts: [first],
      projections: [
        legacyCloseProjection({
          businessEventKey:
            "daily_close:other-close:completed:v1:close_snapshot",
          id: "legacy-conflict",
          operatingDate: "2026-07-01",
          version: 1,
        }),
      ],
    });
    await expect(
      applyDailyCloseFactWithCtx(conflicting.ctx, generation, first),
    ).rejects.toThrow("legacy projection identity conflicts");
  });

  it("selects Daily Close history through exact lineage indexes", () => {
    const source = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "dailyClose.ts"),
      "utf8",
    );
    expect(source).toContain(
      '"by_gen_date_schedule_close"',
    );
    expect(source).toContain(
      '"by_gen_date_policy_close"',
    );
    expect(source).not.toContain(".take(20)");
  });
});
