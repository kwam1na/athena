import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import type { ApprovalRequirement } from "~/shared/approvalPolicy";
import { ok, userError } from "~/shared/commandResult";
import { useApprovedCommand } from "./useApprovedCommand";

const storeId = "store-1" as Id<"store">;
const requesterId = "staff-requester" as Id<"staffProfile">;
const approval = {
  action: {
    key: "cash_controls.register_session.review_variance",
    label: "Review register closeout variance",
  },
  copy: {
    title: "Manager approval required",
    message: "Manager approval is required.",
    primaryActionLabel: "Approve",
  },
  reason: "Manager approval is required.",
  requiredRole: "manager",
  resolutionModes: [{ kind: "inline_manager_proof" }],
  subject: {
    id: "session-1",
    label: "Register 1",
    type: "register_session",
  },
} satisfies ApprovalRequirement;

vi.mock("./CommandApprovalDialog", () => ({
  CommandApprovalDialog: () => null,
}));

describe("useApprovedCommand", () => {
  it("passes through successful command results without approval UI", async () => {
    const onResult = vi.fn();
    const { result } = renderHook(() =>
      useApprovedCommand({
        storeId,
        onAuthenticateForApproval: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.run({
        execute: vi.fn().mockResolvedValue(ok({ action: "closed" })),
        onResult,
      });
    });

    expect(onResult).toHaveBeenCalledWith(ok({ action: "closed" }));
    expect(result.current.pendingApproval).toBeNull();
  });

  it("stores inline approval state and retries with the approved proof", async () => {
    const onResult = vi.fn();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ kind: "approval_required", approval })
      .mockResolvedValueOnce(ok({ action: "closed" }));
    const { result } = renderHook(() =>
      useApprovedCommand({
        storeId,
        onAuthenticateForApproval: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.run({
        execute,
        onResult,
        requestedByStaffProfileId: requesterId,
      });
    });

    expect(result.current.approvalDialog).toMatchObject({
      approval,
      requestedByStaffProfileId: requesterId,
      storeId,
    });

    await act(async () => {
      await result.current.approvalDialog?.onApproved({
        approval,
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
        expiresAt: 123,
      });
    });

    expect(execute).toHaveBeenLastCalledWith({
      approvalProofId: "proof-1",
    });
    expect(onResult).toHaveBeenCalledWith(ok({ action: "closed" }));
    expect(result.current.pendingApproval).toBeNull();
  });

  it("uses a same-submission manager proof before opening approval UI", async () => {
    const onResult = vi.fn();
    const onAuthenticateForApproval = vi.fn().mockResolvedValue(
      ok({
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
        expiresAt: 123,
      }),
    );
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ kind: "approval_required", approval })
      .mockResolvedValueOnce(ok({ action: "closed" }));
    const { result } = renderHook(() =>
      useApprovedCommand({
        storeId,
        onAuthenticateForApproval,
      }),
    );

    await act(async () => {
      await result.current.run({
        execute,
        onResult,
        requestedByStaffProfileId: requesterId,
        sameSubmissionApproval: {
          canAttemptInlineManagerProof: true,
          pinHash: "pin-hash",
          requestedByStaffProfileId: requesterId,
          username: "manager",
        },
      });
    });

    expect(onAuthenticateForApproval).toHaveBeenCalledWith({
      actionKey: approval.action.key,
      pinHash: "pin-hash",
      reason: approval.reason,
      requiredRole: approval.requiredRole,
      requestedByStaffProfileId: requesterId,
      storeId,
      subject: approval.subject,
      username: "manager",
    });
    expect(execute).toHaveBeenLastCalledWith({
      approvalProofId: "proof-1",
    });
    expect(onResult).toHaveBeenCalledWith(ok({ action: "closed" }));
    expect(result.current.pendingApproval).toBeNull();
    expect(result.current.approvalDialog).toBeNull();
  });

  it("falls back to approval UI when same-submission staff cannot approve", async () => {
    const onResult = vi.fn();
    const onAuthenticateForApproval = vi.fn();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ kind: "approval_required", approval });
    const { result } = renderHook(() =>
      useApprovedCommand({
        storeId,
        onAuthenticateForApproval,
      }),
    );

    await act(async () => {
      await result.current.run({
        execute,
        onResult,
        requestedByStaffProfileId: requesterId,
        sameSubmissionApproval: {
          canAttemptInlineManagerProof: false,
          pinHash: "pin-hash",
          requestedByStaffProfileId: requesterId,
          username: "cashier",
        },
      });
    });

    expect(onAuthenticateForApproval).not.toHaveBeenCalled();
    expect(result.current.approvalDialog).toMatchObject({
      approval,
      requestedByStaffProfileId: requesterId,
      storeId,
    });
  });

  it("surfaces same-submission proof failures without retrying", async () => {
    const proofError = userError({
      code: "authentication_failed",
      message: "Manager credentials required.",
    });
    const onResult = vi.fn();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ kind: "approval_required", approval });
    const { result } = renderHook(() =>
      useApprovedCommand({
        storeId,
        onAuthenticateForApproval: vi.fn().mockResolvedValue(proofError),
      }),
    );

    await act(async () => {
      await result.current.run({
        execute,
        onResult,
        requestedByStaffProfileId: requesterId,
        sameSubmissionApproval: {
          canAttemptInlineManagerProof: true,
          pinHash: "pin-hash",
          requestedByStaffProfileId: requesterId,
          username: "cashier",
        },
      });
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(proofError);
    expect(result.current.pendingApproval).toBeNull();
  });

  it("reports async approval requirements without authenticating inline", async () => {
    const asyncApproval = {
      ...approval,
      resolutionModes: [
        {
          approvalRequestId: "approval-1",
          kind: "async_request",
          requestType: "variance_review",
        },
      ],
    } satisfies ApprovalRequirement;
    const onResult = vi.fn();
    const onApprovalRequired = vi.fn();
    const { result } = renderHook(() =>
      useApprovedCommand({
        storeId,
        onAuthenticateForApproval: vi.fn().mockResolvedValue(
          userError({
            code: "authentication_failed",
            message: "Should not authenticate.",
          }),
        ),
      }),
    );

    await act(async () => {
      await result.current.run({
        execute: vi
          .fn()
          .mockResolvedValue({ kind: "approval_required", approval: asyncApproval }),
        onApprovalRequired,
        onResult,
      });
    });

    expect(onApprovalRequired).toHaveBeenCalledWith(asyncApproval);
    expect(onResult).toHaveBeenCalledWith({
      kind: "approval_required",
      approval: asyncApproval,
    });
    expect(result.current.approvalDialog).toBeNull();
    expect(result.current.pendingApproval).toBeNull();
  });
});
