import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { buildApprovalRequest } from "./approvalRequestHelpers";
import {
  decideApprovalRequestAsCommandWithCtx,
  decideApprovalRequestAsAuthenticatedUserWithCtx,
  decideApprovalRequestWithCtx,
} from "./approvalRequests";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

function createApprovalRequestMutationCtx(args: {
  athenaUsers?: Array<{ _id: string; email: string }>;
  authUserId?: string | null;
  role: "full_admin" | "pos_only";
}) {
  const tables = {
    approvalRequest: new Map<string, Record<string, unknown>>([
      [
        "approval-1",
        {
          _id: "approval-1",
          organizationId: "org-1",
          requestType: "inventory_adjustment_review",
          status: "pending",
          storeId: "store-1",
          subjectId: "batch-1",
          subjectType: "stock_adjustment_batch",
          workItemId: "work-item-1",
        },
      ],
    ]),
    approvalProof: new Map<string, Record<string, unknown>>([
      [
        "proof-1",
        {
          _id: "proof-1",
          actionKey: "operations.approval_request.decide",
          approvedByCredentialId: "credential-1",
          approvedByStaffProfileId: "staff-manager-1",
          createdAt: 1,
          expiresAt: Date.now() + 60_000,
          requiredRole: "manager",
          storeId: "store-1",
          subjectId: "approval-1",
          subjectLabel: "inventory_adjustment_review",
          subjectType: "approval_request",
        },
      ],
    ]),
    athenaUser: new Map<string, Record<string, unknown>>(
      (
        args.athenaUsers ?? [
          {
            _id: "manager-1",
            email: "manager@example.com",
          },
        ]
      ).map((athenaUser) => [athenaUser._id, athenaUser]),
    ),
    inventoryMovement: new Map<string, Record<string, unknown>>(),
    operationalEvent: new Map<string, Record<string, unknown>>(),
    operationalWorkItem: new Map<string, Record<string, unknown>>([
      [
        "work-item-1",
        {
          _id: "work-item-1",
          approvalRequestId: "approval-1",
          approvalState: "pending",
          status: "open",
          storeId: "store-1",
        },
      ],
    ]),
    organizationMember: new Map<string, Record<string, unknown>>([
      [
        "member-1",
        {
          _id: "member-1",
          organizationId: "org-1",
          role: args.role,
          userId: "manager-1",
        },
      ],
    ]),
    productSku: new Map<string, Record<string, unknown>>([
      [
        "sku-1",
        {
          _id: "sku-1",
          inventoryCount: 8,
          productId: "product-1",
          productName: "Closure wig",
          quantityAvailable: 6,
          sku: "CW-18",
          storeId: "store-1",
        },
      ],
    ]),
    skuActivityEvent: new Map<string, Record<string, unknown>>(),
    stockAdjustmentBatch: new Map<string, Record<string, unknown>>([
      [
        "batch-1",
        {
          _id: "batch-1",
          adjustmentType: "manual",
          approvalRequestId: "approval-1",
          approvalRequired: true,
          createdAt: 1,
          createdByUserId: "operator-1",
          largestAbsoluteDelta: 6,
          lineItemCount: 1,
          lineItems: [
            {
              productId: "product-1",
              productName: "Closure wig",
              productSkuId: "sku-1",
              quantityDelta: -6,
              sku: "CW-18",
              systemQuantity: 8,
            },
          ],
          netQuantityDelta: -6,
          notes: "Cycle count variance",
          operationalWorkItemId: "work-item-1",
          organizationId: "org-1",
          reasonCode: "damage",
          status: "pending_approval",
          storeId: "store-1",
          submissionKey: "batch-key",
        },
      ],
    ]),
    users: new Map<string, Record<string, unknown>>([
      [
        "auth-user-1",
        {
          _id: "auth-user-1",
          email: "manager@example.com",
        },
      ],
    ]),
  };
  const insertCounters: Record<
    "inventoryMovement" | "operationalEvent" | "skuActivityEvent",
    number
  > = {
    inventoryMovement: 0,
    operationalEvent: 0,
    skuActivityEvent: 0,
  };

  mockedAuthServer.getAuthUserId.mockResolvedValue(args.authUserId ?? null);

  const query = (table: keyof typeof tables) => {
    if (table === "athenaUser") {
      return {
        collect: async () => Array.from(tables.athenaUser.values()),
      };
    }

    if (table === "organizationMember") {
      return {
        filter(
          applyFilter: (queryBuilder: {
            and: (...conditions: unknown[]) => unknown;
            eq: (field: string, value: unknown) => unknown;
            field: (fieldName: string) => string;
          }) => unknown,
        ) {
          const filters: Array<[string, unknown]> = [];
          const queryBuilder = {
            and: (...conditions: unknown[]) => conditions,
            eq(field: string, value: unknown) {
              filters.push([field, value]);
              return value;
            },
            field(fieldName: string) {
              return fieldName;
            },
          };

          applyFilter(queryBuilder);

          return {
            first: async () =>
              Array.from(tables.organizationMember.values()).find((record) =>
                filters.every(([field, value]) => record[field] === value),
              ) ?? null,
          };
        },
      };
    }

    if (
      table === "inventoryMovement" ||
      table === "operationalEvent" ||
      table === "skuActivityEvent"
    ) {
      return {
        withIndex(
          _index: string,
          applyIndex: (queryBuilder: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) {
          const filters: Array<[string, unknown]> = [];
          const queryBuilder = {
            eq(field: string, value: unknown) {
              filters.push([field, value]);
              return queryBuilder;
            },
          };

          applyIndex(queryBuilder);

          return {
            collect: async () =>
              Array.from(tables[table].values()).filter((record) =>
                filters.every(([field, value]) => record[field] === value),
              ),
            first: async () =>
              Array.from(tables[table].values()).find((record) =>
                filters.every(([field, value]) => record[field] === value),
              ) ?? null,
          };
        },
      };
    }

    throw new Error(`Unexpected query table: ${table}`);
  };

  const ctx = {
    auth: {},
    db: {
      async get(tableOrId: keyof typeof tables | string, id?: string) {
        if (id === undefined) {
          return tables.users.get(tableOrId as string) ?? null;
        }

        return tables[tableOrId as keyof typeof tables].get(id) ?? null;
      },
      async insert(
        table: "inventoryMovement" | "operationalEvent" | "skuActivityEvent",
        value: Record<string, unknown>,
      ) {
        insertCounters[table] += 1;
        const id = `${table}-${insertCounters[table]}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(
        table: keyof typeof tables,
        id: string,
        value: Record<string, unknown>,
      ) {
        const existingRecord = tables[table].get(id);

        if (!existingRecord) {
          throw new Error(`Missing ${table} record: ${id}`);
        }

        tables[table].set(id, { ...existingRecord, ...value });
      },
      query,
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

describe("approval request helpers", () => {
  it("builds pending approval requests with timestamps", () => {
    const request = buildApprovalRequest({
      storeId: "store_1" as Id<"store">,
      requestType: "variance_review",
      subjectType: "register_session",
      subjectId: "register_session_1",
      reason: "Variance exceeded threshold",
    });

    expect(request).toMatchObject({
      storeId: "store_1",
      requestType: "variance_review",
      subjectType: "register_session",
      subjectId: "register_session_1",
      reason: "Variance exceeded threshold",
      status: "pending",
    });
    expect(request.createdAt).toEqual(expect.any(Number));
  });

  it("allows full-admin reviewers to approve inventory adjustment requests", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });

    await decideApprovalRequestWithCtx(ctx, {
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      decision: "approved",
      reviewedByUserId: "manager-1" as Id<"athenaUser">,
    });

    expect(tables.approvalRequest.get("approval-1")).toMatchObject({
      decidedAt: expect.any(Number),
      reviewedByUserId: "manager-1",
      status: "approved",
    });
    expect(tables.stockAdjustmentBatch.get("batch-1")).toMatchObject({
      status: "applied",
    });
  });

  it("rejects reviewers who are not full admins", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "pos_only",
    });

    await expect(() =>
      decideApprovalRequestWithCtx(ctx, {
        approvalRequestId: "approval-1" as Id<"approvalRequest">,
        decision: "approved",
        reviewedByUserId: "manager-1" as Id<"athenaUser">,
      }),
    ).rejects.toThrow("Only full admins can resolve approval requests.");

    expect(tables.approvalRequest.get("approval-1")).toMatchObject({
      status: "pending",
    });
    expect(tables.stockAdjustmentBatch.get("batch-1")).toMatchObject({
      status: "pending_approval",
    });
  });

  it("returns an authentication user error when the reviewer is not signed in", async () => {
    const { ctx } = createApprovalRequestMutationCtx({
      authUserId: null,
      role: "full_admin",
    });

    await expect(
      decideApprovalRequestAsCommandWithCtx(ctx, {
        approvalRequestId: "approval-1" as Id<"approvalRequest">,
        decision: "approved",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "authentication_failed",
        message: "Sign in again to continue.",
      },
    });
  });

  it("returns an authorization user error when the reviewer is not a full admin", async () => {
    const { ctx } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "pos_only",
    });

    await expect(
      decideApprovalRequestAsCommandWithCtx(ctx, {
        approvalRequestId: "approval-1" as Id<"approvalRequest">,
        decision: "approved",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "Only full admins can resolve approval requests.",
      },
    });
  });

  it("derives the reviewer from the authenticated session", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });

    await decideApprovalRequestAsAuthenticatedUserWithCtx(ctx, {
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      approvalProofId: "proof-1" as Id<"approvalProof">,
      decision: "approved",
    });

    expect(tables.approvalRequest.get("approval-1")).toMatchObject({
      reviewedByStaffProfileId: "staff-manager-1",
      reviewedByUserId: "manager-1",
      status: "approved",
    });
  });

  it("rejects ambiguous duplicate Athena user matches for the authenticated reviewer", async () => {
    const { ctx } = createApprovalRequestMutationCtx({
      athenaUsers: [
        {
          _id: "manager-1",
          email: "manager@example.com",
        },
        {
          _id: "manager-2",
          email: "MANAGER@example.com",
        },
      ],
      authUserId: "auth-user-1",
      role: "full_admin",
    });

    await expect(
      decideApprovalRequestAsAuthenticatedUserWithCtx(ctx, {
        approvalRequestId: "approval-1" as Id<"approvalRequest">,
        decision: "approved",
      }),
    ).rejects.toThrow(
      "Multiple Athena users match this email. Resolve duplicate accounts before continuing.",
    );
  });

  it("returns a precondition user error when an approval request is already decided", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });

    tables.approvalRequest.set("approval-1", {
      ...tables.approvalRequest.get("approval-1"),
      status: "approved",
    });

    await expect(
      decideApprovalRequestAsCommandWithCtx(ctx, {
        approvalRequestId: "approval-1" as Id<"approvalRequest">,
        decision: "approved",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Approval request has already been decided.",
      },
    });
  });
});
