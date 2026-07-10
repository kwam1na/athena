import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MutationCtx } from "../../_generated/server";

import {
  INVENTORY_REPLAY_ATOMIC_OUTCOME_LIMIT,
  applyCandidateLotBatch,
  applyOccurrenceReplayEffect,
  applyOccurrenceReplayTransition,
  assertOccurrenceReplayCurrencyCompatible,
  assertOccurrenceReplayOutcomeActivationBound,
  occurrenceReplayChangedDeficitOwners,
  occurrenceReplayCoveredRevenueDelta,
  occurrenceReplayDeficitOwnershipMatches,
  occurrenceReplayFinancialMetricFamily,
  occurrenceReplayKnownCostDelta,
  occurrenceReplayOutcomesMatch,
  occurrenceReplayOwnershipConflictRequiresFailClose,
  occurrenceReplayResolutionFactContributesFinancially,
  shouldStageOccurrenceReplayOutcome,
  validateOccurrenceReplayOutcomeQuantities,
  withholdReplayFinancialOutcomeBatch,
} from "./occurrenceReplay";
import { deriveFactMetricContributions } from "../projections/factContributions";
import type { InventoryValuationPosition, UnresolvedDeficitLot } from "./types";

type ReplayState = {
  deficitLots: UnresolvedDeficitLot[];
  position: InventoryValuationPosition;
};

const emptyPosition = {
  basisVersion: 0,
  costedQuantity: 0,
  currency: null,
  knownCostPool: 0,
  uncostedQuantity: 0,
  unresolvedDeficitQuantity: 0,
};

function inbound(key: string, occurrenceAt: number, unitCost: number) {
  return {
    businessEventKey: key,
    occurrenceAt,
    physicalQuantityDelta: 1,
    replayValuation: {
      costBasis: {
        currency: "GHS",
        kind: "known" as const,
        quantity: 1,
        totalCost: unitCost,
        unitCost,
      },
      kind: "inbound" as const,
      quantity: 1,
    },
  };
}

const sale = {
  businessEventKey: "sale",
  occurrenceAt: 20,
  physicalQuantityDelta: -1,
  replayValuation: {
    disposition: "merchandise_sale" as const,
    kind: "outbound" as const,
    quantity: 1,
  },
};

function replay(effects: ReturnType<typeof inbound>[]) {
  return effects.reduce(applyOccurrenceReplayEffect, emptyPosition);
}

type ActivationTable =
  | "productSku"
  | "reportingCutoverBaseline"
  | "reportingFact"
  | "reportingFactSourceReference"
  | "reportingInventoryDeficitLedger"
  | "reportingInventoryDeficitLot"
  | "reportingInventoryEffect"
  | "reportingInventoryOccurrenceReplay"
  | "reportingInventoryOccurrenceReplayLot"
  | "reportingInventoryOccurrenceReplayOutcome"
  | "reportingInventoryPosition"
  | "reportingInventoryPositionRevision"
  | "reportingSkuEvidence";

function createActivationCtx(
  seed: Partial<Record<ActivationTable, Array<Record<string, any>>>> = {},
) {
  const tableNames: ActivationTable[] = [
    "productSku",
    "reportingCutoverBaseline",
    "reportingFact",
    "reportingFactSourceReference",
    "reportingInventoryDeficitLedger",
    "reportingInventoryDeficitLot",
    "reportingInventoryEffect",
    "reportingInventoryOccurrenceReplay",
    "reportingInventoryOccurrenceReplayLot",
    "reportingInventoryOccurrenceReplayOutcome",
    "reportingInventoryPosition",
    "reportingInventoryPositionRevision",
    "reportingSkuEvidence",
  ];
  const tables = Object.fromEntries(
    tableNames.map((table) => [
      table,
      new Map((seed[table] ?? []).map((row) => [String(row._id), row])),
    ]),
  ) as Record<ActivationTable, Map<string, Record<string, any>>>;
  const db = {
    get: async (table: ActivationTable, id: unknown) =>
      tables[table].get(String(id)) ?? null,
    insert: async (table: ActivationTable, value: Record<string, unknown>) => {
      const id = `${table}-${tables[table].size + 1}`;
      tables[table].set(id, { _creationTime: Date.now(), _id: id, ...value });
      return id;
    },
    patch: async (
      table: ActivationTable,
      id: unknown,
      value: Record<string, unknown>,
    ) => {
      const current = tables[table].get(String(id));
      if (!current) throw new Error(`Missing ${table} ${String(id)}`);
      tables[table].set(String(id), { ...current, ...value });
    },
    query: (table: ActivationTable) => ({
      withIndex(
        _index: string,
        apply: (builder: {
          eq: (field: string, value: unknown) => unknown;
          gt: (field: string, value: number) => unknown;
          lte: (field: string, value: number) => unknown;
        }) => void,
      ) {
        const equal: Record<string, unknown> = {};
        const greater: Record<string, number> = {};
        const lessThanOrEqual: Record<string, number> = {};
        const builder = {
          eq(field: string, value: unknown) {
            equal[field] = value;
            return builder;
          },
          gt(field: string, value: number) {
            greater[field] = value;
            return builder;
          },
          lte(field: string, value: number) {
            lessThanOrEqual[field] = value;
            return builder;
          },
        };
        apply(builder);
        let rows = Array.from(tables[table].values()).filter(
          (row) =>
            Object.entries(equal).every(
              ([field, value]) => row[field] === value,
            ) &&
            Object.entries(greater).every(
              ([field, value]) => Number(row[field]) > value,
            ) &&
            Object.entries(lessThanOrEqual).every(
              ([field, value]) => Number(row[field]) <= value,
            ),
        );
        const result = {
          filter: (
            applyFilter: (builder: {
              eq: (field: string, value: unknown) => unknown;
              field: (field: string) => string;
            }) => unknown,
          ) => {
            const filterEqual: Record<string, unknown> = {};
            const filterBuilder = {
              eq(field: string, value: unknown) {
                filterEqual[field] = value;
                return true;
              },
              field(field: string) {
                return field;
              },
            };
            applyFilter(filterBuilder);
            rows = rows.filter((row) =>
              Object.entries(filterEqual).every(
                ([field, value]) => row[field] === value,
              ),
            );
            return result;
          },
          first: async () => rows[0] ?? null,
          order: () => result,
          paginate: async (input: {
            cursor: string | null;
            numItems: number;
          }) => {
            const start = Number(input.cursor ?? 0);
            const page = rows.slice(start, start + input.numItems);
            const next = start + page.length;
            return {
              continueCursor: String(next),
              isDone: next >= rows.length,
              page,
            };
          },
          take: async (limit: number) => rows.slice(0, limit),
        };
        return result;
      },
    }),
  };
  return {
    ctx: {
      db,
      scheduler: { runAfter: async () => undefined },
    } as unknown as MutationCtx,
    tables,
  };
}

function activationFixture(
  options: {
    activeOwner?: string;
    candidateOwner?: string;
    postBaselineResolutionOwner?: string;
  } = {},
) {
  const activeOwner = options.activeOwner ?? "effect-sale-a";
  const candidateOwner = options.candidateOwner ?? "effect-sale-b";
  const baseline = {
    _creationTime: 10,
    _id: "baseline-1",
  };
  const replay = {
    _creationTime: 20,
    _id: "replay-1",
    actualApplyCursor: undefined,
    attemptCount: 1,
    baselineId: baseline._id,
    candidateLedgerId: "ledger-candidate",
    completedAt: undefined,
    costedQuantity: 0,
    createdAt: 20,
    currencyCode: undefined,
    cursor: undefined,
    frozenWatermark: 100,
    knownCostPoolMinor: 0,
    lastEffectAt: 50,
    latestFailureAt: undefined,
    latestFailureCode: undefined,
    lotSeedCursor: undefined,
    organizationId: "org-1",
    pendingCostedQuantity: undefined,
    pendingCorrectionTargetDeficit: undefined,
    pendingEffectId: undefined,
    pendingKnownCostMinor: undefined,
    pendingUncostedQuantity: undefined,
    phase: "applying_candidate",
    positionId: "position-1",
    processedCount: 2,
    productSkuId: "sku-1",
    seededDeficitQuantity: 0,
    sourceLedgerId: "ledger-active",
    status: "running",
    storeId: "store-1",
    uncostedQuantity: 0,
    unresolvedDeficitQuantity: 1,
    updatedAt: 20,
    version: 2,
  };
  const resolution = options.postBaselineResolutionOwner
    ? [
        {
          _creationTime: 30,
          _id: "effect-resolution",
          effectType: "deficit_resolution",
          linkedOutboundEffectId: options.postBaselineResolutionOwner,
          positionId: replay.positionId,
        },
      ]
    : [];
  return {
    replay,
    seed: {
      productSku: [
        {
          _id: replay.productSkuId,
          inventoryCount: 0,
          quantityAvailable: 0,
        },
      ],
      reportingCutoverBaseline: [baseline],
      reportingInventoryDeficitLedger: [
        {
          _id: replay.sourceLedgerId,
          status: "active",
        },
        {
          _id: replay.candidateLedgerId,
          status: "candidate",
        },
      ],
      reportingInventoryDeficitLot: [
        {
          _id: "lot-active",
          ledgerId: replay.sourceLedgerId,
          outboundEffectId: activeOwner,
          remainingQuantity: 1,
          status: "open",
        },
        {
          _id: "lot-candidate",
          ledgerId: replay.candidateLedgerId,
          outboundEffectId: candidateOwner,
          remainingQuantity: 1,
          status: "open",
        },
      ],
      reportingInventoryEffect: resolution,
      reportingInventoryOccurrenceReplay: [replay],
      reportingInventoryPosition: [
        {
          _id: replay.positionId,
          deficitLedgerId: replay.sourceLedgerId,
          onHandQuantity: 0,
          sellableQuantity: 0,
        },
      ],
    },
  };
}

describe("inventory occurrence replay", () => {
  it("rebuilds weighted-average state in business occurrence order", () => {
    const firstReceipt = inbound("receipt-100", 10, 100);
    const secondReceipt = inbound("receipt-300", 30, 300);
    const occurrenceOrdered = [firstReceipt, sale, secondReceipt].reduce(
      applyOccurrenceReplayEffect,
      emptyPosition,
    );
    const commitOrdered = [firstReceipt, secondReceipt, sale].reduce(
      applyOccurrenceReplayEffect,
      emptyPosition,
    );

    expect(occurrenceOrdered).toMatchObject({
      costedQuantity: 1,
      knownCostPool: 300,
    });
    expect(commitOrdered).toMatchObject({
      costedQuantity: 1,
      knownCostPool: 200,
    });
  });

  it("uses a durable commit-frozen bounded replay before clearing rebuild state", () => {
    const source = readFileSync(
      "convex/reporting/inventory/occurrenceReplay.ts",
      "utf8",
    );
    const rebuildSource = readFileSync(
      "convex/reporting/maintenance/inventoryRebuild.ts",
      "utf8",
    );
    expect(source).toContain("INVENTORY_OCCURRENCE_REPLAY_PAGE_SIZE = 20");
    expect(source).toContain('withIndex("by_positionId_occurrenceAt"');
    expect(source).toContain("effect._creationTime > replay.frozenWatermark");
    expect(source).toContain('.gt("_creationTime", replay.frozenWatermark)');
    expect(source).toContain('revisionKind: "rebuild_applied"');
    expect(source).toContain("reportingInventoryOccurrenceReplayLot");
    expect(source).toContain('phase: "applying_candidate"');
    expect(source).toContain("candidateLedgerId");
    expect(source).toContain("deficitLedgerId: replay.candidateLedgerId");
    expect(source).not.toContain('ctx.db.patch("productSku"');
    expect(rebuildSource).toContain("startOrResumeOccurrenceReplayWithCtx");
    expect(rebuildSource).toContain("repairPending");
  });

  it("reconciles open deficit ownership in occurrence order before activation", () => {
    const receipt = {
      ...inbound("receipt", 20, 100),
      _id: "effect-receipt",
    };
    const saleA = {
      ...sale,
      _id: "effect-sale-a",
      businessEventKey: "sale-a",
      occurrenceAt: 30,
    };
    const saleB = {
      ...sale,
      _id: "effect-sale-b",
      businessEventKey: "sale-b",
      occurrenceAt: 10,
    };
    const replay = [saleB, receipt, saleA].reduce<ReplayState>(
      (state, effect) =>
        applyOccurrenceReplayTransition(
          state.position,
          state.deficitLots,
          effect as never,
        ),
      { deficitLots: [], position: emptyPosition },
    );
    const commitOrder = [saleA, receipt, saleB].reduce<ReplayState>(
      (state, effect) =>
        applyOccurrenceReplayTransition(
          state.position,
          state.deficitLots,
          effect as never,
        ),
      { deficitLots: [], position: emptyPosition },
    );

    expect(replay.position.unresolvedDeficitQuantity).toBe(1);
    expect(replay.deficitLots).toEqual([
      expect.objectContaining({
        outboundEffectId: "effect-sale-a",
        remainingQuantity: 1,
      }),
    ]);
    expect(commitOrder.deficitLots).toEqual([
      expect.objectContaining({ outboundEffectId: "effect-sale-b" }),
    ]);
  });

  it("activates a clean A/B owner swap through the copy-on-write pointer", async () => {
    const fixture = activationFixture();
    const { ctx, tables } = createActivationCtx(fixture.seed as never);

    await applyCandidateLotBatch(ctx, fixture.replay as never);

    expect(
      tables.reportingInventoryPosition.get("position-1")?.deficitLedgerId,
    ).toBe("ledger-candidate");
    expect(
      tables.reportingInventoryDeficitLedger.get("ledger-active")?.status,
    ).toBe("superseded");
    expect(
      tables.reportingInventoryDeficitLedger.get("ledger-candidate")?.status,
    ).toBe("active");
  });

  it("routes an A/B swap to durable withholding before the pointer", async () => {
    const fixture = activationFixture({
      postBaselineResolutionOwner: "effect-sale-a",
    });
    const { ctx, tables } = createActivationCtx(fixture.seed as never);

    await applyCandidateLotBatch(ctx, fixture.replay as never);
    expect(
      tables.reportingInventoryPosition.get("position-1")?.deficitLedgerId,
    ).toBe("ledger-active");
    expect(
      tables.reportingInventoryDeficitLedger.get("ledger-candidate")?.status,
    ).toBe("candidate");
    expect(
      tables.reportingInventoryOccurrenceReplay.get("replay-1")?.phase,
    ).toBe("withholding_financial");
  });

  it("routes an interleaved position revision to withholding without switching authority", async () => {
    const fixture = activationFixture({
      activeOwner: "effect-sale-a",
      candidateOwner: "effect-sale-a",
    });
    const seed: any = fixture.seed;
    seed.reportingInventoryPositionRevision = [
      {
        _creationTime: 150,
        _id: "revision-later",
        positionId: "position-1",
      },
    ];
    const { ctx, tables } = createActivationCtx(seed);

    await applyCandidateLotBatch(ctx, fixture.replay as never);

    expect(
      tables.reportingInventoryOccurrenceReplay.get("replay-1")?.phase,
    ).toBe("withholding_financial");
    expect(
      tables.reportingInventoryPosition.get("position-1")?.deficitLedgerId,
    ).toBe("ledger-active");
    expect(
      tables.reportingInventoryDeficitLedger.get("ledger-candidate")?.status,
    ).toBe("candidate");
  });

  it("routes fully resolved A/B evidence to withholding before the pointer", async () => {
    const fixture = activationFixture({
      postBaselineResolutionOwner: "effect-sale-b",
    });
    fixture.seed.reportingInventoryDeficitLot = [];
    Object.assign(fixture.seed.reportingInventoryEffect[0], {
      businessEventKey: "receipt:deficit-resolution:sale-b",
      organizationId: "org-1",
      productSkuId: "sku-1",
      storeId: "store-1",
    });
    fixture.seed.reportingInventoryEffect.push({
      _creationTime: 150,
      _id: "effect-resolution-later",
      businessEventKey: "receipt:deficit-resolution:later",
      effectType: "deficit_resolution",
      linkedOutboundEffectId: "effect-sale-later",
      organizationId: "org-1",
      positionId: "position-1",
      productSkuId: "sku-1",
      storeId: "store-1",
    } as any);
    fixture.seed.reportingInventoryEffect.push({
      _creationTime: 32,
      _id: "effect-resolution-exchange",
      businessEventKey: "receipt:deficit-resolution:exchange",
      effectType: "deficit_resolution",
      linkedOutboundEffectId: "effect-sale-exchange",
      organizationId: "org-1",
      positionId: "position-1",
      productSkuId: "sku-1",
      storeId: "store-1",
    } as any);
    const seed: any = fixture.seed;
    seed.reportingFact = [
      {
        _creationTime: 31,
        _id: "resolution-fact",
        adjustmentKind: "deficit_cogs_revaluation",
        amountMinor: 0,
        businessEventKey: "receipt:deficit-resolution:sale-b:fact",
        cogsKnownMinor: 100,
        completeness: "complete",
        costStatus: "known",
        coveredRevenueMinor: 200,
        currencyCode: "GHS",
        currencyMinorUnitScale: 2,
        factType: "post_close_adjustment",
        inventoryEffectId: "effect-resolution",
        occurrenceAt: 30,
        operatingDate: "2026-07-10",
        organizationId: "org-1",
        productSkuId: "sku-1",
        recognitionAt: 30,
        revenueCurrencyCode: "GHS",
        revenueCurrencyMinorUnitScale: 2,
        scheduleVersionId: "schedule-1",
        sourceDomain: "inventory",
        status: "canonical",
        storeId: "store-1",
        valuationCurrencyCode: "GHS",
        valuationCurrencyMinorUnitScale: 2,
      },
      {
        _creationTime: 151,
        _id: "resolution-fact-later",
        adjustmentKind: "deficit_cogs_revaluation",
        amountMinor: 0,
        businessEventKey: "receipt:deficit-resolution:later:fact",
        cogsKnownMinor: 100,
        completeness: "complete",
        costStatus: "known",
        coveredRevenueMinor: 200,
        currencyCode: "GHS",
        factType: "post_close_adjustment",
        inventoryEffectId: "effect-resolution-later",
        occurrenceAt: 150,
        operatingDate: "2026-07-10",
        organizationId: "org-1",
        productSkuId: "sku-1",
        recognitionAt: 150,
        revenueCurrencyCode: "GHS",
        scheduleVersionId: "schedule-1",
        sourceDomain: "inventory",
        status: "canonical",
        storeId: "store-1",
        valuationCurrencyCode: "GHS",
      },
      {
        _creationTime: 33,
        _id: "resolution-fact-exchange",
        amountMinor: 0,
        businessEventKey: "receipt:deficit-resolution:exchange:fact",
        cogsKnownMinor: 100,
        completeness: "complete",
        costStatus: "known",
        currencyCode: "GHS",
        currencyMinorUnitScale: 2,
        factType: "inventory_issue",
        inventoryContributionKind: "exchange_replacement_cogs",
        inventoryEffectId: "effect-resolution-exchange",
        occurrenceAt: 32,
        operatingDate: "2026-07-10",
        organizationId: "org-1",
        productSkuId: "sku-1",
        quantity: 1,
        recognitionAt: 32,
        scheduleVersionId: "schedule-1",
        sourceDomain: "inventory",
        status: "canonical",
        storeId: "store-1",
        valuationCurrencyCode: "GHS",
        valuationCurrencyMinorUnitScale: 2,
      },
    ];
    const { ctx, tables } = createActivationCtx(seed);

    await applyCandidateLotBatch(ctx, fixture.replay as never);
    await withholdReplayFinancialOutcomeBatch(
      ctx,
      tables.reportingInventoryOccurrenceReplay.get("replay-1") as never,
    );
    expect(
      tables.reportingInventoryPosition.get("position-1")?.deficitLedgerId,
    ).toBe("ledger-active");
    expect(
      Array.from(tables.reportingFact.values()).find((fact) =>
        fact.businessEventKey.includes(":resolution:effect-resolution:"),
      ),
    ).toMatchObject({
      cogsKnownMinor: -100,
      coveredRevenueMinor: -200,
      status: "canonical",
    });
    expect(
      Array.from(tables.reportingFact.values()).some((fact) =>
        fact.businessEventKey.includes(":resolution:effect-resolution-later:"),
      ),
    ).toBe(false);
    const exchangeCorrection = Array.from(tables.reportingFact.values()).find(
      (fact) =>
        fact.businessEventKey.includes(
          ":resolution:effect-resolution-exchange:",
        ),
    );
    expect(exchangeCorrection).toMatchObject({
      adjustmentKind: "deficit_cogs_revaluation",
      cogsKnownMinor: -100,
      quantity: 0,
      status: "canonical",
    });
    const exchangeContributions = [
      tables.reportingFact.get("resolution-fact-exchange"),
      exchangeCorrection,
    ].flatMap((fact) => deriveFactMetricContributions(fact as never));
    for (const metric of ["known_cogs", "gross_profit"]) {
      expect(
        exchangeContributions
          .filter((row) => row.metric === metric)
          .reduce((sum, row) => sum + row.value, 0),
      ).toBe(0);
    }
    const correctionCount = Array.from(tables.reportingFact.values()).filter(
      (fact) => fact.businessEventKey.startsWith("occurrence-replay-withhold:"),
    ).length;
    await withholdReplayFinancialOutcomeBatch(
      ctx,
      tables.reportingInventoryOccurrenceReplay.get("replay-1") as never,
    );
    expect(
      Array.from(tables.reportingFact.values()).filter((fact) =>
        fact.businessEventKey.startsWith("occurrence-replay-withhold:"),
      ),
    ).toHaveLength(correctionCount);
    expect(
      tables.reportingInventoryOccurrenceReplay.get("replay-1")?.status,
    ).toBe("failed");
    expect(
      tables.reportingInventoryDeficitLedger.get("ledger-candidate")?.status,
    ).toBe("abandoned");
  });

  it("distinguishes clean owner changes from financially materialized changes", () => {
    const active = [{ outboundEffectId: "sale-a", remainingQuantity: 1 }];
    const candidate = [{ outboundEffectId: "sale-b", remainingQuantity: 1 }];
    const changed = occurrenceReplayChangedDeficitOwners(active, candidate);

    expect(occurrenceReplayDeficitOwnershipMatches(active, candidate)).toBe(
      false,
    );
    expect(changed).toEqual(["sale-a", "sale-b"]);
    expect(
      occurrenceReplayOwnershipConflictRequiresFailClose(changed, []),
    ).toBe(false);
    expect(
      occurrenceReplayOwnershipConflictRequiresFailClose(changed, ["sale-b"]),
    ).toBe(true);
  });

  it("keeps established effect basis immutable and carries only the correction delta", () => {
    const establishedEffect = {
      completeness: "complete" as const,
      costLane: "merchandise_cogs" as const,
      costedQuantityDelta: -1,
      currencyCode: "GHS",
      outboundBasisMinor: 100,
      uncostedQuantityDelta: 0,
      unresolvedDeficitDelta: 0,
      valuationStatus: "current" as const,
    };
    const before = structuredClone(establishedEffect);

    expect(
      occurrenceReplayKnownCostDelta({
        outcomeKind: "outbound_basis",
        priorKnownCostMinor: establishedEffect.outboundBasisMinor,
        replayKnownCostMinor: 120,
      }),
    ).toBe(20);
    expect(establishedEffect).toEqual(before);
    const source = readFileSync(
      "convex/reporting/inventory/occurrenceReplay.ts",
      "utf8",
    );
    const activation = source.slice(
      source.indexOf("async function applyReplayFinancialOutcomesWithCtx"),
      source.indexOf("export async function applyCandidateLotBatch"),
    );
    expect(activation).not.toContain('ctx.db.patch("reportingInventoryEffect"');
    expect(activation).toContain("cogsKnownMinor: factKnownCost");
  });

  it("atomically switches the ledger with append-only correction evidence", async () => {
    const fixture = activationFixture({
      activeOwner: "effect-sale-a",
      candidateOwner: "effect-sale-a",
    });
    const originalEffect = {
      _creationTime: 40,
      _id: "effect-sale-a",
      businessEventKey: "pos:sale-a:line-1",
      cogsReversalKnownMinor: undefined,
      completeness: "complete",
      costLane: "merchandise_cogs",
      costedQuantityDelta: -1,
      createdAt: 40,
      currencyCode: "GHS",
      currencyMinorUnitScale: 2,
      effectType: "sale",
      knownCostPoolDeltaMinor: -100,
      occurrenceAt: 30,
      operatingDate: "2026-07-10",
      organizationId: "org-1",
      outboundBasisMinor: 100,
      physicalQuantityDelta: -1,
      positionId: "position-1",
      productSkuId: "sku-1",
      scheduleVersionId: "schedule-1",
      sellableQuantityDelta: -1,
      sourceDomain: "pos",
      storeId: "store-1",
      uncostedQuantityDelta: 0,
      unresolvedDeficitDelta: 0,
      valuationStatus: "current",
    };
    const outcome = {
      _creationTime: 60,
      _id: "outcome-1",
      basisCostedQuantity: 1,
      basisUncostedQuantity: 0,
      basisUnresolvedDeficitQuantity: 0,
      basisVersion: 1,
      costedQuantity: 1,
      costLane: "merchandise_cogs",
      createdAt: 60,
      currencyCode: "GHS",
      currencyMinorUnitScale: 2,
      effectId: originalEffect._id,
      knownCostMinor: 120,
      knownCostPoolBeforeMinor: 120,
      occurrenceAt: originalEffect.occurrenceAt,
      operatingDate: originalEffect.operatingDate,
      organizationId: "org-1",
      outcomeKind: "outbound_basis",
      positionId: "position-1",
      productSkuId: "sku-1",
      quantity: 1,
      replayId: fixture.replay._id,
      roundedWeightedAverageUnitCostMinor: 120,
      scheduleVersionId: originalEffect.scheduleVersionId,
      status: "candidate",
      storeId: "store-1",
      uncostedQuantity: 0,
      unresolvedDeficitQuantity: 0,
    };
    const seed: any = fixture.seed;
    seed.reportingInventoryEffect = [originalEffect];
    seed.reportingInventoryOccurrenceReplayOutcome = [outcome];
    const { ctx, tables } = createActivationCtx(seed);
    const before = structuredClone(originalEffect);

    await applyCandidateLotBatch(ctx, fixture.replay as never);

    expect(tables.reportingInventoryEffect.get(originalEffect._id)).toEqual(
      before,
    );
    expect(
      tables.reportingInventoryOccurrenceReplayOutcome.get(outcome._id),
    ).toMatchObject({ status: "applied" });
    expect(
      Array.from(tables.reportingFact.values()).find(
        (fact) =>
          fact.businessEventKey ===
          `occurrence-replay:${fixture.replay._id}:${originalEffect._id}:outbound_basis`,
      ),
    ).toMatchObject({
      adjustmentKind: "deficit_cogs_revaluation",
      cogsKnownMinor: 20,
      inventoryEffectId: originalEffect._id,
      projectionStatus: "pending",
      status: "canonical",
    });
    expect(Array.from(tables.reportingFactSourceReference.values())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "corrects",
          sourceId: originalEffect._id,
        }),
      ]),
    );
    expect(
      tables.reportingInventoryPosition.get("position-1")?.deficitLedgerId,
    ).toBe("ledger-candidate");
  });

  it("withholds 21 invalid cost outcomes across resumable idempotent batches", async () => {
    const fixture = activationFixture({
      activeOwner: "effect-sale-0",
      candidateOwner: "effect-sale-0",
    });
    const replay = {
      ...fixture.replay,
      phase: "withholding_financial",
    };
    const effects = Array.from({ length: 21 }, (_, index) => ({
      _creationTime: 30 + index,
      _id: `effect-sale-${index}`,
      businessEventKey: `pos:sale-${index}:line-1`,
      completeness: "complete",
      costLane: "merchandise_cogs",
      costedQuantityDelta: -1,
      createdAt: 30 + index,
      currencyCode: "GHS",
      currencyMinorUnitScale: 2,
      effectType: "sale",
      knownCostPoolDeltaMinor: -100,
      occurrenceAt: 30 + index,
      operatingDate: "2026-07-10",
      organizationId: "org-1",
      outboundBasisMinor: 100,
      physicalQuantityDelta: -1,
      positionId: "position-1",
      productSkuId: "sku-1",
      scheduleVersionId: "schedule-1",
      sellableQuantityDelta: -1,
      sourceDomain: "pos",
      storeId: "store-1",
      uncostedQuantityDelta: 0,
      unresolvedDeficitDelta: 0,
      valuationStatus: "current",
    }));
    const outcomes = effects.map((effect, index) => ({
      _creationTime: 100 + index,
      _id: `outcome-${index}`,
      basisCostedQuantity: 1,
      basisUncostedQuantity: 0,
      basisUnresolvedDeficitQuantity: 0,
      basisVersion: index + 1,
      costedQuantity: 1,
      costLane: "merchandise_cogs",
      createdAt: 100 + index,
      currencyCode: "GHS",
      currencyMinorUnitScale: 2,
      effectId: effect._id,
      knownCostMinor: 120,
      knownCostPoolBeforeMinor: 100,
      occurrenceAt: effect.occurrenceAt,
      operatingDate: effect.operatingDate,
      organizationId: "org-1",
      outcomeKind: "outbound_basis",
      positionId: "position-1",
      productSkuId: "sku-1",
      quantity: 1,
      replayId: replay._id,
      roundedWeightedAverageUnitCostMinor: 120,
      scheduleVersionId: effect.scheduleVersionId,
      status: "candidate",
      storeId: "store-1",
      uncostedQuantity: 0,
      unresolvedDeficitQuantity: 0,
    }));
    const sourceFacts = effects.map((effect, index) => ({
      _creationTime: 60 + index,
      _id: `sale-fact-${index}`,
      amountMinor: 200,
      businessEventKey: effect.businessEventKey,
      cogsKnownMinor: 100,
      cogsKnownQuantity: 1,
      completeness: "complete",
      costStatus: "known",
      currencyCode: "GHS",
      currencyMinorUnitScale: 2,
      factType: "sale",
      inventoryEffectId: effect._id,
      occurrenceAt: effect.occurrenceAt,
      operatingDate: effect.operatingDate,
      organizationId: "org-1",
      productSkuId: "sku-1",
      quantity: 1,
      recognitionAt: effect.occurrenceAt,
      revenueCurrencyCode: "GHS",
      revenueCurrencyMinorUnitScale: 2,
      revenueKind: "merchandise",
      scheduleVersionId: effect.scheduleVersionId,
      sourceDomain: "pos",
      status: "canonical",
      storeId: "store-1",
      valuationCurrencyCode: "GHS",
      valuationCurrencyMinorUnitScale: 2,
    }));
    const seed: any = fixture.seed;
    seed.reportingFact = sourceFacts;
    seed.reportingInventoryEffect = effects;
    seed.reportingInventoryOccurrenceReplay = [replay];
    seed.reportingInventoryOccurrenceReplayOutcome = outcomes;
    const { ctx, tables } = createActivationCtx(seed);

    await withholdReplayFinancialOutcomeBatch(ctx, replay as never);
    expect(
      Array.from(
        tables.reportingInventoryOccurrenceReplayOutcome.values(),
      ).filter((outcome) => outcome.status === "withheld"),
    ).toHaveLength(20);
    expect(
      tables.reportingInventoryPosition.get("position-1")?.deficitLedgerId,
    ).toBe("ledger-active");
    expect(
      tables.reportingInventoryDeficitLedger.get("ledger-candidate")?.status,
    ).toBe("candidate");

    await withholdReplayFinancialOutcomeBatch(
      ctx,
      tables.reportingInventoryOccurrenceReplay.get("replay-1") as never,
    );
    await withholdReplayFinancialOutcomeBatch(
      ctx,
      tables.reportingInventoryOccurrenceReplay.get("replay-1") as never,
    );

    const correctionFacts = Array.from(tables.reportingFact.values()).filter(
      (fact) => fact.businessEventKey.startsWith("occurrence-replay-withhold:"),
    );
    const correctionContributions = correctionFacts.flatMap((fact) =>
      deriveFactMetricContributions(fact as never),
    );
    const correctionTotal = (metric: string) =>
      correctionContributions
        .filter((row) => row.metric === metric)
        .reduce((sum, row) => sum + row.value, 0);
    expect(correctionFacts).toHaveLength(21);
    expect(correctionTotal("known_cogs")).toBe(-2_100);
    expect(correctionTotal("gross_profit")).toBe(-2_100);
    expect(correctionTotal("uncosted_revenue")).toBe(4_200);
    expect(
      effects.reduce(
        (sum, effect) => sum + (effect.outboundBasisMinor ?? 0),
        0,
      ) + correctionTotal("known_cogs"),
    ).toBe(0);
    expect(
      sourceFacts
        .flatMap((fact) => deriveFactMetricContributions(fact as never))
        .filter((row) => row.metric === "gross_profit")
        .reduce((sum, row) => sum + row.value, 0) +
        correctionTotal("gross_profit"),
    ).toBe(0);
    expect(
      tables.reportingInventoryOccurrenceReplay.get("replay-1"),
    ).toMatchObject({
      latestFailureCode: "financial_outcomes_withheld",
      status: "failed",
    });
    expect(
      tables.reportingInventoryPosition.get("position-1")?.deficitLedgerId,
    ).toBe("ledger-active");
    expect(
      tables.reportingInventoryDeficitLedger.get("ledger-candidate")?.status,
    ).toBe("abandoned");

    await withholdReplayFinancialOutcomeBatch(
      ctx,
      tables.reportingInventoryOccurrenceReplay.get("replay-1") as never,
    );
    expect(
      Array.from(tables.reportingFact.values()).filter((fact) =>
        fact.businessEventKey.startsWith("occurrence-replay-withhold:"),
      ),
    ).toHaveLength(21);
  });

  it("does not classify loss or adjustment lanes as merchandise COGS", () => {
    expect(occurrenceReplayFinancialMetricFamily("inventory_loss")).toBeNull();
    expect(
      occurrenceReplayFinancialMetricFamily("inventory_adjustment"),
    ).toBeNull();
    expect(occurrenceReplayFinancialMetricFamily("merchandise_cogs")).toBe(
      "known_cogs",
    );
    expect(
      occurrenceReplayResolutionFactContributesFinancially({
        adjustmentKind: undefined,
        inventoryContributionKind: undefined,
      }),
    ).toBe(false);
    expect(
      occurrenceReplayResolutionFactContributesFinancially({
        adjustmentKind: "deficit_cogs_revaluation",
        inventoryContributionKind: undefined,
      }),
    ).toBe(true);
    expect(
      occurrenceReplayResolutionFactContributesFinancially({
        adjustmentKind: undefined,
        inventoryContributionKind: "exchange_replacement_cogs",
      }),
    ).toBe(true);
  });

  it("reconciles covered revenue across known, partial, and unknown transitions", () => {
    expect(
      occurrenceReplayCoveredRevenueDelta({
        amountMinor: 1_000,
        costStatus: "known",
        priorCostedQuantity: 10,
        quantity: 10,
        replayCostedQuantity: 4,
      }),
    ).toBe(-600);
    expect(
      occurrenceReplayCoveredRevenueDelta({
        amountMinor: 1_000,
        costStatus: "partial",
        originalCoveredRevenueMinor: 400,
        priorCostedQuantity: 4,
        quantity: 10,
        replayCostedQuantity: 10,
      }),
    ).toBe(600);
    expect(
      occurrenceReplayCoveredRevenueDelta({
        amountMinor: 1_000,
        costStatus: "unknown",
        priorCostedQuantity: 0,
        quantity: 10,
        replayCostedQuantity: 10,
      }),
    ).toBe(1_000);
  });

  it("reverses established known COGS when replay becomes fully uncosted", () => {
    expect(
      occurrenceReplayKnownCostDelta({
        outcomeKind: "outbound_basis",
        priorKnownCostMinor: 250,
        replayKnownCostMinor: 0,
      }),
    ).toBe(-250);
    expect(
      occurrenceReplayKnownCostDelta({
        outcomeKind: "return_reversal",
        priorKnownCostMinor: 250,
        replayKnownCostMinor: 0,
      }),
    ).toBe(250);
  });

  it("accepts five changed outcomes while retaining a bounded atomic activation", () => {
    expect(INVENTORY_REPLAY_ATOMIC_OUTCOME_LIMIT).toBeGreaterThanOrEqual(5);
    expect(() => assertOccurrenceReplayOutcomeActivationBound(5)).not.toThrow();
    expect(() =>
      assertOccurrenceReplayOutcomeActivationBound(
        INVENTORY_REPLAY_ATOMIC_OUTCOME_LIMIT + 1,
      ),
    ).toThrow("exceeds atomic limit");
  });

  it("validates outcome tranches and lineage-sensitive semantic equality", () => {
    expect(() =>
      validateOccurrenceReplayOutcomeQuantities({
        costedQuantity: 1,
        quantity: 3,
        uncostedQuantity: 1,
        unresolvedDeficitQuantity: 0,
      }),
    ).toThrow("do not reconcile");
    expect(
      occurrenceReplayOutcomesMatch(
        {
          costLane: "merchandise_cogs",
          knownCostMinor: 100,
          occurrenceAt: 10,
          operatingDate: "2026-07-10",
          outcomeKind: "outbound_basis",
          scheduleVersionId: "schedule-a" as never,
        },
        {
          costLane: "merchandise_cogs",
          knownCostMinor: 100,
          occurrenceAt: 10,
          operatingDate: "2026-07-10",
          outcomeKind: "outbound_basis",
          scheduleVersionId: "schedule-b" as never,
        },
      ),
    ).toBe(false);
  });

  it("stages a zero-known return when it must reverse a prior known reversal", () => {
    expect(
      shouldStageOccurrenceReplayOutcome(
        {
          cogsReversalKnownMinor: 100,
          completeness: "complete",
          costLane: "merchandise_cogs",
          costedQuantityDelta: 1,
          currencyCode: "GHS",
          outboundBasisMinor: undefined,
          uncostedQuantityDelta: 0,
          unresolvedDeficitDelta: 0,
          valuationStatus: "current",
        },
        {
          costedQuantity: 0,
          costLane: "merchandise_cogs",
          currencyCode: undefined,
          knownCostMinor: 0,
          outcomeKind: "return_reversal",
          uncostedQuantity: 1,
          unresolvedDeficitQuantity: 0,
        },
      ),
    ).toBe(true);
  });

  it("reconciles correction lots and rejects incompatible replay currency", () => {
    const corrected = applyOccurrenceReplayTransition(
      {
        ...emptyPosition,
        unresolvedDeficitQuantity: 2,
      },
      [
        {
          costLane: "merchandise_cogs",
          occurredAt: 10,
          outboundEffectId: "sale-a",
          remainingQuantity: 2,
        },
      ],
      {
        _id: "correction-1",
        businessEventKey: "correction-1",
        occurrenceAt: 20,
        physicalQuantityDelta: 0,
        replayValuation: {
          costedQuantity: 0,
          currency: undefined,
          kind: "valuation_correction",
          knownCostPoolMinor: 0,
          uncostedQuantity: 0,
          unresolvedDeficitQuantity: 0,
        },
      } as never,
    );
    expect(corrected.deficitLots).toEqual([]);
    expect(corrected.position.unresolvedDeficitQuantity).toBe(0);
    expect(() =>
      assertOccurrenceReplayCurrencyCompatible(
        { ...emptyPosition, currency: "GHS" },
        {
          ...inbound("receipt", 20, 100),
          _id: "receipt-1",
          replayValuation: {
            ...inbound("receipt", 20, 100).replayValuation,
            costBasis: {
              ...inbound("receipt", 20, 100).replayValuation.costBasis,
              currency: "USD",
            },
          },
        } as never,
      ),
    ).toThrow("currency conflict");
  });
});
