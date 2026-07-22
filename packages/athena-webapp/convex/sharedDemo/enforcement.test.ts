import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn() }));
vi.mock("./actor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actor")>();
  return {
    ...actual,
    requireSharedDemoCapabilityIfApplicable: vi.fn(),
    requireReadySharedDemoStoreCapabilityIfApplicable: vi.fn(),
    requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
  };
});
vi.mock("./restore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./restore")>();
  return { ...actual, requireReadySharedDemoWriteWithCtx: vi.fn() };
});
vi.mock("../operationAdmission/publicMutation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../operationAdmission/publicMutation")>();
  return {
    ...actual,
    admitSharedDemoPublicMutation:
      (_definition: unknown, handler: Function) => handler,
    withOperationMutationAdmission:
      (_definition: unknown, handler: Function) => handler,
  };
});

import { getAuthUserId } from "@convex-dev/auth/server";
import {
  requireReadySharedDemoStoreCapabilityIfApplicable,
  requireSharedDemoCapabilityIfApplicable,
  requireSharedDemoStoreCapabilityIfApplicable,
} from "./actor";
import { requireReadySharedDemoWriteWithCtx } from "./restore";
import { create as createInvite } from "../inventory/inviteCode";
import {
  patchConfigV2Command,
  remove as removeStore,
} from "../inventory/stores";
import { createStaffCredential } from "../operations/staffCredentials";
import { decideApprovalRequest } from "../operations/approvalRequests";
import { requestExport } from "../reporting/export";
import { processReturnExchange } from "../storeFront/onlineOrder";
import { createTransaction, refundPayment } from "../storeFront/payment";
import {
  createStaffProfile,
  updateStaffProfile,
} from "../operations/staffProfiles";

const invoke = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(
    ctx,
    args,
  );

describe("actual public shared-demo enforcement boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);
  });

  it.each([
    [createStaffCredential, "identity.manage", {}],
    [createInvite, "permissions.manage", {}],
    [requestExport, "exports.generate", { storeId: "store" }],
    [removeStore, "administration.destructive", { id: "store" }],
    [patchConfigV2Command, "integrations.manage", { id: "store", patch: {} }],
    [createStaffProfile, "staff.manage", {}],
    [updateStaffProfile, "staff.manage", {}],
  ] as const)("denies a representative actual function before its write", async (fn, capability, args) => {
    vi.mocked(requireSharedDemoCapabilityIfApplicable).mockRejectedValueOnce(
      new Error("This action is unavailable in the demo."),
    );
    const ctx = { db: { delete: vi.fn(), insert: vi.fn(), patch: vi.fn() } };

    await expect(invoke(fn, ctx, args)).rejects.toThrow(
      "This action is unavailable in the demo.",
    );
    expect(requireSharedDemoCapabilityIfApplicable).toHaveBeenCalledWith(
      ctx,
      capability,
    );
    expect(ctx.db.delete).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("routes demo return and exchange writes through the loaded order store clamp", async () => {
    const sentinel = new Error("boundary reached");
    vi.mocked(
      requireReadySharedDemoStoreCapabilityIfApplicable,
    ).mockRejectedValueOnce(sentinel);
    const ctx = {
      db: {
        get: vi.fn(async () => ({ _id: "order", storeId: "store" })),
      },
    };

    await expect(
      invoke(processReturnExchange, ctx, { orderId: "order" }),
    ).rejects.toThrow(sentinel.message);
    expect(
      requireReadySharedDemoStoreCapabilityIfApplicable,
    ).toHaveBeenCalledWith(
      ctx,
      "payments.refund",
      "store",
    );
  });

  it.each([
    [createTransaction, "billing.manage"],
    [refundPayment, "payments.refund"],
  ] as const)("denies an actual payment action before provider or mutation work", async (fn, capability) => {
    const denial = new Error("This action is unavailable in the demo.");
    const ctx = {
      runMutation: vi.fn(),
      runQuery: vi.fn().mockRejectedValue(denial),
    };
    await expect(invoke(fn, ctx, {})).rejects.toThrow(denial.message);
    expect(ctx.runQuery).toHaveBeenCalledWith(expect.anything(), { capability });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("preserves the existing normal store-removal behavior", async () => {
    vi.mocked(requireSharedDemoCapabilityIfApplicable).mockResolvedValueOnce(null);
    const ctx = { db: { delete: vi.fn() } };
    await expect(invoke(removeStore, ctx, { id: "store" })).resolves.toEqual({
      message: "OK",
    });
    expect(ctx.db.delete).toHaveBeenCalledWith("store", "store");
  });

  it("clamps and fences approval decisions to the request's demo store", async () => {
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
    vi.mocked(getAuthUserId).mockResolvedValue("auth-demo" as never);
    const sentinel = new Error("restore fence reached");
    vi.mocked(requireReadySharedDemoWriteWithCtx).mockRejectedValueOnce(sentinel);
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "approvalRequest" && id === "approval") {
            return {
              _id: "approval",
              organizationId: "org",
              status: "pending",
              storeId: "store",
            };
          }
          return null;
        }),
        insert: vi.fn(),
        patch: vi.fn(),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_index: string, apply: Function) => {
            apply({ eq: vi.fn().mockReturnThis() });
            return {
              unique: vi.fn(async () =>
                table === "sharedDemoPrincipal"
                  ? {
                      admissionExpiresAt: Date.now() + 60_000,
                      athenaUserId: "demo-athena",
                      authUserId: "auth-demo",
                      organizationId: "org",
                      storeId: "store",
                    }
                  : null,
              ),
            };
          }),
        })),
      },
    };

    await expect(
      invoke(decideApprovalRequest, ctx, {
        approvalRequestId: "approval",
        decision: "approved",
      }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(requireSharedDemoStoreCapabilityIfApplicable).not.toHaveBeenCalled();
    expect(requireReadySharedDemoWriteWithCtx).toHaveBeenCalledWith(ctx, {
      storeId: "store",
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

});
