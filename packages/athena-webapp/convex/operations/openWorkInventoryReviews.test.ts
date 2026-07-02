import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  resolveSyncedSaleInventoryReview,
  resolveSyncedSaleInventoryReviewWithCtx,
} from "./openWorkInventoryReviews";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
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
});

describe("resolveSyncedSaleInventoryReviewWithCtx", () => {
  it("resolves current synced sale inventory review work through the canonical local mapping", async () => {
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
              mappingId: "mapping-inventory-review",
            },
            nextState: { status: "completed" },
            outcome: "completed",
            priorState: { status: "open" },
            reason: "Inventory was corrected from the sale review.",
            source: expect.objectContaining({
              localId: "local-txn-1:inventory-review",
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
          mappingId: "mapping-inventory-review",
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

  it("rejects wrong terminal, session, sale, and store context", async () => {
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

  it("rejects cloud-id-only, receipt-only, and SKU-only idempotency attempts", async () => {
    const cloudIdOnly = await resolveSyncedSaleInventoryReviewWithCtx(
      buildCtx() as never,
      {
        outcome: "completed",
        reason: "Resolved",
        storeId: "store-1" as Id<"store">,
        workItemId: "work-item-1" as Id<"operationalWorkItem">,
      },
    );
    expect(cloudIdOnly).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "Inventory review resolution requires terminal, local register session, and local transaction context.",
      },
    });
    assertConformsToExportedReturns(
      resolveSyncedSaleInventoryReview,
      cloudIdOnly,
    );

    const receiptOnly = await resolveSyncedSaleInventoryReviewWithCtx(
      buildCtx() as never,
      defaultArgs({
        localTransactionId: undefined,
        receiptNumber: "LR-001",
      }),
    );
    expect(receiptOnly).toMatchObject({
      error: {
        message:
          "Inventory review resolution requires terminal, local register session, and local transaction context.",
      },
      kind: "user_error",
    });

    const skuOnly = await resolveSyncedSaleInventoryReviewWithCtx(
      buildCtx() as never,
      defaultArgs({
        localTransactionId: "sku-1",
      }),
    );
    expect(skuOnly).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "Work item metadata does not match the sale context.",
      },
    });
  });

  it("rejects transaction and receipt mappings that do not use the canonical inventory-review key", async () => {
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

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "Inventory review resolution requires the canonical local work-item mapping.",
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
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
  operationalWorkItem: Doc<"operationalWorkItem">;
  posLocalSyncMapping: Doc<"posLocalSyncMapping">;
  posTerminal: Doc<"posTerminal">;
  posTransaction: Doc<"posTransaction">;
  registerSession: Doc<"registerSession">;
  staffProfile: Doc<"staffProfile">;
  store: Doc<"store">;
}>;

function buildCtx(seed: BuildCtxSeed = {}) {
  const rows = {
    operationalWorkItem: seed.operationalWorkItem ?? buildWorkItem(),
    posLocalSyncMapping: seed.posLocalSyncMapping ?? buildMapping(),
    posTerminal: seed.posTerminal ?? buildTerminal(),
    posTransaction: seed.posTransaction ?? buildTransaction(),
    registerSession: seed.registerSession ?? buildRegisterSession(),
    staffProfile: seed.staffProfile ?? buildStaffProfile(),
    store: seed.store ?? buildStore(),
  };
  const get = vi.fn(async (tableName: string, id: string) => {
    const row = rows[tableName as keyof typeof rows];
    return row && row._id === id ? row : null;
  });
  const query = vi.fn((tableName: string) => ({
    withIndex: vi.fn((_indexName: string, builder: (q: QueryBuilder) => QueryBuilder) => {
      const constraints: Record<string, unknown> = {};
      const q = {
        eq(field: string, value: unknown) {
          constraints[field] = value;
          return q;
        },
      };
      builder(q);
      return {
        collect: vi.fn(async () => {
          const row = rows[tableName as keyof typeof rows];
          if (!row) return [];
          return Object.entries(constraints).every(
            ([field, value]) => row[field as keyof typeof row] === value,
          )
            ? [row]
            : [];
        }),
        first: vi.fn(async () => {
          const row = rows[tableName as keyof typeof rows];
          if (!row) return null;
          return Object.entries(constraints).every(
            ([field, value]) => row[field as keyof typeof row] === value,
          )
            ? row
            : null;
        }),
        unique: vi.fn(async () => {
          const row = rows[tableName as keyof typeof rows];
          if (!row) return null;
          return Object.entries(constraints).every(
            ([field, value]) => row[field as keyof typeof row] === value,
          )
            ? row
            : null;
        }),
      };
    }),
  }));

  return {
    db: {
      get,
      insert: vi.fn(async (tableName: string) => `${tableName}-1`),
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
    },
    organizationId: "org-1" as Id<"organization">,
    priority: "high",
    status: "open",
    storeId: "store-1" as Id<"store">,
    title: "Review inventory for Wig Cap",
    type: "synced_sale_inventory_review",
    ...overrides,
  } as Doc<"operationalWorkItem">;
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
