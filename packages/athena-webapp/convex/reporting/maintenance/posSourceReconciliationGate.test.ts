/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../../schema";
import { backfillAuthorizationEnvelopeHash } from "./backfillAuthorization";

import {
  assertPosSourceReconciliationActivationReady,
  findSkuAttributionUpdatedAfterWithCtx,
  persistPosSourceReconciliationWithCtx,
  projectionRebuildLineage,
  reportingRunRequiresPosSourceReconciliation,
  requireVerifiedPosBackfillLineageWithCtx,
} from "./posSourceReconciliationGate";
import { sourceDerivedPosCensusHash } from "./posCensusContract";

const modules = import.meta.glob("../../**/*.ts");

const candidate = {
  organizationId: "org-1",
  storeId: "store-1",
};

const authoritativeSourceCount = 4;
const authoritativeSourceDigest = "source-digest-1";
const orphanPaymentCorrectionCount = 2;
const sourceCensusHash = sourceDerivedPosCensusHash({
  authoritativeSourceCount,
  authoritativeSourceDigest,
  factContractVersion: 2,
  financialDateContractVersion: 2,
  frozenWatermark: 500,
  journalTerminalId: "journal-3",
  journalTerminalRecordedAt: 400,
  manifestDigest: "manifest-digest-1",
  orphanPaymentCorrectionCount,
  skuAttributionTerminalSequence: 1,
});

it("invalidates certification when SKU attribution changes after apply", async () => {
  const rows = [
    { status: "completed", storeId: "store-1", updatedAt: 501 },
  ];
  const ctx = {
    db: {
      query: () => {
        const filters: Array<(row: (typeof rows)[number]) => boolean> = [];
        const builder = {
          eq(field: keyof (typeof rows)[number], value: unknown) {
            filters.push((row) => row[field] === value);
            return builder;
          },
          gt(field: keyof (typeof rows)[number], value: number) {
            filters.push((row) => Number(row[field]) > value);
            return builder;
          },
        };
        return {
          withIndex: (_name: string, apply: (q: typeof builder) => unknown) => {
            apply(builder);
            return {
              first: async () => rows.find((row) => filters.every((fn) => fn(row))) ?? null,
            };
          },
        };
      },
    },
  } as never;
  await expect(
    findSkuAttributionUpdatedAfterWithCtx(ctx, {
      certifiedAt: 500,
      storeId: "store-1" as never,
    }),
  ).resolves.toMatchObject({ updatedAt: 501 });
});

const run = {
  backfillAuthorizationGrantId: "grant-1",
  censusToken: "census-1",
  financialDateContractVersion: 2,
  organizationId: "org-1",
  orphanPaymentCorrectionCount,
  sourceScope: "pos" as const,
  sourceCensusHash,
  factSnapshotWatermark: 450,
  storeId: "store-1",
  skuAttributionTerminalSequence: 1,
};

const grant = {
  _id: "grant-1",
  contractVersion: 2,
  migrationPurpose: "reports_financial_truth_reset_backfill" as const,
  organizationId: "org-1",
  runId: "backfill-run-1",
  sourceScope: "pos" as const,
  status: "running" as const,
  storeId: "store-1",
};

const reconciliation = {
  authoritativeSourceCount,
  authoritativeSourceDigest,
  censusToken: "census-1",
  completedAt: 100,
  contractVersion: 2,
  factAmountMinor: 12_500,
  factCount: 4,
  factQuantity: 4,
  grantId: "grant-1",
  organizationId: "org-1",
  orphanPaymentCorrectionCount,
  runId: "backfill-run-1",
  sourceAmountMinor: 12_500,
  sourceCount: 4,
  sourceQuantity: 4,
  status: "verified" as const,
  storeId: "store-1",
  unexplainedCount: 0,
  sourceCensusHash,
  factSnapshotWatermark: 450,
  journalCount: 3,
  journalMatchedCount: 3,
  lifecycleJournalTerminalId: "journal-3",
  lifecycleJournalTerminalRecordedAt: 400,
  sourceManifestDigest: "manifest-digest-1",
  sourceManifestId: "manifest-1",
  skuAttributionTerminalSequence: 1,
};

describe("POS source reconciliation activation gate", () => {
  it("accepts exact verified grant, census, contract, run, and store lineage", () => {
    expect(() =>
      assertPosSourceReconciliationActivationReady({
        candidate,
        grant,
        reconciliation,
        run,
      }),
    ).not.toThrow();
  });

  it.each(["store_day", "sku_day", "current_inventory"] as const)(
    "accepts a %s derived run carrying the certified nonzero orphan count",
    (projectionKind) => {
      expect(() =>
        assertPosSourceReconciliationActivationReady({
          candidate: { ...candidate, projectionKind } as never,
          grant,
          reconciliation,
          run: { ...run, orphanPaymentCorrectionCount },
        }),
      ).not.toThrow();
    },
  );

  it.each([
    ["missing grant", { grant: null }],
    ["missing reconciliation", { reconciliation: null }],
    ["grant", { grant: { ...grant, _id: "grant-other" } }],
    ["run", { reconciliation: { ...reconciliation, runId: "run-other" } }],
    ["store", { grant: { ...grant, storeId: "store-other" } }],
    ["census", { reconciliation: { ...reconciliation, censusToken: "other" } }],
    ["version", { reconciliation: { ...reconciliation, contractVersion: 1 } }],
  ] as const)("rejects mismatched %s lineage", (_label, override) => {
    expect(() =>
      assertPosSourceReconciliationActivationReady({
        candidate,
        grant,
        reconciliation,
        run,
        ...override,
      }),
    ).toThrow("POS source reconciliation lineage is incompatible");
  });

  it("rejects nonzero unexplained or aggregate deltas even when net values cancel elsewhere", () => {
    for (const changed of [
      { unexplainedCount: 1 },
      { factAmountMinor: reconciliation.sourceAmountMinor + 1 },
      { factQuantity: reconciliation.sourceQuantity - 1 },
      { factCount: reconciliation.sourceCount + 1 },
      { authoritativeSourceCount: reconciliation.sourceCount + 1 },
    ]) {
      expect(() =>
        assertPosSourceReconciliationActivationReady({
          candidate,
          grant,
          reconciliation: { ...reconciliation, ...changed },
          run,
        }),
      ).toThrow("POS source reconciliation is not verified");
    }
  });

  it("gates only runs explicitly tied to the new reset/backfill lineage and fails closed on partial markers", () => {
    expect(reportingRunRequiresPosSourceReconciliation({})).toBe(false);
    expect(reportingRunRequiresPosSourceReconciliation(run)).toBe(true);
    expect(() =>
      reportingRunRequiresPosSourceReconciliation({
        backfillAuthorizationGrantId: "grant-1",
      }),
    ).toThrow("POS source reconciliation lineage is incomplete");
  });

  it("accepts fractional Convex creation times as fact snapshot watermarks", () => {
    const factSnapshotWatermark = 1_783_905_037_512.2031;
    expect(
      reportingRunRequiresPosSourceReconciliation({
        ...run,
        factSnapshotWatermark,
      }),
    ).toBe(true);
    expect(
      projectionRebuildLineage({
        backfillAuthorizationGrantId: "grant-1",
        censusToken: "census-1",
        factSnapshotWatermark,
        financialDateContractVersion: 2,
        frozenWatermark: 500,
        sourceCensusHash: "source-census-1",
        sourceScope: "pos",
      }),
    ).toMatchObject({ factSnapshotWatermark });
  });

  it("binds every rebuild to the completed backfill census and exact frozen watermark", async () => {
    const envelope = {
      contractVersion: 2,
      migrationPurpose: "reports_financial_truth_reset_backfill" as const,
      organizationId: "org-1",
      requestNonce: "nonce-1",
      sourceScope: "pos" as const,
      storeId: "store-1",
      timezoneContentHash: "timezone-hash-1",
    };
    const envelopeHash = backfillAuthorizationEnvelopeHash(envelope);
    const authorizedCensusToken = `reporting-pos-census-v1:${envelopeHash}`;
    const lineage = projectionRebuildLineage({
      backfillAuthorizationGrantId: "grant-1",
      censusToken: authorizedCensusToken,
      financialDateContractVersion: 2,
      factSnapshotWatermark: 450,
      frozenWatermark: 500,
      sourceCensusHash,
      sourceScope: "pos",
    })!;
    const authorizedGrant = {
      ...grant,
      ...envelope,
      athenaUserId: "user-1",
      envelopeHash,
      identitySubject: "subject-1",
      membershipId: "membership-1",
      roleSnapshot: "full_admin" as const,
      status: "completed" as const,
    };
    const sourceRun = {
      ...run,
      _id: "backfill-run-1",
      actorKind: "human",
      actorUserId: "user-1",
      censusToken: authorizedCensusToken,
      domain: "reporting",
      factContractVersion: 2,
      frozenWatermark: 500,
      operation: "financial_truth_reset_backfill",
      projectionContractVersion: 2,
      requestKey: envelopeHash,
      runType: "backfill",
      status: "completed",
    };
    let membershipRole = "full_admin";
    let lateJournalEvidence = false;
    let attributionTerminal = 1;
    let unresolvedAttributionConflict = false;
    const ctx = {
      db: {
        get: async (table: string, id: string) =>
          table === "reportingBackfillAuthorizationGrant" && id === "grant-1"
            ? authorizedGrant
            : table === "reportingRun" && id === "backfill-run-1"
              ? sourceRun
              : table === "reportingBackfillApplyManifest" && id === "manifest-1"
                ? {
                    digest: "manifest-digest-1",
                    organizationId: "org-1",
                    status: "completed",
                    storeId: "store-1",
                  }
              : table === "athenaUser" && id === "user-1"
                ? { _id: "user-1" }
                : table === "organizationMember" && id === "membership-1"
                  ? { organizationId: "org-1", role: membershipRole, userId: "user-1" }
                  : table === "store" && id === "store-1"
                    ? { organizationId: "org-1" }
                    : table === "reportingBackfillApplyManifest" && id === "manifest-1"
                      ? {
                          digest: "manifest-digest-1",
                          organizationId: "org-1",
                          status: "completed",
                          storeId: "store-1",
                        }
              : null,
        query: (table: string) => {
          const chain = {
            filter: () => chain,
            first: async () => table === "reportingSkuAttribution"
              ? unresolvedAttributionConflict
                ? { materialSequence: attributionTerminal, status: "conflict" }
                : null
              : table === "reportingSkuAttributionCursor"
              ? {
                  latestAppliedSequence: attributionTerminal,
                  latestMaterialSequence: attributionTerminal,
                }
              : table === "posLifecycleJournal" && lateJournalEvidence
                ? { _id: "journal-late", occurredAt: 499, recordedAt: 600 }
                : null,
            take: async () => table === "storeTimezoneVersion"
              ? [{ organizationId: "org-1", source: "admin_authorized" }]
              : [{ ...reconciliation, censusToken: authorizedCensusToken }],
            withIndex: () => chain,
          };
          return chain;
        },
      },
    };

    await expect(
      requireVerifiedPosBackfillLineageWithCtx(ctx as never, {
        lineage,
        organizationId: "org-1" as never,
        storeId: "store-1" as never,
      }),
    ).resolves.toEqual({ orphanPaymentCorrectionCount });
    attributionTerminal = 2;
    await expect(
      requireVerifiedPosBackfillLineageWithCtx(ctx as never, {
        lineage: { ...lineage, skuAttributionTerminalSequence: 2 },
        organizationId: "org-1" as never,
        storeId: "store-1" as never,
      }),
    ).resolves.toEqual({ orphanPaymentCorrectionCount });
    await expect(
      requireVerifiedPosBackfillLineageWithCtx(ctx as never, {
        lineage,
        organizationId: "org-1" as never,
        storeId: "store-1" as never,
      }),
    ).rejects.toThrow("verified POS backfill lineage");
    attributionTerminal = 1;
    unresolvedAttributionConflict = true;
    await expect(
      requireVerifiedPosBackfillLineageWithCtx(ctx as never, {
        lineage,
        organizationId: "org-1" as never,
        storeId: "store-1" as never,
      }),
    ).rejects.toThrow("verified POS backfill lineage");
    unresolvedAttributionConflict = false;
    membershipRole = "inventory_manager";
    await expect(
      requireVerifiedPosBackfillLineageWithCtx(ctx as never, {
        lineage,
        organizationId: "org-1" as never,
        storeId: "store-1" as never,
      }),
    ).rejects.toThrow("authority is no longer valid");
    membershipRole = "full_admin";
    lateJournalEvidence = true;
    await expect(
      requireVerifiedPosBackfillLineageWithCtx(ctx as never, {
        lineage,
        organizationId: "org-1" as never,
        storeId: "store-1" as never,
      }),
    ).rejects.toThrow("verified POS backfill lineage");
    lateJournalEvidence = false;
    await expect(
      requireVerifiedPosBackfillLineageWithCtx(ctx as never, {
        lineage: { ...lineage, frozenWatermark: 501 },
        organizationId: "org-1" as never,
        storeId: "store-1" as never,
      }),
    ).rejects.toThrow("verified POS backfill lineage");
  });

  it("persists one idempotent verified certificate from exact grant-bound lineage", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "admin@example.test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Test",
        slug: "test",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Store",
        organizationId,
        slug: "store",
      });
      const membershipId = await ctx.db.insert("organizationMember", {
        organizationId,
        role: "full_admin",
        userId,
      });
      const runId = await ctx.db.insert("reportingRun", {
        actorKind: "human",
        actorUserId: userId,
        censusToken: "census-1",
        createdAt: 1,
        domain: "reporting",
        factContractVersion: 1,
        factSnapshotWatermark: 1_783_905_037_512.2031,
        failedCount: 0,
        financialDateContractVersion: 2,
        metricContractVersion: 1,
        operation: "pos_reset_backfill",
        organizationId,
        processedCount: 0,
        projectionContractVersion: 1,
        runType: "backfill",
        sourceScope: "pos",
        sourceCensusHash: "source-census-1",
        status: "running",
        storeId,
      });
      const grantId = await ctx.db.insert(
        "reportingBackfillAuthorizationGrant",
        {
          athenaUserId: userId,
          authorizedAt: 1,
          contractVersion: 2,
          envelopeHash: "envelope-1",
          identitySubject: "subject-1",
          membershipId,
          migrationPurpose: "reports_financial_truth_reset_backfill",
          organizationId,
          requestNonce: "nonce-1",
          roleSnapshot: "full_admin",
          runId,
          sourceScope: "pos",
          status: "running",
          storeId,
          timezoneContentHash: "tz-1",
        },
      );
      await ctx.db.patch("reportingRun", runId, {
        backfillAuthorizationGrantId: grantId,
      });
      const input = {
        authoritativeSourceCount: 1,
        authoritativeSourceDigest: "source-digest-1",
        censusToken: "census-1",
        contractVersion: 2,
        factAmountMinor: 1_000,
        factCount: 1,
        factQuantity: 1,
        factSnapshotWatermark: 1_783_905_037_512.2031,
        grantId,
        journalCount: 1,
        journalMatchedCount: 1,
        orphanPaymentCorrectionCount: 0,
        runId,
        sourceAmountMinor: 1_000,
        sourceCount: 1,
        sourceQuantity: 1,
        sourceCensusHash: "source-census-1",
        unexplainedCount: 0,
      };
      const firstId = await persistPosSourceReconciliationWithCtx(ctx, input);
      const secondId = await persistPosSourceReconciliationWithCtx(ctx, input);
      expect(secondId).toBe(firstId);
      await expect(
        persistPosSourceReconciliationWithCtx(ctx, {
          ...input,
          factAmountMinor: input.factAmountMinor + 1,
        }),
      ).rejects.toThrow("result is immutable");
      expect(
        await ctx.db.get("reportingPosSourceReconciliation", firstId),
      ).toMatchObject({ status: "verified", unexplainedCount: 0 });
    });
  });
});
