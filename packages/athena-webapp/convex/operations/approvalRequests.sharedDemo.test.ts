import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", () => authMocks);

import { decideApprovalRequestAsAuthenticatedUserWithCtx } from "./approvalRequests";

describe("shared demo approval decisions", () => {
  it("resolves the reviewer from operation admission context", async () => {
    const demoUser = {
      _id: "demo-user-1",
    };
    const ctx = {
      operationAdmission: {
        actor: {
          kind: "shared_demo",
          athenaUserId: "demo-user-1",
        },
      },
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "approvalRequest" && id === "approval-1") {
            return {
              _id: "approval-1",
              organizationId: "org-1",
              requestType: "payment_method_correction",
              status: "pending",
              storeId: "store-1",
            };
          }
          if (table === "athenaUser" && id === demoUser._id) return demoUser;
          return null;
        }),
      },
    } as never;
    authMocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue({
      role: "full_admin",
    });

    await expect(
      decideApprovalRequestAsAuthenticatedUserWithCtx(ctx, {
        approvalRequestId: "approval-1" as never,
        decision: "approved",
      }),
    ).rejects.toThrow(
      "Manager approval is required to resolve approval requests.",
    );

    expect(authMocks.requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
    expect(authMocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "demo-user-1",
      }),
    );
  });

  it("keeps normal reviewer auth as the fallback without helper-only demo options", async () => {
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "approval-1",
          organizationId: "org-1",
          requestType: "payment_method_correction",
          status: "pending",
          storeId: "store-1",
        }),
      },
    } as never;
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "user-1",
    });
    authMocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue({
      role: "full_admin",
    });

    await expect(
      decideApprovalRequestAsAuthenticatedUserWithCtx(ctx, {
        approvalRequestId: "approval-1" as never,
        decision: "approved",
      }),
    ).rejects.toThrow(
      "Manager approval is required to resolve approval requests.",
    );

    expect(authMocks.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(
      ctx,
    );
  });
});
