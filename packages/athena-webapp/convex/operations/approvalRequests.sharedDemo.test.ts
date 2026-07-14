import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", () => authMocks);

import { decideApprovalRequestAsAuthenticatedUserWithCtx } from "./approvalRequests";

describe("shared demo approval decisions", () => {
  it("resolves the reviewer through the approvals demo capability", async () => {
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
      _id: "demo-user-1",
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

    expect(
      authMocks.requireAuthenticatedAthenaUserWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      sharedDemoCapability: "approvals.manage",
    });
  });
});
