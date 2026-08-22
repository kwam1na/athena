import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

import type { Doc, Id } from "../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  autoResolveSyncedSaleInventoryReviewsForStockAdjustmentWithCtx,
  resolveSyncedSaleInventoryReview,
  resolveSyncedSaleInventoryReviewGroup,
  resolveSyncedSaleInventoryReviewGroupWithCtx,
  resolveSyncedSaleInventoryReviewWithCtx,
} from "./openWorkInventoryReviews";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
  vi.stubEnv("STAGE", "qa");
  vi.spyOn(Date, "now").mockReturnValue(1_772_550_000_000);
  vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockResolvedValue(
    {
      _id: "user-1",
      email: "manager@example.com",
    } as never,
  );
  vi.mocked(athenaUserAuth.requireOrganizationMemberRoleWithCtx).mockResolvedValue(
    {
      _id: "membership-1",
      organizationId: "org-1",
      role: "full_admin",
      userId: "user-1",
    } as never,
  );
  vi.mocked(getAuthUserId).mockResolvedValue(null);
});

describe("resolveSyncedSaleInventoryReviewWithCtx", () => {
  it("resolves an exact current logical group through one command", async () => {
    const ctx = buildCtx();

    const result = await resolveSyncedSaleInventoryReviewGroupWithCtx(
      ctx as never,
      {
        expectedDemoRestoreEpoch: 42,
        expectedMemberIds: ["work-item-1" as Id<"operationalWorkItem">],
        groupKey: "synced_sale_inventory_review:store-1:sku-1",
        outcome: "completed",
        reason: "Inventory review handled from Open Work.",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: { resolvedCount: 1, status: "completed" },
    });
    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).toHaveBeenCalledWith(ctx);
    assertConformsToExportedReturns(
      resolveSyncedSaleInventoryReviewGroup,
      result,
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-1",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("writes nothing when current membership differs from the reviewed group", async () => {
    const ctx = buildCtx();

    const result = await resolveSyncedSaleInventoryReviewGroupWithCtx(
      ctx as never,
      {
        expectedMemberIds: ["stale-work-item" as Id<"operationalWorkItem">],
        groupKey: "synced_sale_inventory_review:store-1:sku-1",
        outcome: "completed",
        reason: "Inventory review handled from Open Work.",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "conflict",
        message:
          "This work changed. Review the refreshed group before marking it reviewed.",
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("preserves actionable member validation errors before grouped writes", async () => {
    const ctx = buildCtx({
      posTerminal: buildTerminal({ storeId: "store-2" as Id<"store"> }),
    });

    const result = await resolveSyncedSaleInventoryReviewGroupWithCtx(
      ctx as never,
      {
        expectedMemberIds: ["work-item-1" as Id<"operationalWorkItem">],
        groupKey: "synced_sale_inventory_review:store-1:sku-1",
        outcome: "completed",
        reason: "Inventory review handled from Open Work.",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Terminal does not match the inventory review store.",
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("preserves the stock-count requirement before grouped writes", async () => {
    const ctx = buildCtx({
      inventoryMovement: null,
      productSku: buildProductSku({
        inventoryCount: 0,
        quantityAvailable: 0,
      }),
    });

    const result = await resolveSyncedSaleInventoryReviewGroupWithCtx(
      ctx as never,
      {
        expectedMemberIds: ["work-item-1" as Id<"operationalWorkItem">],
        groupKey: "synced_sale_inventory_review:store-1:sku-1",
        outcome: "completed",
        reason: "Inventory review handled from Open Work.",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "Update the affected SKU's stock count before marking this inventory review complete.",
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("rejects direct group resolution while an oversized repair is active", async () => {
    const ctx = buildCtx({
      oversizedOperationalWorkRepair: {
        _creationTime: 1,
        _id: "repair-1" as Id<"oversizedOperationalWorkRepair">,
        createdAt: 1,
        cursor: 0,
        groupKey: "synced_sale_inventory_review:store-1:sku-1",
        initiatorIdentifier: "support@example.com",
        memberIds: ["work-item-1" as Id<"operationalWorkItem">],
        organizationId: "org-1" as Id<"organization">,
        productSkuId: "sku-1" as Id<"productSku">,
        reason: "Support repair",
        sourceIdentities: [
          "synced_sale_inventory_review:store-1:terminal-1:local-register-1:local-txn-1",
        ],
        status: "running",
        storeId: "store-1" as Id<"store">,
        supportTicket: "SUP-123",
        updatedAt: 1,
      },
    });

    const result = await resolveSyncedSaleInventoryReviewGroupWithCtx(
      ctx as never,
      {
        expectedMemberIds: ["work-item-1" as Id<"operationalWorkItem">],
        groupKey: "synced_sale_inventory_review:store-1:sku-1",
        outcome: "completed",
        reason: "Inventory review handled from Open Work.",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({ kind: "user_error", error: { code: "conflict" } });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("authenticates before probing current group membership", async () => {
    const ctx = buildCtx();
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockRejectedValueOnce(new Error("Authentication required."));

    await expect(
      resolveSyncedSaleInventoryReviewGroupWithCtx(ctx as never, {
        expectedMemberIds: ["work-item-1" as Id<"operationalWorkItem">],
        groupKey: "synced_sale_inventory_review:store-1:sku-1",
        outcome: "completed",
        reason: "Inventory review handled from Open Work.",
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Authentication required.");

    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("admits the exported group mutation for a ready shared-demo actor without normal-auth fallback", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-demo" as never);
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockRejectedValue(new Error("normal auth should not run"));
    const ctx = buildCtx({
      athenaUser: {
        _creationTime: 1,
        _id: "demo-athena-user" as Id<"athenaUser">,
        email: "demo@example.com",
      } as Doc<"athenaUser">,
      sharedDemoPrincipal: {
        _creationTime: 1,
        _id: "principal-1" as Id<"sharedDemoPrincipal">,
        admissionExpiresAt: Date.now() + 60_000,
        athenaUserId: "demo-athena-user" as Id<"athenaUser">,
        authUserId: "auth-demo",
        organizationId: "org-1" as Id<"organization">,
        storeId: "store-1" as Id<"store">,
      } as Doc<"sharedDemoPrincipal">,
      sharedDemoRestoreState: {
        _creationTime: 1,
        _id: "restore-1" as Id<"sharedDemoRestoreState">,
        baselineVersion: 17,
        epoch: 42,
        status: "ready",
        storeId: "store-1" as Id<"store">,
      } as Doc<"sharedDemoRestoreState">,
    });

    const handler = (
      resolveSyncedSaleInventoryReviewGroup as unknown as {
        _handler: (
          ctx: unknown,
          args: unknown,
        ) => Promise<unknown>;
      }
    )._handler;
    const result = await handler(ctx, {
      expectedDemoRestoreEpoch: 42,
      expectedMemberIds: ["work-item-1" as Id<"operationalWorkItem">],
      groupKey: "synced_sale_inventory_review:store-1:sku-1",
      outcome: "completed",
      reason: "Inventory review handled from Open Work.",
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: { resolvedCount: 1, status: "completed" },
    });
    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-1",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("returns a command error instead of throwing when shared-demo admission denies the exported group mutation", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-demo" as never);
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockRejectedValue(new Error("normal auth should not run"));
    const ctx = buildCtx({
      athenaUser: {
        _creationTime: 1,
        _id: "demo-athena-user" as Id<"athenaUser">,
        email: "demo@example.com",
      } as Doc<"athenaUser">,
      sharedDemoPrincipal: {
        _creationTime: 1,
        _id: "principal-1" as Id<"sharedDemoPrincipal">,
        admissionExpiresAt: Date.now() + 60_000,
        athenaUserId: "demo-athena-user" as Id<"athenaUser">,
        authUserId: "auth-demo",
        organizationId: "org-1" as Id<"organization">,
        storeId: "foreign-store" as Id<"store">,
      } as Doc<"sharedDemoPrincipal">,
      sharedDemoRestoreState: {
        _creationTime: 1,
        _id: "restore-1" as Id<"sharedDemoRestoreState">,
        baselineVersion: 17,
        epoch: 42,
        status: "ready",
        storeId: "foreign-store" as Id<"store">,
      } as Doc<"sharedDemoRestoreState">,
    });

    const handler = (
      resolveSyncedSaleInventoryReviewGroup as unknown as {
        _handler: (
          ctx: unknown,
          args: unknown,
        ) => Promise<unknown>;
      }
    )._handler;
    await expect(
      handler(ctx, {
        expectedDemoRestoreEpoch: 42,
        expectedMemberIds: ["work-item-1" as Id<"operationalWorkItem">],
        groupKey: "synced_sale_inventory_review:store-1:sku-1",
        outcome: "completed",
        reason: "Inventory review handled from Open Work.",
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "This action isn't allowed in the demo.",
        retryable: false,
        title: "Action unavailable",
      },
    });
    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("auto-resolves matching synced sale inventory review work from applied stock movements", async () => {
    const ctx = buildCtx();

    const result =
      await autoResolveSyncedSaleInventoryReviewsForStockAdjustmentWithCtx(
        ctx as never,
        {
          actorUserId: "user-1" as Id<"athenaUser">,
          inventoryMovements: [buildInventoryMovement()],
          organizationId: "org-1" as Id<"organization">,
          stockAdjustmentBatchId: "batch-1" as Id<"stockAdjustmentBatch">,
          storeId: "store-1" as Id<"store">,
        },
      );

    expect(result).toEqual({ resolvedCount: 1 });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-1",
      expect.objectContaining({
        completedAt: 1_772_550_000_000,
        metadata: expect.objectContaining({
          resolution: expect.objectContaining({
            actorUserId: "user-1",
            authority: {
              kind: "system",
              reason: "stock_adjustment_applied",
            },
            domainTrace: {
              boundary:
                "operations.openWorkInventoryReviews.autoResolveSyncedSaleInventoryReviewsForStockAdjustment",
              inventoryMovementId: "movement-1",
              proofKind: "stock_update_movement",
              stockAdjustmentBatchId: "batch-1",
            },
            outcome: "completed",
            reason: "Resolved by applied stock adjustment.",
            stockUpdate: expect.objectContaining({
              inventoryMovementId: "movement-1",
              productSkuId: "sku-1",
            }),
          }),
        }),
        status: "completed",
      }),
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "operationalEvent",
      expect.objectContaining({
        eventType: "synced_sale_inventory_review_completed",
        message: "Synced sale inventory review completed by stock adjustment.",
        subjectId: "work-item-1",
      }),
    );
  });

  it("auto-resolves in-progress synced sale inventory review work", async () => {
    const ctx = buildCtx({
      operationalWorkItem: buildWorkItem({ status: "in_progress" }),
    });

    const result =
      await autoResolveSyncedSaleInventoryReviewsForStockAdjustmentWithCtx(
        ctx as never,
        {
          inventoryMovements: [buildInventoryMovement()],
          stockAdjustmentBatchId: "batch-1" as Id<"stockAdjustmentBatch">,
          storeId: "store-1" as Id<"store">,
        },
      );

    expect(result).toEqual({ resolvedCount: 1 });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          resolution: expect.objectContaining({
            priorState: { status: "in_progress" },
          }),
        }),
        status: "completed",
      }),
    );
  });

  it("auto-resolves legacy synced sale inventory review work keyed only by metadata", async () => {
    const ctx = buildCtx({
      operationalWorkItem: buildWorkItem({ productSkuId: undefined }),
    });

    const result =
      await autoResolveSyncedSaleInventoryReviewsForStockAdjustmentWithCtx(
        ctx as never,
        {
          inventoryMovements: [buildInventoryMovement()],
          stockAdjustmentBatchId: "batch-1" as Id<"stockAdjustmentBatch">,
          storeId: "store-1" as Id<"store">,
        },
      );

    expect(result).toEqual({ resolvedCount: 1 });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-1",
      expect.objectContaining({
        status: "completed",
      }),
    );
  });

  it.each([
    ["older than the work item", buildInventoryMovement({ createdAt: 0 })],
    [
      "not from a stock adjustment batch",
      buildInventoryMovement({ sourceType: "manual_review" }),
    ],
    ["not an adjustment movement", buildInventoryMovement({ movementType: "sale" })],
    ["missing a product SKU", buildInventoryMovement({ productSkuId: undefined })],
  ] as Array<[string, Doc<"inventoryMovement">]>)(
    "does not auto-resolve when the stock movement is %s",
    async (_caseName, movement) => {
      const ctx = buildCtx();

      const result =
        await autoResolveSyncedSaleInventoryReviewsForStockAdjustmentWithCtx(
          ctx as never,
          {
            inventoryMovements: [movement],
            stockAdjustmentBatchId: "batch-1" as Id<"stockAdjustmentBatch">,
            storeId: "store-1" as Id<"store">,
          },
        );

      expect(result).toEqual({ resolvedCount: 0 });
      expect(ctx.db.patch).not.toHaveBeenCalled();
      expect(ctx.db.insert).not.toHaveBeenCalled();
    },
  );

  it("skips auto-resolution probing when too many SKUs are adjusted at once", async () => {
    const ctx = buildCtx();
    const inventoryMovements = Array.from({ length: 101 }, (_, index) =>
      buildInventoryMovement({
        _id: `movement-${index}` as Id<"inventoryMovement">,
        productSkuId: `sku-${index}` as Id<"productSku">,
      }),
    );

    const result =
      await autoResolveSyncedSaleInventoryReviewsForStockAdjustmentWithCtx(
        ctx as never,
        {
          inventoryMovements,
          stockAdjustmentBatchId: "batch-1" as Id<"stockAdjustmentBatch">,
          storeId: "store-1" as Id<"store">,
        },
      );

    expect(result).toEqual({ resolvedCount: 0 });
    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("resolves current synced sale inventory review work after the affected SKU has a stock update", async () => {
    const ctx = buildCtx();

    const result = await resolveSyncedSaleInventoryReviewWithCtx(
      ctx as never,
      defaultArgs(),
    );

    expect(result).toEqual({
      kind: "ok",
      data: {
        action: "resolved",
        outcome: "completed",
        status: "completed",
        workItemId: "work-item-1",
      },
    });
    assertConformsToExportedReturns(resolveSyncedSaleInventoryReview, result);
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "Only store admins can resolve inventory review work.",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-1",
      {
        completedAt: 1_772_550_000_000,
        metadata: expect.objectContaining({
          resolution: expect.objectContaining({
            actorStaffProfileId: "staff-manager-1",
            actorUserId: "user-1",
            authority: {
              kind: "organization_member_role",
              role: "full_admin",
            },
            domainTrace: {
              boundary:
                "operations.openWorkInventoryReviews.resolveSyncedSaleInventoryReview",
              inventoryMovementId: "movement-1",
              proofKind: "stock_update_movement",
            },
            nextState: { status: "completed" },
            outcome: "completed",
            priorState: { status: "open" },
            reason: "Inventory was corrected from the sale review.",
            source: expect.objectContaining({
              localIdKind: "inventoryReviewWorkItem",
              localRegisterSessionId: "local-register-1",
              localTransactionId: "local-txn-1",
              receiptNumber: "LR-001",
              registerSessionId: "register-session-1",
              sourceId: "transaction-1",
              terminalId: "terminal-1",
            }),
            terminalAudit: {
              displayName: "Front register",
              registerNumber: "1",
              terminalId: "terminal-1",
            },
            stockState: null,
            stockUpdate: {
              createdAt: 1_772_549_999_000,
              inventoryMovementId: "movement-1",
              movementType: "cycle_count",
              productSkuId: "sku-1",
              quantityDelta: 4,
              reasonCode: "cycle_count_reconciliation",
              sourceId: "stock_adjustment_batch:batch-1",
              sourceType: "stock_adjustment_batch",
            },
          }),
        }),
        status: "completed",
      },
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "operationalEvent",
      expect.objectContaining({
        actorStaffProfileId: "staff-manager-1",
        actorUserId: "user-1",
        eventType: "synced_sale_inventory_review_completed",
        reason: "Inventory was corrected from the sale review.",
        subjectId: "work-item-1",
        subjectType: "synced_sale_inventory_review",
        workItemId: "work-item-1",
        metadata: expect.objectContaining({
          inventoryMovementId: "movement-1",
          nextState: { status: "completed" },
          outcome: "completed",
          priorState: { status: "open" },
        }),
      }),
    );
  });

  it("cancels dismissed or superseded reviews while preserving audited outcome", async () => {
    const ctx = buildCtx();

    const result = await resolveSyncedSaleInventoryReviewWithCtx(
      ctx as never,
      defaultArgs({
        outcome: "superseded",
        reason: "A newer inventory review replaced this sale evidence.",
      }),
    );

    expect(result).toEqual({
      kind: "ok",
      data: {
        action: "resolved",
        outcome: "superseded",
        status: "cancelled",
        workItemId: "work-item-1",
      },
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          resolution: expect.objectContaining({
            nextState: { status: "cancelled" },
            outcome: "superseded",
          }),
        }),
        status: "cancelled",
      }),
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "operationalEvent",
      expect.objectContaining({
        eventType: "synced_sale_inventory_review_cancelled",
        metadata: expect.objectContaining({
          nextState: { status: "cancelled" },
          outcome: "superseded",
        }),
      }),
    );
  });

  it("rejects client-supplied staff attribution that does not match the authenticated user", async () => {
    const ctx = buildCtx();

    const result = await resolveSyncedSaleInventoryReviewWithCtx(
      ctx as never,
      defaultArgs({
        actorStaffProfileId: "staff-other" as Id<"staffProfile">,
      }),
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Staff attribution does not match the authenticated user.",
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("rejects already-terminal work item attempts", async () => {
    const ctx = buildCtx({
      operationalWorkItem: buildWorkItem({ status: "completed" }),
    });

    const result = await resolveSyncedSaleInventoryReviewWithCtx(
      ctx as never,
      defaultArgs(),
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "conflict",
        message: "Inventory review work is already terminal.",
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("rejects wrong terminal, session, sale, and store context when that context is supplied", async () => {
    await expectRejectedContext(
      { terminalId: "terminal-other" as Id<"posTerminal"> },
      "Terminal does not match the inventory review store.",
      {
        posTerminal: buildTerminal({
          _id: "terminal-other" as Id<"posTerminal">,
          storeId: "store-2" as Id<"store">,
        }),
      },
    );
    await expectRejectedContext(
      { registerSessionId: "register-session-other" as Id<"registerSession"> },
      "Register session does not match the inventory review terminal.",
      {
        registerSession: buildRegisterSession({
          _id: "register-session-other" as Id<"registerSession">,
          terminalId: "terminal-other" as Id<"posTerminal">,
        }),
      },
    );
    await expectRejectedContext(
      { sourceId: "transaction-other" as Id<"posTransaction"> },
      "Sale does not match the inventory review context.",
      {
        posTransaction: buildTransaction({
          _id: "transaction-other" as Id<"posTransaction">,
          registerSessionId: "register-session-other" as Id<"registerSession">,
        }),
      },
    );
    await expectRejectedContext(
      { storeId: "store-other" as Id<"store"> },
      "Inventory review work item not found for this store.",
      { store: buildStore({ _id: "store-other" as Id<"store"> }) },
    );
  });

  it("allows work-item-only resolution when stock was updated for the affected SKU", async () => {
    const cloudIdOnly = await resolveSyncedSaleInventoryReviewWithCtx(
      buildCtx() as never,
      {
        outcome: "completed",
        reason: "Resolved",
        storeId: "store-1" as Id<"store">,
        workItemId: "work-item-1" as Id<"operationalWorkItem">,
      },
    );
    expect(cloudIdOnly).toMatchObject({
      kind: "ok",
      data: {
        action: "resolved",
        outcome: "completed",
        status: "completed",
        workItemId: "work-item-1",
      },
    });
    assertConformsToExportedReturns(
      resolveSyncedSaleInventoryReview,
      cloudIdOnly,
    );
  });

  it("allows completion without a stock movement when current affected SKU stock is positive", async () => {
    const ctx = buildCtx({
      inventoryMovement: null,
      productSku: buildProductSku({
        inventoryCount: 2,
        quantityAvailable: 2,
      }),
    });

    const result = await resolveSyncedSaleInventoryReviewWithCtx(
      ctx as never,
      defaultArgs({
        localRegisterSessionId: undefined,
        localTransactionId: undefined,
        registerSessionId: undefined,
        sourceId: undefined,
        terminalId: undefined,
      }),
    );

    expect(result).toMatchObject({
      data: {
        action: "resolved",
        outcome: "completed",
        status: "completed",
        workItemId: "work-item-1",
      },
      kind: "ok",
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          resolution: expect.objectContaining({
            domainTrace: expect.objectContaining({
              proofKind: "current_inventory_state",
            }),
            stockUpdate: null,
            stockState: {
              inventoryCount: 2,
              productSkuId: "sku-1",
              proofKind: "current_inventory_state",
              quantityAvailable: 2,
              reviewedAt: 1_772_550_000_000,
            },
          }),
        }),
        status: "completed",
      }),
    );
  });

  it("rejects completion before the affected SKU has a stock update", async () => {
    const result = await resolveSyncedSaleInventoryReviewWithCtx(
      buildCtx({
        inventoryMovement: null,
        productSku: buildProductSku({
          inventoryCount: 0,
          quantityAvailable: 0,
        }),
      }) as never,
      defaultArgs({
        localRegisterSessionId: undefined,
        localTransactionId: undefined,
        registerSessionId: undefined,
        sourceId: undefined,
        terminalId: undefined,
      }),
    );
    expect(result).toMatchObject({
      error: {
        message:
          "Update the affected SKU's stock count before marking this inventory review complete.",
      },
      kind: "user_error",
    });
  });

  it("rejects stock updates that predate the synced sale inventory review", async () => {
    const result = await resolveSyncedSaleInventoryReviewWithCtx(
      buildCtx({
        inventoryMovement: buildInventoryMovement({
          createdAt: 0,
        }),
      }) as never,
      defaultArgs({
        localRegisterSessionId: undefined,
        localTransactionId: undefined,
        registerSessionId: undefined,
        sourceId: undefined,
        terminalId: undefined,
      }),
    );
    expect(result).toMatchObject({
      error: {
        message:
          "Update the affected SKU's stock count before marking this inventory review complete.",
      },
      kind: "user_error",
    });
  });

  it("resolves expense inventory review work against its own expense source", async () => {
    const ctx = buildCtx(buildExpenseCtxSeed());

    const result = await resolveSyncedSaleInventoryReviewWithCtx(
      ctx as never,
      expenseArgs(),
    );

    expect(result).toEqual({
      kind: "ok",
      data: {
        action: "resolved",
        outcome: "completed",
        status: "completed",
        workItemId: "work-item-expense-1",
      },
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-expense-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          resolution: expect.objectContaining({
            source: expect.objectContaining({
              localExpenseEventId: "local-expense-event-1",
              localExpenseSessionId: "local-expense-session-1",
              localId: "local-expense-event-1:inventory-review",
              localIdKind: "inventoryReviewWorkItem",
              sourceId: "expense-transaction-1",
              sourceKind: "expense",
              terminalId: "terminal-1",
            }),
          }),
        }),
        status: "completed",
      }),
    );
    const insertedEvent = ctx.db.insert.mock.calls.find(
      (call) => call[0] === "operationalEvent",
    );
    expect(insertedEvent?.[1]).toMatchObject({
      eventType: "synced_sale_inventory_review_completed",
      message: "Synced expense inventory review completed.",
    });
    expect(JSON.stringify(insertedEvent?.[1])).not.toContain("staffProofToken");
  });

  it("fails closed on mismatched expense session, transaction, terminal, store, or local event", async () => {
    const mismatches: Array<{
      message: string;
      overrides: Record<string, unknown>;
      seed?: BuildCtxSeed;
    }> = [
      {
        message: "Expense session does not match the inventory review terminal.",
        overrides: {},
        seed: {
          expenseSession: buildExpenseSession({
            terminalId: "terminal-other" as Id<"posTerminal">,
          }),
        },
      },
      {
        message: "Expense session does not match the inventory review terminal.",
        overrides: {},
        seed: {
          expenseSession: buildExpenseSession({
            storeId: "store-2" as Id<"store">,
          }),
        },
      },
      {
        message: "Expense does not match the inventory review context.",
        overrides: {},
        seed: {
          expenseTransaction: buildExpenseTransaction({
            sessionId: "expense-session-other" as Id<"expenseSession">,
          }),
        },
      },
      {
        message: "Expense does not match the inventory review context.",
        overrides: {},
        seed: {
          expenseTransaction: buildExpenseTransaction({
            storeId: "store-2" as Id<"store">,
          }),
        },
      },
      {
        message: "Terminal does not match the inventory review store.",
        overrides: { terminalId: "terminal-other" as Id<"posTerminal"> },
        seed: {
          posTerminal: buildTerminal({
            _id: "terminal-other" as Id<"posTerminal">,
            storeId: "store-2" as Id<"store">,
          }),
        },
      },
      {
        message:
          "Work item metadata does not match the recorded expense context.",
        overrides: { localExpenseEventId: "local-expense-event-other" },
      },
      {
        message:
          "Work item metadata does not match the recorded expense context.",
        overrides: { localExpenseSessionId: "local-expense-session-other" },
      },
      {
        message: "Inventory review work item not found for this store.",
        overrides: { storeId: "store-other" as Id<"store"> },
        seed: { store: buildStore({ _id: "store-other" as Id<"store"> }) },
      },
    ];

    for (const mismatch of mismatches) {
      const ctx = buildCtx(buildExpenseCtxSeed(mismatch.seed));
      const result = await resolveSyncedSaleInventoryReviewWithCtx(
        ctx as never,
        expenseArgs(mismatch.overrides as never),
      );

      expect(result).toEqual({
        kind: "user_error",
        error: {
          code: mismatch.message.includes("not found")
            ? "not_found"
            : "validation_failed",
          message: mismatch.message,
        },
      });
      expect(ctx.db.patch).not.toHaveBeenCalled();
      expect(ctx.db.insert).not.toHaveBeenCalled();
    }
  });

  it("fails closed when sale-shaped source context is supplied for expense work", async () => {
    const ctx = buildCtx(buildExpenseCtxSeed());

    const result = await resolveSyncedSaleInventoryReviewWithCtx(
      ctx as never,
      expenseArgs({
        receiptNumber: "LR-001",
      } as never),
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "Work item metadata does not match the recorded expense context.",
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("resolves a mixed sale and expense SKU group from one qualifying correction", async () => {
    const ctx = buildCtx({
      expenseSession: buildExpenseSession(),
      expenseTransaction: buildExpenseTransaction(),
      operationalWorkItems: [buildWorkItem(), buildExpenseWorkItem()],
    });

    const result = await resolveSyncedSaleInventoryReviewGroupWithCtx(
      ctx as never,
      {
        expectedMemberIds: [
          "work-item-1" as Id<"operationalWorkItem">,
          "work-item-expense-1" as Id<"operationalWorkItem">,
        ],
        groupKey: "synced_sale_inventory_review:store-1:sku-1",
        outcome: "completed",
        reason: "Stock count corrected for the affected SKU.",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: { resolvedCount: 2, status: "completed" },
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-1",
      expect.objectContaining({ status: "completed" }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-expense-1",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("validates every mixed-group member source before the first write", async () => {
    const ctx = buildCtx({
      expenseSession: buildExpenseSession({
        terminalId: "terminal-other" as Id<"posTerminal">,
      }),
      expenseTransaction: buildExpenseTransaction(),
      operationalWorkItems: [buildWorkItem(), buildExpenseWorkItem()],
    });

    const result = await resolveSyncedSaleInventoryReviewGroupWithCtx(
      ctx as never,
      {
        expectedMemberIds: [
          "work-item-1" as Id<"operationalWorkItem">,
          "work-item-expense-1" as Id<"operationalWorkItem">,
        ],
        groupKey: "synced_sale_inventory_review:store-1:sku-1",
        outcome: "completed",
        reason: "Stock count corrected for the affected SKU.",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Expense session does not match the inventory review terminal.",
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("auto-resolves expense inventory review work from an applied stock adjustment", async () => {
    const ctx = buildCtx(buildExpenseCtxSeed());

    const result =
      await autoResolveSyncedSaleInventoryReviewsForStockAdjustmentWithCtx(
        ctx as never,
        {
          actorUserId: "user-1" as Id<"athenaUser">,
          inventoryMovements: [buildInventoryMovement({ createdAt: 2 })],
          stockAdjustmentBatchId: "batch-1" as Id<"stockAdjustmentBatch">,
          storeId: "store-1" as Id<"store">,
        },
      );

    expect(result).toEqual({ resolvedCount: 1 });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-item-expense-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          resolution: expect.objectContaining({
            source: expect.objectContaining({
              localExpenseEventId: "local-expense-event-1",
              localId: "local-expense-event-1:inventory-review",
              sourceKind: "expense",
            }),
          }),
        }),
        status: "completed",
      }),
    );
    const insertedEvent = ctx.db.insert.mock.calls.find(
      (call) => call[0] === "operationalEvent",
    );
    expect(insertedEvent?.[1]).toMatchObject({
      message: "Synced expense inventory review completed by stock adjustment.",
    });
  });

  it("does not require the canonical local mapping when stock update proof exists", async () => {
    const ctx = buildCtx({
      posLocalSyncMapping: buildMapping({
        cloudId: "transaction-1",
        cloudTable: "posTransaction",
        localId: "local-txn-1",
        localIdKind: "transaction",
      }),
    });

    const result = await resolveSyncedSaleInventoryReviewWithCtx(
      ctx as never,
      defaultArgs(),
    );

    expect(result).toMatchObject({
      data: {
        action: "resolved",
        outcome: "completed",
        status: "completed",
        workItemId: "work-item-1",
      },
      kind: "ok",
    });
    expect(ctx.db.patch).toHaveBeenCalled();
  });
});

async function expectRejectedContext(
  args: Partial<ReturnType<typeof defaultArgs>>,
  message: string,
  seed: BuildCtxSeed,
) {
  const ctx = buildCtx(seed);
  const result = await resolveSyncedSaleInventoryReviewWithCtx(
    ctx as never,
    defaultArgs(args),
  );

  expect(result).toMatchObject({
    error: { message },
    kind: "user_error",
  });
  expect(ctx.db.patch).not.toHaveBeenCalled();
}

function defaultArgs(
  overrides: Partial<{
    actorStaffProfileId?: Id<"staffProfile">;
    localRegisterSessionId?: string;
    localTransactionId?: string;
    outcome: "completed" | "dismissed" | "cancelled" | "superseded";
    reason: string;
    receiptNumber?: string;
    registerSessionId?: Id<"registerSession">;
    sourceId?: Id<"posTransaction">;
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
    workItemId: Id<"operationalWorkItem">;
  }> = {},
) {
  return {
    actorStaffProfileId: "staff-manager-1" as Id<"staffProfile">,
    localRegisterSessionId: "local-register-1",
    localTransactionId: "local-txn-1",
    outcome: "completed" as const,
    reason: "Inventory was corrected from the sale review.",
    receiptNumber: "LR-001",
    registerSessionId: "register-session-1" as Id<"registerSession">,
    sourceId: "transaction-1" as Id<"posTransaction">,
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    workItemId: "work-item-1" as Id<"operationalWorkItem">,
    ...overrides,
  };
}

type BuildCtxSeed = Partial<{
  athenaUser: Doc<"athenaUser">;
  expenseSession: Doc<"expenseSession"> | null;
  expenseTransaction: Doc<"expenseTransaction"> | null;
  inventoryMovement: Doc<"inventoryMovement"> | null;
  operationalWorkItem: Doc<"operationalWorkItem">;
  operationalWorkItems: Doc<"operationalWorkItem">[];
  oversizedOperationalWorkRepair: Doc<"oversizedOperationalWorkRepair">;
  posLocalSyncMapping: Doc<"posLocalSyncMapping">;
  productSku: Doc<"productSku"> | null;
  posTerminal: Doc<"posTerminal">;
  posTransaction: Doc<"posTransaction"> | null;
  registerSession: Doc<"registerSession"> | null;
  staffProfile: Doc<"staffProfile">;
  store: Doc<"store">;
  sharedDemoPrincipal: Doc<"sharedDemoPrincipal">;
  sharedDemoRestoreState: Doc<"sharedDemoRestoreState">;
}>;

function seededRows<TRow>(value: TRow | TRow[] | null | undefined): TRow[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function buildCtx(seed: BuildCtxSeed = {}) {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    athenaUser: seededRows(seed.athenaUser),
    expenseSession: seededRows(seed.expenseSession),
    expenseTransaction: seededRows(seed.expenseTransaction),
    inventoryMovement: seededRows(
      seed.inventoryMovement === undefined
        ? buildInventoryMovement()
        : seed.inventoryMovement,
    ),
    operationalWorkItem: seededRows(
      seed.operationalWorkItems ?? seed.operationalWorkItem ?? buildWorkItem(),
    ),
    oversizedOperationalWorkRepair: seededRows(
      seed.oversizedOperationalWorkRepair,
    ),
    posLocalSyncMapping: seededRows(seed.posLocalSyncMapping ?? buildMapping()),
    productSku: seededRows(
      seed.productSku === undefined ? buildProductSku() : seed.productSku,
    ),
    posTerminal: seededRows(seed.posTerminal ?? buildTerminal()),
    posTransaction: seededRows(
      seed.posTransaction === undefined ? buildTransaction() : seed.posTransaction,
    ),
    registerSession: seededRows(
      seed.registerSession === undefined
        ? buildRegisterSession()
        : seed.registerSession,
    ),
    staffProfile: seededRows(seed.staffProfile ?? buildStaffProfile()),
    store: seededRows(seed.store ?? buildStore()),
    sharedDemoPrincipal: seededRows(seed.sharedDemoPrincipal),
    sharedDemoRestoreState: seededRows(seed.sharedDemoRestoreState),
  };
  const get = vi.fn(async (tableName: string, id: string) => {
    return (rows[tableName] ?? []).find((row) => row._id === id) ?? null;
  });
  const query = vi.fn((tableName: string) => ({
    withIndex: vi.fn(
      (_indexName: string, builder: (q: QueryBuilder) => QueryBuilder) => {
        const constraints: Record<string, unknown> = {};
        const q = {
          eq(field: string, value: unknown) {
            constraints[field] = value;
            return q;
          },
        };
        builder(q);
        const matchingRows = () =>
          (rows[tableName] ?? []).filter((row) =>
            Object.entries(constraints).every(
              ([field, value]) => row[field] === value,
            ),
          );
        return {
          order: vi.fn(() => ({
            first: vi.fn(async () => matchingRows()[0] ?? null),
          })),
          collect: vi.fn(async () => matchingRows()),
          first: vi.fn(async () => matchingRows()[0] ?? null),
          take: vi.fn(async () => matchingRows()),
          unique: vi.fn(async () => matchingRows()[0] ?? null),
        };
      },
    ),
  }));

  return {
    auth: {
      getUserIdentity: vi.fn(async () => ({ subject: "auth-demo" })),
    },
    db: {
      get,
      insert: vi.fn(
        async (tableName: string, _document?: Record<string, unknown>) =>
          `${tableName}-1`,
      ),
      patch: vi.fn(),
      query,
    },
  };
}

type QueryBuilder = {
  eq(field: string, value: unknown): QueryBuilder;
};

function buildStore(
  overrides: Partial<Doc<"store">> = {},
): Doc<"store"> {
  return {
    _creationTime: 1,
    _id: "store-1" as Id<"store">,
    name: "Wig Club",
    organizationId: "org-1" as Id<"organization">,
    slug: "wigclub",
    ...overrides,
  } as Doc<"store">;
}

function buildStaffProfile(
  overrides: Partial<Doc<"staffProfile">> = {},
): Doc<"staffProfile"> {
  return {
    _creationTime: 1,
    _id: "staff-manager-1" as Id<"staffProfile">,
    linkedUserId: "user-1" as Id<"athenaUser">,
    name: "Manager",
    status: "active",
    storeId: "store-1" as Id<"store">,
    ...overrides,
  } as Doc<"staffProfile">;
}

function buildWorkItem(
  overrides: Partial<Doc<"operationalWorkItem">> = {},
): Doc<"operationalWorkItem"> {
  return {
    _creationTime: 1,
    _id: "work-item-1" as Id<"operationalWorkItem">,
    approvalState: "not_required",
    createdAt: 1,
    metadata: {
      localEventId: "event-sale-completed-1",
      localRegisterSessionId: "local-register-1",
      localTransactionId: "local-txn-1",
      primaryProductSkuId: "sku-1",
      receiptNumber: "LR-001",
      registerSessionId: "register-session-1",
      sourceId: "transaction-1",
      sourceType: "posTransaction",
      terminalId: "terminal-1",
    },
    organizationId: "org-1" as Id<"organization">,
    priority: "high",
    productSkuId: "sku-1" as Id<"productSku">,
    status: "open",
    storeId: "store-1" as Id<"store">,
    title: "Review inventory for Wig Cap",
    type: "synced_sale_inventory_review",
    ...overrides,
  } as Doc<"operationalWorkItem">;
}

function buildExpenseWorkItem(
  overrides: Partial<Doc<"operationalWorkItem">> = {},
): Doc<"operationalWorkItem"> {
  return buildWorkItem({
    _id: "work-item-expense-1" as Id<"operationalWorkItem">,
    metadata: {
      expenseSessionId: "expense-session-1",
      localEventId: "event-expense-recorded-1",
      localExpenseEventId: "local-expense-event-1",
      localExpenseSessionId: "local-expense-session-1",
      primaryProductSkuId: "sku-1",
      sourceId: "expense-transaction-1",
      sourceKind: "expense",
      sourceType: "expenseTransaction",
      terminalId: "terminal-1",
    },
    title: "Review inventory for Repair Kit",
    ...overrides,
  });
}

function buildExpenseSession(
  overrides: Partial<Doc<"expenseSession">> = {},
): Doc<"expenseSession"> {
  return {
    _creationTime: 1,
    _id: "expense-session-1" as Id<"expenseSession">,
    completedAt: 20,
    createdAt: 20,
    expiresAt: Number.MAX_SAFE_INTEGER,
    sessionNumber: "local-expense-session-1",
    staffProfileId: "staff-manager-1" as Id<"staffProfile">,
    status: "completed",
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    updatedAt: 20,
    ...overrides,
  } as Doc<"expenseSession">;
}

function buildExpenseTransaction(
  overrides: Partial<Doc<"expenseTransaction">> = {},
): Doc<"expenseTransaction"> {
  return {
    _creationTime: 1,
    _id: "expense-transaction-1" as Id<"expenseTransaction">,
    completedAt: 20,
    sessionId: "expense-session-1" as Id<"expenseSession">,
    staffProfileId: "staff-manager-1" as Id<"staffProfile">,
    status: "completed",
    storeId: "store-1" as Id<"store">,
    totalValue: 25,
    transactionNumber: "000123",
    ...overrides,
  } as Doc<"expenseTransaction">;
}

function buildExpenseCtxSeed(seed: BuildCtxSeed = {}): BuildCtxSeed {
  return {
    expenseSession: buildExpenseSession(),
    expenseTransaction: buildExpenseTransaction(),
    operationalWorkItem: buildExpenseWorkItem(),
    posTransaction: null,
    registerSession: null,
    ...seed,
  };
}

function expenseArgs(
  overrides: Partial<Parameters<typeof resolveSyncedSaleInventoryReviewWithCtx>[1]> = {},
) {
  return {
    expenseSessionId: "expense-session-1" as Id<"expenseSession">,
    expenseTransactionId: "expense-transaction-1" as Id<"expenseTransaction">,
    localExpenseEventId: "local-expense-event-1",
    localExpenseSessionId: "local-expense-session-1",
    outcome: "completed" as const,
    reason: "Stock count corrected for the recorded expense.",
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    workItemId: "work-item-expense-1" as Id<"operationalWorkItem">,
    ...overrides,
  };
}

function buildInventoryMovement(
  overrides: Partial<Doc<"inventoryMovement">> = {},
): Doc<"inventoryMovement"> {
  return {
    _creationTime: 1,
    _id: "movement-1" as Id<"inventoryMovement">,
    actorUserId: "user-1" as Id<"athenaUser">,
    createdAt: 1_772_549_999_000,
    movementType: "cycle_count",
    organizationId: "org-1" as Id<"organization">,
    productId: "product-1" as Id<"product">,
    productSkuId: "sku-1" as Id<"productSku">,
    quantityDelta: 4,
    reasonCode: "cycle_count_reconciliation",
    sourceId: "stock_adjustment_batch:batch-1",
    sourceType: "stock_adjustment_batch",
    storeId: "store-1" as Id<"store">,
    ...overrides,
  } as Doc<"inventoryMovement">;
}

function buildProductSku(
  overrides: Partial<Doc<"productSku">> = {},
): Doc<"productSku"> {
  return {
    _creationTime: 1,
    _id: "sku-1" as Id<"productSku">,
    barcode: "SKU-1",
    cost: 0,
    inventoryCount: 0,
    price: 2500,
    productId: "product-1" as Id<"product">,
    quantityAvailable: 0,
    sku: "SKU-1",
    storeId: "store-1" as Id<"store">,
    updatedAt: 1,
    ...overrides,
  } as Doc<"productSku">;
}

function buildTerminal(
  overrides: Partial<Doc<"posTerminal">> = {},
): Doc<"posTerminal"> {
  return {
    _creationTime: 1,
    _id: "terminal-1" as Id<"posTerminal">,
    browserInfo: {
      userAgent: "test",
    },
    displayName: "Front register",
    fingerprintHash: "fingerprint",
    registeredAt: 1,
    registeredByUserId: "user-1" as Id<"athenaUser">,
    registerNumber: "1",
    status: "active",
    storeId: "store-1" as Id<"store">,
    ...overrides,
  } as Doc<"posTerminal">;
}

function buildRegisterSession(
  overrides: Partial<Doc<"registerSession">> = {},
): Doc<"registerSession"> {
  return {
    _creationTime: 1,
    _id: "register-session-1" as Id<"registerSession">,
    closeoutRecords: [],
    expectedCash: 0,
    openedAt: 1,
    openedByStaffProfileId: "staff-1" as Id<"staffProfile">,
    openingFloat: 0,
    organizationId: "org-1" as Id<"organization">,
    registerNumber: "1",
    status: "closed",
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    ...overrides,
  } as Doc<"registerSession">;
}

function buildTransaction(
  overrides: Partial<Doc<"posTransaction">> = {},
): Doc<"posTransaction"> {
  return {
    _creationTime: 1,
    _id: "transaction-1" as Id<"posTransaction">,
    completedAt: 1,
    payments: [],
    receiptPrinted: false,
    registerNumber: "1",
    registerSessionId: "register-session-1" as Id<"registerSession">,
    staffProfileId: "staff-1" as Id<"staffProfile">,
    status: "completed",
    storeId: "store-1" as Id<"store">,
    subtotal: 2500,
    tax: 0,
    terminalId: "terminal-1" as Id<"posTerminal">,
    total: 2500,
    totalPaid: 2500,
    transactionNumber: "LR-001",
    ...overrides,
  } as Doc<"posTransaction">;
}

function buildMapping(
  overrides: Partial<Doc<"posLocalSyncMapping">> = {},
): Doc<"posLocalSyncMapping"> {
  return {
    _creationTime: 1,
    _id: "mapping-inventory-review" as Id<"posLocalSyncMapping">,
    cloudId: "work-item-1",
    cloudTable: "operationalWorkItem",
    createdAt: 1,
    localEventId: "event-sale-completed-1",
    localId: "local-txn-1:inventory-review",
    localIdKind: "inventoryReviewWorkItem",
    localRegisterSessionId: "local-register-1",
    sourceEventType: "sale_completed",
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    ...overrides,
  } as Doc<"posLocalSyncMapping">;
}
