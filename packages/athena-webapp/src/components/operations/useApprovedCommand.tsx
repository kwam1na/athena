import { useCallback, useMemo, useState } from "react";

import type { Id } from "~/convex/_generated/dataModel";
import type { ApprovalRequirement } from "~/shared/approvalPolicy";
import {
  isApprovalRequiredResult,
  type NormalizedApprovalCommandResult,
  type NormalizedCommandResult,
} from "@/lib/errors/runCommand";
import {
  CommandApprovalDialog,
  type CommandApprovalApprovedResult,
  type CommandApprovalProofResult,
} from "./CommandApprovalDialog";

type ApprovalRetryArgs = {
  approvalRequestId?: Id<"approvalRequest">;
  approvalProofId?: Id<"approvalProof">;
};

type SameSubmissionApprovalArgs = {
  canAttemptInlineManagerProof: boolean;
  pinHash: string;
  requestedByStaffProfileId?: Id<"staffProfile">;
  username: string;
};

type PendingApproval<T> = {
  approval: ApprovalRequirement;
  execute: (args: ApprovalRetryArgs) => Promise<NormalizedApprovalCommandResult<T>>;
  onApprovalRequired?: (approval: ApprovalRequirement) => void;
  onResult: (result: NormalizedApprovalCommandResult<T>) => void | Promise<void>;
  requestedByStaffProfileId?: Id<"staffProfile">;
};

type PendingCommand<T> = Omit<PendingApproval<T>, "approval"> & {
  approval?: ApprovalRequirement;
};

type RunApprovedCommandArgs<T> = {
  execute: (args: ApprovalRetryArgs) => Promise<NormalizedApprovalCommandResult<T>>;
  onApprovalRequired?: (approval: ApprovalRequirement) => void;
  onResult: (result: NormalizedApprovalCommandResult<T>) => void | Promise<void>;
  requestedByStaffProfileId?: Id<"staffProfile">;
  sameSubmissionApproval?: SameSubmissionApprovalArgs;
};

type UseApprovedCommandArgs = {
  onAuthenticateForApproval: (args: {
    actionKey: string;
    pinHash: string;
    reason?: string;
    requiredRole: ApprovalRequirement["requiredRole"];
    requestedByStaffProfileId?: Id<"staffProfile">;
    storeId: Id<"store">;
    subject: ApprovalRequirement["subject"];
    username: string;
  }) => Promise<NormalizedCommandResult<CommandApprovalProofResult>>;
  storeId?: Id<"store">;
};

function hasInlineManagerProof(approval: ApprovalRequirement) {
  return approval.resolutionModes.some(
    (mode) => mode.kind === "inline_manager_proof",
  );
}

function hasAsyncApprovalRequest(approval: ApprovalRequirement) {
  return approval.resolutionModes.some(
    (mode) => mode.kind === "async_request" && Boolean(mode.approvalRequestId),
  );
}

function getAsyncApprovalRequestId(approval: ApprovalRequirement) {
  const mode = approval.resolutionModes.find(
    (resolutionMode) =>
      resolutionMode.kind === "async_request" &&
      Boolean(resolutionMode.approvalRequestId),
  );

  return mode?.kind === "async_request"
    ? (mode.approvalRequestId as Id<"approvalRequest"> | undefined)
    : undefined;
}

function buildApprovalRetryArgs(
  approval: ApprovalRequirement,
  approvalProofId: Id<"approvalProof">,
): ApprovalRetryArgs {
  const approvalRequestId = getAsyncApprovalRequestId(approval);

  return {
    ...(approvalRequestId ? { approvalRequestId } : {}),
    approvalProofId,
  };
}

export function useApprovedCommand({ onAuthenticateForApproval, storeId }: UseApprovedCommandArgs) {
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval<unknown> | null>(null);

  const handleResult = useCallback(
    async <T,>(
      result: NormalizedApprovalCommandResult<T>,
      pending: PendingCommand<T>,
    ) => {
      if (isApprovalRequiredResult(result)) {
        pending.onApprovalRequired?.(result.approval);

        if (hasAsyncApprovalRequest(result.approval)) {
          setPendingApproval(null);
          await pending.onResult(result);
          return result;
        }

        setPendingApproval({
          ...pending,
          approval: result.approval,
        } as PendingApproval<unknown>);

        if (!hasInlineManagerProof(result.approval)) {
          await pending.onResult(result);
        }
        return result;
      }

      setPendingApproval(null);
      await pending.onResult(result);
      return result;
    },
    [],
  );

  const run = useCallback(
    async <T,>(args: RunApprovedCommandArgs<T>) => {
      const result = await args.execute({});
      if (
        isApprovalRequiredResult(result) &&
        storeId &&
        args.sameSubmissionApproval?.canAttemptInlineManagerProof &&
        hasInlineManagerProof(result.approval)
      ) {
        const approvalResult = await onAuthenticateForApproval({
          actionKey: result.approval.action.key,
          pinHash: args.sameSubmissionApproval.pinHash,
          reason: result.approval.reason,
          requiredRole: result.approval.requiredRole,
          requestedByStaffProfileId:
            args.sameSubmissionApproval.requestedByStaffProfileId ??
            args.requestedByStaffProfileId,
          storeId,
          subject: result.approval.subject,
          username: args.sameSubmissionApproval.username,
        });

        if (approvalResult.kind !== "ok") {
          await args.onResult(
            approvalResult as NormalizedApprovalCommandResult<T>,
          );
          return approvalResult as NormalizedApprovalCommandResult<T>;
        }

        const retryResult = await args.execute(
          buildApprovalRetryArgs(
            result.approval,
            approvalResult.data.approvalProofId,
          ),
        );
        return handleResult(retryResult, args);
      }

      return handleResult(result, args);
    },
    [handleResult, onAuthenticateForApproval, storeId],
  );

  const approvalDialog = useMemo(() => {
    if (!pendingApproval || !storeId) {
      return null;
    }

    return {
      approval: pendingApproval.approval,
      onAuthenticateForApproval,
      onApproved: async (result: CommandApprovalApprovedResult) => {
        const current = pendingApproval;
        if (!current) {
          return;
        }

        const retryResult = await current.execute(
          buildApprovalRetryArgs(current.approval, result.approvalProofId),
        );
        await handleResult(retryResult, current);
      },
      onDismiss: () => setPendingApproval(null),
      open: Boolean(pendingApproval),
      requestedByStaffProfileId: pendingApproval.requestedByStaffProfileId,
      storeId,
    };
  }, [handleResult, onAuthenticateForApproval, pendingApproval, storeId]);

  const dialog = approvalDialog ? <CommandApprovalDialog {...approvalDialog} /> : null;

  return {
    approvalDialog,
    dialog,
    pendingApproval: pendingApproval?.approval ?? null,
    run,
  };
}
