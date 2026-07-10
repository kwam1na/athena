import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { buildApprovalRequest } from "./approvalRequestHelpers";
import {
  decideApprovalRequest,
  decideApprovalRequestAsCommandWithCtx,
  decideApprovalRequestAsAuthenticatedUserWithCtx,
  decideApprovalRequestWithCtx,
} from "./approvalRequests";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { resolveTransactionItemAdjustmentApprovalDecisionWithCtx } from "../pos/application/commands/adjustTransactionItems";
import { resolveTransactionVoidApprovalDecisionWithCtx } from "../pos/application/commands/completeTransaction";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));
const reportingMocks = vi.hoisted(() => ({
  applyInventoryEffectWithCtx: vi.fn(async () => ({ movement: null })),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

vi.mock("../reporting/inventory/effects", () => ({
  applyInventoryEffectWithCtx: reportingMocks.applyInventoryEffectWithCtx,
}));

vi.mock("../reporting/operatingPeriods", () => ({
  resolveReportingOperatingPeriodWithCtx: vi.fn(async () => ({
    kind: "missing_schedule",
    occurrenceAt: 1,
  })),
}));

vi.mock("../pos/application/commands/adjustTransactionItems", () => ({
  resolveTransactionItemAdjustmentApprovalDecisionWithCtx: vi.fn(),
}));

vi.mock("../pos/application/commands/completeTransaction", () => ({
  resolveTransactionVoidApprovalDecisionWithCtx: vi.fn(),
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
      ).map((athenaUser) => [
        athenaUser._id,
        { ...athenaUser, normalizedEmail: athenaUser.email.trim().toLowerCase() },
      ]),
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
    store: new Map<string, Record<string, unknown>>([
      [
        "store-1",
        {
          _id: "store-1",
          organizationId: "org-1",
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
      const rows = Array.from(tables.athenaUser.values());
      return {
        collect: async () => rows,
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
          const matches = rows.filter((record) =>
            filters.every(([field, value]) => record[field] === value),
          );
          return {
            first: async () => matches[0] ?? null,
            take: async (limit: number) => matches.slice(0, limit),
          };
        },
      };
    }

    if (table === "organizationMember") {
      const findMember = (filters: Array<[string, unknown]>) =>
        Array.from(tables.organizationMember.values()).find((record) =>
          filters.every(([field, value]) => record[field] === value),
        ) ?? null;

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
            first: async () => findMember(filters),
          };
        },
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
            first: async () => findMember(filters),
          };
        },
      };
    }

    if (
      table === "inventoryMovement" ||
      table === "operationalEvent" ||
      table === "operationalWorkItem" ||
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
            take: async (limit: number) =>
              Array.from(tables[table].values())
                .filter((record) =>
                  filters.every(([field, value]) => record[field] === value),
                )
                .slice(0, limit),
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

  it("routes POS item adjustment approvals through the async resolver", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });
    tables.approvalRequest.set("approval-item-1", {
      _id: "approval-item-1",
      organizationId: "org-1",
      requestType: "pos_item_adjustment",
      status: "pending",
      storeId: "store-1",
      subjectId: "pos_transaction_item_adjustment:txn-1:fingerprint",
      subjectType: "pos_transaction_item_adjustment",
    });

    await decideApprovalRequestWithCtx(ctx, {
      approvalRequestId: "approval-item-1" as Id<"approvalRequest">,
      decision: "approved",
      reviewedByStaffProfileId: "staff-manager-1" as Id<"staffProfile">,
      reviewedByUserId: "manager-1" as Id<"athenaUser">,
    });

    expect(
      resolveTransactionItemAdjustmentApprovalDecisionWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      approvalRequestId: "approval-item-1",
      decision: "approved",
      reviewedByStaffProfileId: "staff-manager-1",
      reviewedByUserId: "manager-1",
    });
    expect(tables.approvalRequest.get("approval-item-1")).toMatchObject({
      status: "approved",
    });
  });

  it("routes completed sale void approvals through the async resolver", async () => {
    vi.mocked(resolveTransactionVoidApprovalDecisionWithCtx).mockClear();
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });
    tables.approvalRequest.set("approval-void-1", {
      _id: "approval-void-1",
      organizationId: "org-1",
      posTransactionId: "txn-1",
      requestType: "pos_transaction_void",
      status: "pending",
      storeId: "store-1",
      subjectId: "txn-1",
      subjectType: "pos_transaction",
    });

    await decideApprovalRequestWithCtx(ctx, {
      approvalProofId: "proof-1" as Id<"approvalProof">,
      approvalRequestId: "approval-void-1" as Id<"approvalRequest">,
      decision: "approved",
      reviewedByStaffProfileId: "staff-manager-1" as Id<"staffProfile">,
      reviewedByUserId: "manager-1" as Id<"athenaUser">,
    });

    expect(resolveTransactionVoidApprovalDecisionWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        approvalProofId: "proof-1",
        approvalRequestId: "approval-void-1",
        decision: "approved",
        reviewedByStaffProfileId: "staff-manager-1",
        reviewedByUserId: "manager-1",
      },
    );
    expect(tables.approvalRequest.get("approval-void-1")).toMatchObject({
      status: "approved",
    });
  });

  it("preserves the queued void reason as decision notes when approval has no notes", async () => {
    vi.mocked(resolveTransactionVoidApprovalDecisionWithCtx).mockClear();
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });
    tables.approvalRequest.set("approval-void-1", {
      _id: "approval-void-1",
      notes: "Duplicate sale entered.",
      organizationId: "org-1",
      posTransactionId: "txn-1",
      requestType: "pos_transaction_void",
      status: "pending",
      storeId: "store-1",
      subjectId: "txn-1",
      subjectType: "pos_transaction",
    });

    await decideApprovalRequestWithCtx(ctx, {
      approvalProofId: "proof-1" as Id<"approvalProof">,
      approvalRequestId: "approval-void-1" as Id<"approvalRequest">,
      decision: "approved",
      reviewedByStaffProfileId: "staff-manager-1" as Id<"staffProfile">,
      reviewedByUserId: "manager-1" as Id<"athenaUser">,
    });

    expect(tables.approvalRequest.get("approval-void-1")).toMatchObject({
      decisionNotes: "Duplicate sale entered.",
      status: "approved",
    });
  });

  it("does not route already-decided POS item adjustment approvals to the async resolver", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });
    tables.approvalRequest.set("approval-item-1", {
      _id: "approval-item-1",
      organizationId: "org-1",
      requestType: "pos_item_adjustment",
      status: "approved",
      storeId: "store-1",
      subjectId: "pos_transaction_item_adjustment:txn-1:fingerprint",
      subjectType: "pos_transaction_item_adjustment",
    });

    await expect(
      decideApprovalRequestWithCtx(ctx, {
        approvalRequestId: "approval-item-1" as Id<"approvalRequest">,
        decision: "approved",
        reviewedByStaffProfileId: "staff-manager-1" as Id<"staffProfile">,
        reviewedByUserId: "manager-1" as Id<"athenaUser">,
      }),
    ).rejects.toThrow("Approval request has already been decided.");

    expect(
      resolveTransactionItemAdjustmentApprovalDecisionWithCtx,
    ).not.toHaveBeenCalled();
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

    const result = await decideApprovalRequestAsCommandWithCtx(ctx, {
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      approvalProofId: "proof-1" as Id<"approvalProof">,
      decision: "approved",
    });

    assertConformsToExportedReturns(decideApprovalRequest, result);
    expect(result).toMatchObject({
      kind: "ok",
      data: {
        decisionApprovalProofId: "proof-1",
        decisionApprovedByStaffProfileId: "staff-manager-1",
        reviewedByStaffProfileId: "staff-manager-1",
        reviewedByUserId: "manager-1",
        status: "approved",
      },
    });
    expect(tables.approvalRequest.get("approval-1")).toMatchObject({
      decisionApprovalProofId: "proof-1",
      decisionApprovedByStaffProfileId: "staff-manager-1",
      reviewedByStaffProfileId: "staff-manager-1",
      reviewedByUserId: "manager-1",
      status: "approved",
    });
  });

  it("rejects unsupported service deposit reviews before consuming manager proof", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });
    tables.approvalRequest.set("approval-service-deposit", {
      _id: "approval-service-deposit",
      organizationId: "org-1",
      requestType: "service_deposit_review",
      status: "pending",
      storeId: "store-1",
      subjectId: "service-case-1",
      subjectType: "service_case",
    });
    tables.approvalProof.set("proof-service-deposit", {
      _id: "proof-service-deposit",
      actionKey: "operations.approval_request.decide",
      approvedByCredentialId: "credential-1",
      approvedByStaffProfileId: "staff-manager-1",
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
      requiredRole: "manager",
      storeId: "store-1",
      subjectId: "approval-service-deposit",
      subjectLabel: "service_deposit_review",
      subjectType: "approval_request",
    });

    await expect(
      decideApprovalRequestAsAuthenticatedUserWithCtx(ctx, {
        approvalProofId: "proof-service-deposit" as Id<"approvalProof">,
        approvalRequestId: "approval-service-deposit" as Id<"approvalRequest">,
        decision: "approved",
      }),
    ).rejects.toThrow("Service deposit approval reviews can only be retired.");

    expect(
      tables.approvalProof.get("proof-service-deposit"),
    ).not.toHaveProperty("consumedAt");
    expect(
      tables.approvalRequest.get("approval-service-deposit"),
    ).toMatchObject({
      status: "pending",
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

  it("returns item adjustment settlement invariant failures as user errors", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });
    tables.approvalRequest.set("approval-item-1", {
      _id: "approval-item-1",
      organizationId: "org-1",
      requestType: "pos_item_adjustment",
      status: "pending",
      storeId: "store-1",
      subjectId: "pos_transaction_item_adjustment:txn-1:fingerprint",
      subjectType: "pos_transaction_item_adjustment",
    });
    tables.approvalProof.set("proof-1", {
      ...tables.approvalProof.get("proof-1"),
      subjectId: "approval-item-1",
      subjectLabel: "pos_item_adjustment",
    });
    vi.mocked(
      resolveTransactionItemAdjustmentApprovalDecisionWithCtx,
    ).mockRejectedValueOnce(
      new Error("Register session expected cash cannot be negative."),
    );

    await expect(
      decideApprovalRequestAsCommandWithCtx(ctx, {
        approvalRequestId: "approval-item-1" as Id<"approvalRequest">,
        approvalProofId: "proof-1" as Id<"approvalProof">,
        decision: "approved",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Register session expected cash cannot be negative.",
      },
    });
    expect(tables.approvalRequest.get("approval-item-1")).toMatchObject({
      decisionNotes: "Register session expected cash cannot be negative.",
      decisionApprovalProofId: "proof-1",
      decisionApprovedByStaffProfileId: "staff-manager-1",
      failedAt: expect.any(Number),
      failureCode: "decision_apply_failed",
      failureMessage: "Register session expected cash cannot be negative.",
      freshApprovalRequired: true,
      reviewedByStaffProfileId: "staff-manager-1",
      reviewedByUserId: "manager-1",
      status: "cancelled",
    });
    expect(
      tables.approvalRequest.get("approval-item-1")?.metadata,
    ).toMatchObject({
      applyFailureMessage: "Register session expected cash cannot be negative.",
    });
  });

  it("returns duplicate pending item adjustment failures as user errors", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });
    tables.approvalRequest.set("approval-item-1", {
      _id: "approval-item-1",
      organizationId: "org-1",
      requestType: "pos_item_adjustment",
      status: "pending",
      storeId: "store-1",
      subjectId: "pos_transaction_item_adjustment:txn-1:fingerprint",
      subjectType: "pos_transaction_item_adjustment",
    });
    tables.approvalProof.set("proof-1", {
      ...tables.approvalProof.get("proof-1"),
      subjectId: "approval-item-1",
      subjectLabel: "pos_item_adjustment",
    });
    vi.mocked(
      resolveTransactionItemAdjustmentApprovalDecisionWithCtx,
    ).mockRejectedValueOnce(
      new Error(
        "This transaction already has an item adjustment waiting for approval.",
      ),
    );

    await expect(
      decideApprovalRequestAsCommandWithCtx(ctx, {
        approvalRequestId: "approval-item-1" as Id<"approvalRequest">,
        approvalProofId: "proof-1" as Id<"approvalProof">,
        decision: "approved",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message:
          "This transaction already has an item adjustment waiting for approval.",
      },
    });
  });

  it("rejects unsupported service deposit approval while allowing retirement", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });
    tables.approvalRequest.set("approval-service-deposit-1", {
      _id: "approval-service-deposit-1",
      organizationId: "org-1",
      requestType: "service_deposit_review",
      status: "pending",
      storeId: "store-1",
      subjectId: "service-case-1",
      subjectType: "service_case",
      workItemId: "work-item-service-1",
    });
    tables.operationalWorkItem.set("work-item-service-1", {
      _id: "work-item-service-1",
      approvalRequestId: "approval-service-deposit-1",
      approvalState: "pending",
      organizationId: "org-1",
      status: "open",
      storeId: "store-1",
      type: "service_deposit_review",
    });
    tables.approvalProof.set("proof-1", {
      ...tables.approvalProof.get("proof-1"),
      subjectId: "approval-service-deposit-1",
      subjectLabel: "service_deposit_review",
    });

    await expect(
      decideApprovalRequestAsCommandWithCtx(ctx, {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvalRequestId:
          "approval-service-deposit-1" as Id<"approvalRequest">,
        decision: "approved",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Service deposit approval reviews can only be retired.",
      },
    });
    expect(
      tables.approvalRequest.get("approval-service-deposit-1"),
    ).toMatchObject({
      status: "pending",
    });
    expect(tables.approvalProof.get("proof-1")).not.toHaveProperty(
      "consumedAt",
    );

    await expect(
      decideApprovalRequestAsCommandWithCtx(ctx, {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvalRequestId:
          "approval-service-deposit-1" as Id<"approvalRequest">,
        decision: "rejected",
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      data: {
        status: "rejected",
      },
    });
    expect(tables.operationalWorkItem.get("work-item-service-1")).toMatchObject(
      {
        approvalState: "rejected",
        status: "cancelled",
      },
    );
  });

  it("does not retire unrelated work items from stale legacy approval links", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });
    tables.approvalRequest.set("approval-service-deposit-stale", {
      _id: "approval-service-deposit-stale",
      organizationId: "org-1",
      requestType: "service_deposit_review",
      status: "pending",
      storeId: "store-1",
      subjectId: "service-case-1",
      subjectType: "service_case",
      workItemId: "work-item-unrelated",
    });
    tables.operationalWorkItem.set("work-item-unrelated", {
      _id: "work-item-unrelated",
      approvalRequestId: "approval-other",
      approvalState: "pending",
      organizationId: "org-1",
      status: "open",
      storeId: "store-1",
      type: "service_deposit_review",
    });
    tables.approvalProof.set("proof-stale", {
      ...tables.approvalProof.get("proof-1"),
      _id: "proof-stale",
      subjectId: "approval-service-deposit-stale",
      subjectLabel: "service_deposit_review",
    });

    await expect(
      decideApprovalRequestAsCommandWithCtx(ctx, {
        approvalProofId: "proof-stale" as Id<"approvalProof">,
        approvalRequestId:
          "approval-service-deposit-stale" as Id<"approvalRequest">,
        decision: "rejected",
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      data: {
        status: "rejected",
      },
    });
    expect(tables.operationalWorkItem.get("work-item-unrelated")).toMatchObject(
      {
        approvalRequestId: "approval-other",
        approvalState: "pending",
        status: "open",
      },
    );
  });

  it.each([
    {
      field: "storeId",
      value: "store-2",
    },
    {
      field: "organizationId",
      value: "org-2",
    },
  ])(
    "does not retire unsupported approval work items when $field does not match",
    async ({ field, value }) => {
      const { ctx, tables } = createApprovalRequestMutationCtx({
        authUserId: "auth-user-1",
        role: "full_admin",
      });
      tables.approvalRequest.set("approval-service-deposit-mismatch", {
        _id: "approval-service-deposit-mismatch",
        organizationId: "org-1",
        requestType: "service_deposit_review",
        status: "pending",
        storeId: "store-1",
        subjectId: "service-case-1",
        subjectType: "service_case",
        workItemId: "work-item-mismatch",
      });
      tables.operationalWorkItem.set("work-item-mismatch", {
        _id: "work-item-mismatch",
        approvalRequestId: "approval-service-deposit-mismatch",
        approvalState: "pending",
        organizationId: "org-1",
        status: "open",
        storeId: "store-1",
        type: "service_deposit_review",
        [field]: value,
      });
      tables.approvalProof.set("proof-mismatch", {
        ...tables.approvalProof.get("proof-1"),
        _id: "proof-mismatch",
        subjectId: "approval-service-deposit-mismatch",
        subjectLabel: "service_deposit_review",
      });

      await expect(
        decideApprovalRequestAsCommandWithCtx(ctx, {
          approvalProofId: "proof-mismatch" as Id<"approvalProof">,
          approvalRequestId:
            "approval-service-deposit-mismatch" as Id<"approvalRequest">,
          decision: "rejected",
        }),
      ).resolves.toMatchObject({
        kind: "ok",
        data: {
          status: "rejected",
        },
      });
      expect(
        tables.operationalWorkItem.get("work-item-mismatch"),
      ).toMatchObject({
        approvalState: "pending",
        status: "open",
        [field]: value,
      });
    },
  );

  it("rejects unsupported approval-only request types before consuming proof", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });
    tables.approvalRequest.set("approval-online-return-1", {
      _id: "approval-online-return-1",
      organizationId: "org-1",
      requestType: "online_order_return_review",
      status: "pending",
      storeId: "store-1",
      subjectId: "online-order-1",
      subjectType: "online_order",
    });
    tables.approvalRequest.set("approval-legacy-item-1", {
      _id: "approval-legacy-item-1",
      organizationId: "org-1",
      requestType: "pos_item_adjustment_review",
      status: "pending",
      storeId: "store-1",
      subjectId: "adjustment-1",
      subjectType: "pos_item_adjustment",
    });
    tables.approvalProof.set("proof-online-return", {
      ...tables.approvalProof.get("proof-1"),
      _id: "proof-online-return",
      subjectId: "approval-online-return-1",
      subjectLabel: "online_order_return_review",
    });
    tables.approvalProof.set("proof-legacy-item", {
      ...tables.approvalProof.get("proof-1"),
      _id: "proof-legacy-item",
      subjectId: "approval-legacy-item-1",
      subjectLabel: "pos_item_adjustment_review",
    });

    await expect(
      decideApprovalRequestAsCommandWithCtx(ctx, {
        approvalProofId: "proof-online-return" as Id<"approvalProof">,
        approvalRequestId: "approval-online-return-1" as Id<"approvalRequest">,
        decision: "approved",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Online return approval reviews are not supported yet.",
      },
    });
    await expect(
      decideApprovalRequestAsCommandWithCtx(ctx, {
        approvalProofId: "proof-legacy-item" as Id<"approvalProof">,
        approvalRequestId: "approval-legacy-item-1" as Id<"approvalRequest">,
        decision: "approved",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Legacy item adjustment approval reviews can only be retired.",
      },
    });
    expect(tables.approvalProof.get("proof-online-return")).not.toHaveProperty(
      "consumedAt",
    );
    expect(tables.approvalProof.get("proof-legacy-item")).not.toHaveProperty(
      "consumedAt",
    );
  });

  it("maps queued void resolver precondition failures to command user errors", async () => {
    const { ctx, tables } = createApprovalRequestMutationCtx({
      authUserId: "auth-user-1",
      role: "full_admin",
    });
    tables.approvalRequest.set("approval-void-1", {
      _id: "approval-void-1",
      organizationId: "org-1",
      posTransactionId: "txn-1",
      requestType: "pos_transaction_void",
      status: "pending",
      storeId: "store-1",
      subjectId: "txn-1",
      subjectType: "pos_transaction",
    });
    tables.approvalProof.set("proof-1", {
      ...tables.approvalProof.get("proof-1"),
      subjectId: "approval-void-1",
      subjectLabel: "pos_transaction_void",
    });
    vi.mocked(
      resolveTransactionVoidApprovalDecisionWithCtx,
    ).mockRejectedValueOnce(
      new Error("Drawer closed. Open the drawer before voiding this sale."),
    );

    await expect(
      decideApprovalRequestAsCommandWithCtx(ctx, {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvalRequestId: "approval-void-1" as Id<"approvalRequest">,
        decision: "approved",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Drawer closed. Open the drawer before voiding this sale.",
      },
    });
  });
});
