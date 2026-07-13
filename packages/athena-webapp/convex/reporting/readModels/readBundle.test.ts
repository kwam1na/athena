/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import schema from "../../schema";
import {
  assertReadBundleMembers,
  skuAttributionTerminalCanActivate,
  skuAttributionTerminalIsCurrent,
  getActiveReadBundleWithCtx,
  rollbackReportsReadBundle,
  tryActivateVerifiedReportsReadBundleForStore,
} from "./readBundle";
import { backfillAuthorizationEnvelopeHash } from "../maintenance/backfillAuthorization";

const modules = import.meta.glob("../../**/*.ts");

it("requires the first bundle to certify a non-empty attribution cursor", () => {
  expect(
    skuAttributionTerminalCanActivate({ cursor: null, terminal: undefined }),
  ).toBe(true);
  expect(
    skuAttributionTerminalCanActivate({
      cursor: { latestAppliedSequence: 1, latestMaterialSequence: 1 },
      terminal: undefined,
    }),
  ).toBe(false);
  expect(
    skuAttributionTerminalCanActivate({
      cursor: { latestAppliedSequence: 1, latestMaterialSequence: 1 },
      terminal: 1,
    }),
  ).toBe(true);
});

it("makes a post-activation conflict stale until its new terminal is activated", () => {
  expect(
    skuAttributionTerminalIsCurrent({
      cursor: {
        latestActivatedSequence: 1,
        latestAppliedSequence: 1,
        latestMaterialSequence: 2,
      },
      terminal: 1,
    }),
  ).toBe(false);
  expect(
    skuAttributionTerminalIsCurrent({
      cursor: {
        latestActivatedSequence: 1,
        latestAppliedSequence: 2,
        latestMaterialSequence: 2,
      },
      terminal: 1,
    }),
  ).toBe(false);
  expect(
    skuAttributionTerminalIsCurrent({
      cursor: {
        latestActivatedSequence: 2,
        latestAppliedSequence: 2,
        latestMaterialSequence: 2,
      },
      terminal: 2,
    }),
  ).toBe(true);
});

function members() {
  return ["store_day", "sku_day", "current_inventory"].map((projectionKind) => ({
    epoch: { _id: `epoch-${projectionKind}`, sourceGenerationId: `generation-${projectionKind}`, sourceWatermark: 100, status: "active" },
    generation: { _id: `generation-${projectionKind}`, factContractVersion: 2, metricContractVersion: 1, organizationId: "org-1", projectionContractVersion: 2, projectionKind, runId: `run-${projectionKind}`, stableWatermark: 100, status: "active", storeId: "store-1" },
    run: { _id: `run-${projectionKind}`, backfillAuthorizationGrantId: "grant-1", censusToken: "census-1", factSnapshotWatermark: 100, financialDateContractVersion: 2, organizationId: "org-1", sourceCensusHash: "census-hash-1", sourceScope: "pos", storeId: "store-1" },
  })) as never;
}

const reconciliation = {
  censusToken: "census-1", completedAt: 100, contractVersion: 2,
  factAmountMinor: 500, factCount: 2, factQuantity: 3, grantId: "grant-1",
  organizationId: "org-1", sourceAmountMinor: 500, sourceCount: 2,
  sourceQuantity: 3, status: "verified", storeId: "store-1", unexplainedCount: 0,
  factSnapshotWatermark: 100, sourceCensusHash: "census-hash-1",
} as never;

async function seedBundleCandidate(
  ctx: any,
  input: {
    censusToken: string;
    grantId: string;
    organizationId: string;
    storeId: string;
    userId: string;
    watermark: number;
    activatedAt?: number;
    skuAttributionTerminalSequence?: number;
  },
) {
  for (const projectionKind of [
    "store_day",
    "sku_day",
    "current_inventory",
  ] as const) {
    const runId = await ctx.db.insert("reportingRun", {
      actorKind: "automation",
      automationIdentity: "reports-test",
      backfillAuthorizationGrantId: input.grantId,
      censusToken: input.censusToken,
      createdAt: input.watermark,
      domain: "reporting",
      factContractVersion: 2,
      failedCount: 0,
      financialDateContractVersion: 2,
      factSnapshotWatermark: input.watermark,
      frozenWatermark: input.watermark,
      metricContractVersion: 1,
      operation: "projection_rebuild_complete",
      organizationId: input.organizationId,
      processedCount: 0,
      projectionContractVersion: 2,
      runType: "rebuild",
      sourceScope: "pos",
      sourceCensusHash: "census-hash-1",
      skuAttributionTerminalSequence:
        input.skuAttributionTerminalSequence,
      status: "completed",
      storeId: input.storeId,
    });
    const generationId = await ctx.db.insert("reportingProjectionGeneration", {
      completeness: "complete",
      createdAt: input.watermark,
      factContractVersion: 2,
      metricContractVersion: 1,
      organizationId: input.organizationId,
      projectionContractVersion: 2,
      projectionKind,
      runId,
      sourceWatermark: input.watermark,
      skuAttributionTerminalSequence:
        input.skuAttributionTerminalSequence,
      stableWatermark: input.watermark,
      status: "active",
      storeId: input.storeId,
    });
    await ctx.db.patch("reportingRun", runId, { generationId });
    await ctx.db.insert("reportingProjectionActivation", {
      activationRunId: runId,
      activatedAt: input.activatedAt ?? input.watermark,
      factContractVersion: 2,
      generationId,
      metricContractVersion: 1,
      organizationId: input.organizationId,
      projectionContractVersion: 2,
      projectionKind,
      storeId: input.storeId,
    });
    await ctx.db.insert("reportingWorkspaceMaterializationEpoch", {
      activatedAt: input.activatedAt ?? input.watermark,
      presetIndex: 0,
      projectionKind,
      sequence: 1,
      sourceGenerationId: generationId,
      sourceWatermark: input.watermark,
      skuAttributionTerminalSequence:
        input.skuAttributionTerminalSequence,
      startedAt: input.watermark,
      status: "active",
      storeId: input.storeId,
      updatedAt: input.watermark,
      verifiedAt: input.watermark,
    });
  }
}

async function seedStore(ctx: any) {
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
  const requestNonce = "nonce-1";
  const timezoneContentHash = "tz-1";
  const envelopeHash = backfillAuthorizationEnvelopeHash({
    contractVersion: 2,
    migrationPurpose: "reports_financial_truth_reset_backfill",
    organizationId: String(organizationId),
    requestNonce,
    sourceScope: "pos",
    storeId: String(storeId),
    timezoneContentHash,
  });
  const censusToken = `reporting-pos-census-v1:${envelopeHash}`;
  await ctx.db.insert("storeTimezoneVersion", {
    authorizedAt: 1,
    authorizedByUserId: userId,
    contentHash: timezoneContentHash,
    createdAt: 1,
    effectiveFrom: 0,
    evidenceHash: "timezone-evidence-1",
    organizationId,
    source: "admin_authorized",
    storeId,
    timezone: "Africa/Accra",
  });
  const grantId = await ctx.db.insert("reportingBackfillAuthorizationGrant", {
    athenaUserId: userId,
    authorizedAt: 1,
    contractVersion: 2,
    envelopeHash,
    identitySubject: "subject-1",
    membershipId,
    migrationPurpose: "reports_financial_truth_reset_backfill",
    organizationId,
    requestNonce,
    roleSnapshot: "full_admin",
    sourceScope: "pos",
    status: "completed",
    storeId,
    timezoneContentHash,
  });
  const sourceRunId = await ctx.db.insert("reportingRun", {
    actorKind: "human",
    actorUserId: userId,
    backfillAuthorizationGrantId: grantId,
    censusToken,
    createdAt: 1,
    domain: "reporting",
    factContractVersion: 2,
    failedCount: 0,
    financialDateContractVersion: 2,
    frozenWatermark: 1,
    factSnapshotWatermark: 100,
    metricContractVersion: 1,
    operation: "financial_truth_reset_backfill",
    organizationId,
    processedCount: 0,
    projectionContractVersion: 2,
    requestKey: envelopeHash,
    runType: "backfill",
    sourceScope: "pos",
    sourceCensusHash: "census-hash-1",
    status: "completed",
    storeId,
  });
  await ctx.db.patch("reportingBackfillAuthorizationGrant", grantId, {
    runId: sourceRunId,
  });
  await ctx.db.insert("reportingPosSourceReconciliation", {
    censusToken,
    completedAt: 2,
    contractVersion: 2,
    factAmountMinor: 500,
    factCount: 2,
    factQuantity: 3,
    grantId,
    organizationId,
    runId: sourceRunId,
    sourceAmountMinor: 500,
    sourceCount: 2,
    sourceQuantity: 3,
    factSnapshotWatermark: 100,
    sourceCensusHash: "census-hash-1",
    status: "verified",
    storeId,
    unexplainedCount: 0,
    updatedAt: 2,
  });
  return {
    censusToken,
    grantId,
    membershipId,
    organizationId,
    sourceRunId,
    storeId,
    userId,
  };
}

async function insertLateJournalEvidence(ctx: any, ids: any, suffix: string) {
  const transactionId = await ctx.db.insert("posTransaction", {
    completedAt: 1,
    payments: [],
    receiptPrinted: false,
    status: "completed",
    storeId: ids.storeId,
    subtotal: 100,
    tax: 0,
    total: 100,
    totalPaid: 100,
    transactionNumber: `POS-LATE-${suffix}`,
  });
  await ctx.db.insert("posLifecycleJournal", {
    contentFingerprint: `late-sale-${suffix}`,
    eventKey: `pos:${transactionId}:completed`,
    eventKind: "completed",
    occurredAt: 1,
    organizationId: ids.organizationId,
    origin: "cloud",
    recordedAt: 99,
    sequence: 99,
    storeId: ids.storeId,
    transactionId,
  });
}

describe("Reports atomic read bundle", () => {
  it("seals the exact compatible projection and workspace set", () => {
    expect(assertReadBundleMembers({ members: members(), reconciliation })).toMatchObject({
      censusToken: "census-1",
      grantId: "grant-1",
      sourceWatermark: 100,
      storeId: "store-1",
    });
  });

  it("rejects a mixed watermark before public activation", () => {
    const input = members() as any[];
    input[1].generation.stableWatermark = 99;
    expect(() => assertReadBundleMembers({ members: input as never, reconciliation })).toThrow("member lineage");
  });

  it("rejects unexplained source-to-fact differences", () => {
    expect(() => assertReadBundleMembers({ members: members(), reconciliation: { ...(reconciliation as any), unexplainedCount: 1 } as never })).toThrow("reconciliation");
  });

  it("activates a compatible bundle once when the handler is retried", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ids = await seedStore(ctx);
      await seedBundleCandidate(ctx, { ...ids, watermark: 100 });
      const handler = (
        tryActivateVerifiedReportsReadBundleForStore as unknown as {
          _handler: Function;
        }
      )._handler;

      const first = await handler(ctx, { storeId: ids.storeId });
      const retry = await handler(ctx, { storeId: ids.storeId });
      const activations = await ctx.db
        .query("reportingReadBundleActivation")
        .take(2);

      expect(retry).toEqual(first);
      expect(activations).toHaveLength(1);
      expect(activations[0]?.supersededAt).toBeUndefined();
    });
    vi.restoreAllMocks();
  });

  it("invalidates certification when late pre-watermark journal evidence appears", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ids = await seedStore(ctx);
      await seedBundleCandidate(ctx, { ...ids, watermark: 100 });
      const activate = (
        tryActivateVerifiedReportsReadBundleForStore as unknown as {
          _handler: Function;
        }
      )._handler;
      await expect(activate(ctx, { storeId: ids.storeId })).resolves.toMatchObject({
        status: "active",
      });
      const transactionId = await ctx.db.insert("posTransaction", {
        completedAt: 1,
        payments: [],
        receiptPrinted: false,
        status: "completed",
        storeId: ids.storeId,
        subtotal: 100,
        tax: 0,
        total: 100,
        totalPaid: 100,
        transactionNumber: "POS-LATE-1",
      });
      await ctx.db.insert("posLifecycleJournal", {
        contentFingerprint: "late-sale-1",
        eventKey: `pos:${transactionId}:completed`,
        eventKind: "completed",
        occurredAt: 1,
        organizationId: ids.organizationId,
        origin: "cloud",
        recordedAt: 99,
        sequence: 99,
        storeId: ids.storeId,
        transactionId,
      });
      await expect(
        getActiveReadBundleWithCtx(ctx, ids.storeId),
      ).resolves.toBeNull();

      await expect(activate(ctx, { storeId: ids.storeId })).resolves.toEqual({
        status: "not_ready",
      });
      const certificate = await ctx.db
        .query("reportingPosSourceReconciliation")
        .first();
      expect(certificate).toMatchObject({
        status: "blocked",
        unexplainedCount: 1,
      });
      expect(certificate).not.toHaveProperty("completedAt");
      expect(
        await ctx.db.query("reportingReadBundleActivation").take(1),
      ).toHaveLength(1);
    });
  });

  it("rejects bundle activation when the authorizing admin role is revoked", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ids = await seedStore(ctx);
      await seedBundleCandidate(ctx, { ...ids, watermark: 100 });
      await ctx.db.patch("organizationMember", ids.membershipId, {
        role: "pos_only",
      });
      const activate = (
        tryActivateVerifiedReportsReadBundleForStore as unknown as {
          _handler: Function;
        }
      )._handler;

      await expect(
        activate(ctx, { storeId: ids.storeId }),
      ).rejects.toThrow("authority is no longer valid");
      expect(
        await ctx.db.query("reportingReadBundleActivation").take(1),
      ).toHaveLength(0);
    });
  });

  it("rejects bundle activation when membership moves across tenants", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ids = await seedStore(ctx);
      await seedBundleCandidate(ctx, { ...ids, watermark: 100 });
      const otherOrganizationId = await ctx.db.insert("organization", {
        createdByUserId: ids.userId,
        name: "Other tenant",
        slug: "other-tenant",
      });
      await ctx.db.patch("organizationMember", ids.membershipId, {
        organizationId: otherOrganizationId,
      });
      const activate = (
        tryActivateVerifiedReportsReadBundleForStore as unknown as {
          _handler: Function;
        }
      )._handler;

      await expect(
        activate(ctx, { storeId: ids.storeId }),
      ).rejects.toThrow("authority is no longer valid");
      expect(
        await ctx.db.query("reportingReadBundleActivation").take(1),
      ).toHaveLength(0);
    });
  });

  it("does not mutate a cross-tenant certificate when late evidence is present", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ids = await seedStore(ctx);
      await seedBundleCandidate(ctx, { ...ids, watermark: 100 });
      const certificate = await ctx.db
        .query("reportingPosSourceReconciliation")
        .first();
      const otherOrganizationId = await ctx.db.insert("organization", {
        createdByUserId: ids.userId,
        name: "Foreign",
        slug: "foreign",
      });
      await ctx.db.patch("reportingPosSourceReconciliation", certificate!._id, {
        organizationId: otherOrganizationId,
      });
      await insertLateJournalEvidence(ctx, ids, "FOREIGN");
      const activate = (
        tryActivateVerifiedReportsReadBundleForStore as unknown as {
          _handler: Function;
        }
      )._handler;

      await expect(activate(ctx, { storeId: ids.storeId })).rejects.toThrow(
        "reconciliation is incompatible",
      );
      expect(
        await ctx.db.get("reportingPosSourceReconciliation", certificate!._id),
      ).toMatchObject({
        completedAt: 2,
        organizationId: otherOrganizationId,
        status: "verified",
        unexplainedCount: 0,
      });
    });
  });

  it("rejects rollback when late evidence makes the target certificate stale", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ids = await seedStore(ctx);
      const activate = (
        tryActivateVerifiedReportsReadBundleForStore as unknown as {
          _handler: Function;
        }
      )._handler;
      const rollback = (
        rollbackReportsReadBundle as unknown as { _handler: Function }
      )._handler;
      await seedBundleCandidate(ctx, { ...ids, watermark: 100 });
      const first = await activate(ctx, { storeId: ids.storeId });
      for (const activation of await ctx.db
        .query("reportingProjectionActivation")
        .take(4)) {
        await ctx.db.patch("reportingProjectionActivation", activation._id, {
          supersededAt: 150,
        });
        await ctx.db.patch(
          "reportingProjectionGeneration",
          activation.generationId,
          { status: "superseded", supersededAt: 150 },
        );
      }
      await seedBundleCandidate(ctx, {
        ...ids,
        activatedAt: 200,
        watermark: 100,
      });
      const second = await activate(ctx, { storeId: ids.storeId });
      await insertLateJournalEvidence(ctx, ids, "ROLLBACK");

      await expect(
        rollback(ctx, {
          expectedCurrentBundleId: second.bundleId,
          storeId: ids.storeId,
          targetBundleId: first.bundleId,
        }),
      ).rejects.toThrow("rollback certificate is stale");
      const active = (await ctx.db
        .query("reportingReadBundleActivation")
        .take(4)).filter((row) => row.supersededAt === undefined);
      expect(active).toHaveLength(1);
      expect(active[0]?.bundleId).toBe(second.bundleId);
    });
  });

  it("rolls back superseded members idempotently and rejects a stale current-bundle CAS", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ids = await seedStore(ctx);
      const activate = (
        tryActivateVerifiedReportsReadBundleForStore as unknown as {
          _handler: Function;
        }
      )._handler;
      const rollback = (
        rollbackReportsReadBundle as unknown as { _handler: Function }
      )._handler;

      await seedBundleCandidate(ctx, { ...ids, watermark: 100 });
      const first = await activate(ctx, { storeId: ids.storeId });
      for (const activation of await ctx.db
        .query("reportingProjectionActivation")
        .take(4)) {
        await ctx.db.patch("reportingProjectionActivation", activation._id, {
          supersededAt: 150,
        });
        await ctx.db.patch("reportingProjectionGeneration", activation.generationId, {
          status: "superseded",
          supersededAt: 150,
        });
      }
      await seedBundleCandidate(ctx, {
        ...ids,
        activatedAt: 200,
        watermark: 100,
      });
      const second = await activate(ctx, { storeId: ids.storeId });

      await expect(
        rollback(ctx, {
          expectedCurrentBundleId: first.bundleId,
          storeId: ids.storeId,
          targetBundleId: first.bundleId,
        }),
      ).rejects.toThrow("rollback target is incompatible");

      const result = await rollback(ctx, {
        expectedCurrentBundleId: second.bundleId,
        storeId: ids.storeId,
        targetBundleId: first.bundleId,
      });
      const retry = await rollback(ctx, {
        expectedCurrentBundleId: first.bundleId,
        storeId: ids.storeId,
        targetBundleId: first.bundleId,
      });
      const active = (await ctx.db
        .query("reportingReadBundleActivation")
        .take(4)).filter((row) => row.supersededAt === undefined);

      expect(result).toEqual({ bundleId: first.bundleId, status: "active" });
      expect(retry).toEqual(result);
      expect(active).toHaveLength(1);
      expect(active[0]?.bundleId).toBe(first.bundleId);
    });
    vi.restoreAllMocks();
  });

  it("rejects rollback to a bundle certified before a post-activation SKU conflict", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ids = await seedStore(ctx);
      const activate = (
        tryActivateVerifiedReportsReadBundleForStore as unknown as {
          _handler: Function;
        }
      )._handler;
      const rollback = (
        rollbackReportsReadBundle as unknown as { _handler: Function }
      )._handler;
      const cursorId = await ctx.db.insert("reportingSkuAttributionCursor", {
        latestAppliedSequence: 1,
        latestMaterialSequence: 1,
        nextSequence: 2,
        storeId: ids.storeId,
        updatedAt: 1,
      });
      await seedBundleCandidate(ctx, {
        ...ids,
        skuAttributionTerminalSequence: 1,
        watermark: 100,
      });
      const beforeConflict = await activate(ctx, { storeId: ids.storeId });
      for (const activation of await ctx.db
        .query("reportingProjectionActivation")
        .take(4)) {
        await ctx.db.patch("reportingProjectionActivation", activation._id, {
          supersededAt: 150,
        });
        await ctx.db.patch(
          "reportingProjectionGeneration",
          activation.generationId,
          { status: "superseded", supersededAt: 150 },
        );
      }
      await ctx.db.patch("reportingSkuAttributionCursor", cursorId, {
        latestAppliedSequence: 2,
        latestMaterialSequence: 2,
        nextSequence: 3,
        updatedAt: 200,
      });
      await seedBundleCandidate(ctx, {
        ...ids,
        activatedAt: 200,
        skuAttributionTerminalSequence: 2,
        watermark: 100,
      });
      const afterConflict = await activate(ctx, { storeId: ids.storeId });

      await expect(
        rollback(ctx, {
          expectedCurrentBundleId: afterConflict.bundleId,
          storeId: ids.storeId,
          targetBundleId: beforeConflict.bundleId,
        }),
      ).rejects.toThrow("rollback target is incompatible");
      const cursor = await ctx.db.get(
        "reportingSkuAttributionCursor",
        cursorId,
      );
      expect(cursor).toMatchObject({ latestActivatedSequence: 2 });
    });
  });
});
