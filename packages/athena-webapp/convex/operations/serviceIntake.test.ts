import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import {
  createServiceIntake,
  validateServiceIntakeInput,
} from "./serviceIntake";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
    _id: "user-auth",
    email: "admin@example.com",
  } as never);
  vi.mocked(athenaUserAuth.requireOrganizationMemberRoleWithCtx).mockResolvedValue(
    {
      _id: "member-1",
      organizationId: "org-1",
      role: "full_admin",
      userId: "user-auth",
    } as never,
  );
});

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function buildCreateServiceIntakeArgs(
  overrides: Record<string, unknown> = {},
) {
  return {
    assignedStaffProfileId: "staff-1",
    customerFullName: "Ama Mensah",
    customerPhoneNumber: "+233200000000",
    intakeChannel: "walk_in",
    serviceTitle: "Wash and restyle",
    storeId: "store-1",
    ...overrides,
  };
}

function createMutationCtx(args?: {
  dbGetError?: Error;
  staffProfile?: Record<string, unknown> | null;
  store?: Record<string, unknown> | null;
}) {
  return {
    db: {
      get: vi.fn(async (table: string) => {
        if (args?.dbGetError) {
          throw args.dbGetError;
        }

        if (table === "store") {
          if (args && "store" in args) {
            return args.store;
          }

          return {
            _id: "store-1",
            organizationId: "org-1",
          };
        }

        if (table === "staffProfile") {
          if (args && "staffProfile" in args) {
            return args.staffProfile;
          }

          return {
            _id: "staff-1",
            status: "active",
            storeId: "store-1",
          };
        }

        return null;
      }),
      insert: vi.fn(),
      patch: vi.fn(),
      query: vi.fn(),
    },
  };
}

function createServiceIntakeBehaviorCtx() {
  const rows: Record<string, Map<string, Record<string, unknown>>> = {
    approvalRequest: new Map(),
    customerProfile: new Map([
      [
        "customer-1",
        {
          _id: "customer-1",
          fullName: "Ama Mensah",
          phoneNumber: "+233200000000",
          storeId: "store-1",
        },
      ],
    ]),
    inventoryMovement: new Map(),
    operationalEvent: new Map(),
    operationalWorkItem: new Map(),
    paymentAllocation: new Map(),
    serviceCase: new Map(),
    staffProfile: new Map([
      [
        "staff-1",
        {
          _id: "staff-1",
          linkedUserId: "user-auth",
          status: "active",
          storeId: "store-1",
        },
      ],
    ]),
    store: new Map([
      [
        "store-1",
        {
          _id: "store-1",
          organizationId: "org-1",
        },
      ],
    ]),
  };
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const get = vi.fn(async (tableName: string, id: string) => {
    return rows[tableName]?.get(id) ?? null;
  });
  const insert = vi.fn(async (tableName: string, value: Record<string, unknown>) => {
    const id = `${tableName}-${(rows[tableName]?.size ?? 0) + 1}`;
    const row = { _id: id, ...value };
    inserts.push({ table: tableName, value });
    rows[tableName] ??= new Map();
    rows[tableName].set(id, row);
    return id;
  });
  const patch = vi.fn(
    async (tableName: string, id: string, patchValue: Record<string, unknown>) => {
      const row = rows[tableName]?.get(id);
      if (row) {
        rows[tableName].set(id, { ...row, ...patchValue });
      }
    },
  );
  const query = vi.fn((tableName: string) => ({
    withIndex: vi.fn((_indexName: string, applyIndex: Function) => {
      const constraints: Record<string, unknown> = {};
      const queryBuilder = {
        eq(fieldName: string, value: unknown) {
          constraints[fieldName] = value;
          return queryBuilder;
        },
      };
      applyIndex(queryBuilder);

      const matchingRows = () =>
        Array.from(rows[tableName]?.values() ?? []).filter((row) =>
          Object.entries(constraints).every(([fieldName, value]) => row[fieldName] === value),
        );

      return {
        collect: vi.fn(async () => matchingRows()),
        first: vi.fn(async () => matchingRows()[0] ?? null),
        order: vi.fn(() => ({
          first: vi.fn(async () => matchingRows()[0] ?? null),
        })),
        take: vi.fn(async (limit: number) => matchingRows().slice(0, limit)),
        unique: vi.fn(async () => matchingRows()[0] ?? null),
      };
    }),
  }));

  return {
    db: {
      get,
      insert,
      patch,
      query,
    },
    inserts,
    rows,
  };
}

describe("service intake validation", () => {
  it("rejects missing assignees and invalid deposits", () => {
    expect(
      validateServiceIntakeInput({
        customerFullName: "Ama Mensah",
        depositAmount: 0,
        serviceTitle: "Wash and restyle",
      })
    ).toEqual([
      "An assignee is required.",
      "Customer phone number is required.",
      "Deposit amount must be greater than zero.",
      "Select how the deposit was collected.",
    ]);
  });

  it("allows linked customers without requiring manual customer fields", () => {
    expect(
      validateServiceIntakeInput({
        assignedStaffProfileId: "staff_1",
        customerProfileId: "customer_1",
        customerPhoneNumber: "+233200000000",
        serviceTitle: "Install closure wig",
      })
    ).toEqual([]);
  });

  it("returns a validation_failed user_error for invalid intake input", async () => {
    const ctx = createMutationCtx();

    const result = await getHandler(createServiceIntake)(
      ctx as never,
      buildCreateServiceIntakeArgs({
        assignedStaffProfileId: undefined,
        depositAmount: 0,
      }) as never,
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message:
          "An assignee is required. Deposit amount must be greater than zero. Select how the deposit was collected.",
      },
    });
    expect(ctx.db.get).not.toHaveBeenCalled();
  });

  it("returns a precondition_failed user_error when the assignee is unavailable", async () => {
    const ctx = createMutationCtx({
      staffProfile: null,
    });

    const result = await getHandler(createServiceIntake)(
      ctx as never,
      buildCreateServiceIntakeArgs() as never,
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Assigned staff member is not available for this store.",
      },
    });
  });

  it("requires store admin access before service intake writes", async () => {
    const ctx = createMutationCtx();
    vi.mocked(athenaUserAuth.requireOrganizationMemberRoleWithCtx).mockRejectedValue(
      new Error("Only store admins can create service intake work."),
    );

    await expect(
      getHandler(createServiceIntake)(
        ctx as never,
        buildCreateServiceIntakeArgs() as never,
      ),
    ).rejects.toThrow("Only store admins can create service intake work.");

    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).toHaveBeenCalledWith(ctx);
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "Only store admins can create service intake work.",
      organizationId: "org-1",
      userId: "user-auth",
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("keeps unexpected infrastructure faults thrown", async () => {
    const ctx = createMutationCtx({
      dbGetError: new Error("database offline"),
    });

    await expect(
      getHandler(createServiceIntake)(
        ctx as never,
        buildCreateServiceIntakeArgs() as never,
      ),
    ).rejects.toThrow("database offline");
  });

  it("records service deposits without creating approval requests", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 6, 2, 12));
    const ctx = createServiceIntakeBehaviorCtx();

    const result = await getHandler(createServiceIntake)(
      ctx as never,
      buildCreateServiceIntakeArgs({
        createdByUserId: "user-spoof",
        customerProfileId: "customer-1",
        depositAmount: 2500,
        depositMethod: "cash",
        intakeChannel: "phone_booking",
      }) as never,
    );

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        customerProfileId: "customer-1",
        serviceCaseId: "serviceCase-1",
        workItemId: "operationalWorkItem-1",
      },
    });
    expect(ctx.rows.approvalRequest.size).toBe(0);
    expect(ctx.inserts).not.toContainEqual(
      expect.objectContaining({ table: "approvalRequest" }),
    );
    expect(ctx.rows.operationalWorkItem.get("operationalWorkItem-1")).toMatchObject({
      approvalState: "not_required",
      createdByStaffProfileId: "staff-1",
      createdByUserId: "user-auth",
      type: "service_intake",
    });
    expect(ctx.rows.paymentAllocation.get("paymentAllocation-1")).toMatchObject({
      actorStaffProfileId: "staff-1",
      actorUserId: "user-auth",
      allocationType: "service_deposit",
      amount: 2500,
      businessEventKey: "service:serviceCase-1:intake_deposit",
      targetId: "serviceCase-1",
      targetType: "service_case",
      workItemId: "operationalWorkItem-1",
    });
    expect(
      Array.from(ctx.rows.operationalEvent.values()).map((event) => ({
        actorStaffProfileId: event.actorStaffProfileId,
        actorUserId: event.actorUserId,
        eventType: event.eventType,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          actorStaffProfileId: undefined,
          actorUserId: "user-auth",
          eventType: "service_case_created",
        },
        {
          actorStaffProfileId: "staff-1",
          actorUserId: "user-auth",
          eventType: "service_intake_created",
        },
      ]),
    );
  });

  it("writes through the shared operations rails", () => {
    const source = getSource("./serviceIntake.ts");

    expect(source).toContain("../../shared/commandResult");
    expect(source).toContain("createOperationalWorkItemWithCtx");
    expect(source).toContain("recordOperationalEventWithCtx");
    expect(source).toContain("recordInventoryMovementWithCtx");
    expect(source).toContain("recordPaymentAllocationWithCtx");
    expect(source).not.toContain("buildApprovalRequest");
    expect(source).not.toContain("service_deposit_review");
    expect(source).toContain("return ok(");
    expect(source).toContain("return userError(");
  });
});
