import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createServiceIntake,
  validateServiceIntakeInput,
} from "./serviceIntake";

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
      "Deposit amount must be greater than zero.",
      "Select how the deposit was collected.",
    ]);
  });

  it("allows linked customers without requiring manual customer fields", () => {
    expect(
      validateServiceIntakeInput({
        assignedStaffProfileId: "staff_1",
        customerProfileId: "customer_1",
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

  it("writes through the shared operations rails", () => {
    const source = getSource("./serviceIntake.ts");

    expect(source).toContain("../../shared/commandResult");
    expect(source).toContain("createOperationalWorkItemWithCtx");
    expect(source).toContain("recordOperationalEventWithCtx");
    expect(source).toContain("recordInventoryMovementWithCtx");
    expect(source).toContain("recordPaymentAllocationWithCtx");
    expect(source).toContain("buildApprovalRequest");
    expect(source).toContain("return ok(");
    expect(source).toContain("return userError(");
  });
});
