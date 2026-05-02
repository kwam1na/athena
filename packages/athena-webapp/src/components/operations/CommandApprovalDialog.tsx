import { useRef } from "react";

import {
  StaffAuthenticationDialog,
  type StaffAuthMode,
  type StaffAuthenticationResult,
} from "@/components/staff-auth/StaffAuthenticationDialog";
import { Button } from "@/components/ui/button";
import { formatReviewReason } from "@/components/cash-controls/formatReviewReason";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { type NormalizedCommandResult } from "@/lib/errors/runCommand";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import type { Id } from "~/convex/_generated/dataModel";
import type {
  ApprovalRequirement,
  ApprovalResolutionMode,
} from "~/shared/approvalPolicy";
import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  GENERIC_UNEXPECTED_ERROR_TITLE,
} from "~/shared/commandResult";
import { currencyFormatter } from "~/shared/currencyFormatter";

type InlineManagerResolutionMode = Extract<
  ApprovalResolutionMode,
  { kind: "inline_manager_proof" }
>;

export type CommandApprovalProofResult = {
  approvalProofId: Id<"approvalProof">;
  approvedByStaffProfileId: Id<"staffProfile">;
  expiresAt: number;
  requestedByStaffProfileId?: Id<"staffProfile">;
};

export type CommandApprovalApprovedResult = {
  approval: ApprovalRequirement;
  approvalProofId: Id<"approvalProof">;
  approvedByStaffProfileId: Id<"staffProfile">;
  expiresAt: number;
};

export type CommandApprovalDialogProps = {
  approval: ApprovalRequirement | null;
  onApproved: (result: CommandApprovalApprovedResult) => void;
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
  onDismiss: () => void;
  open: boolean;
  requestedByStaffProfileId?: Id<"staffProfile">;
  storeId: Id<"store">;
};

function getInlineManagerResolution(
  approval: ApprovalRequirement,
): InlineManagerResolutionMode | null {
  return (
    approval.resolutionModes.find(
      (mode): mode is InlineManagerResolutionMode =>
        mode.kind === "inline_manager_proof",
    ) ?? null
  );
}

function getAsyncResolution(approval: ApprovalRequirement) {
  return (
    approval.resolutionModes.find((mode) => mode.kind === "async_request") ??
    null
  );
}

function toStaffAuthenticationResult(
  proof: CommandApprovalProofResult,
): StaffAuthenticationResult {
  return {
    staffProfile: {},
    staffProfileId: proof.approvedByStaffProfileId,
  };
}

export function CommandApprovalDialog({
  approval,
  onApproved,
  onAuthenticateForApproval,
  onDismiss,
  open,
  requestedByStaffProfileId,
  storeId,
}: CommandApprovalDialogProps) {
  const approvedProofRef = useRef<CommandApprovalProofResult | null>(null);

  if (!open || !approval) {
    return null;
  }

  const inlineResolution = getInlineManagerResolution(approval);
  const approvalMessage =
    formatReviewReason(currencyFormatter("GHS"), approval.copy.message) ??
    approval.copy.message;

  if (!inlineResolution) {
    const asyncResolution = getAsyncResolution(approval);

    return (
      <Dialog open={open} onOpenChange={onDismiss}>
        <DialogContent className="w-[min(calc(100vw-2rem),34rem)] space-y-layout-lg">
          <div className="space-y-layout-xs">
            <DialogTitle>
              {asyncResolution
                ? "Manager review required"
                : approval.copy.title}
            </DialogTitle>
            <DialogDescription>{approvalMessage}</DialogDescription>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="utility" onClick={onDismiss}>
              {approval.copy.secondaryActionLabel ?? "Got it"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onDismiss}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),34rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden overflow-x-hidden border-border bg-surface-raised p-0 shadow-overlay outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0">
        <div className="flex shrink-0 flex-col gap-layout-md border-b border-border/80 px-layout-lg pb-layout-md pt-layout-lg sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-layout-xs">
            <DialogTitle>{approval.copy.title}</DialogTitle>
            <DialogDescription>{approvalMessage}</DialogDescription>
          </div>
        </div>

        {approval.subject.label ? (
          <div className="min-w-0 shrink-0 overflow-hidden text-ellipsis border-b border-border/80 px-layout-lg py-layout-sm text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Subject</span>
            <span className="mx-layout-xs text-muted-foreground">/</span>
            {approval.subject.label}
          </div>
        ) : null}

        <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain">
          <StaffAuthenticationDialog
            open
            presentation="embedded"
            onDismiss={onDismiss}
            copy={{
              title: "Enter manager credentials",
              description:
                "Use a manager username and PIN to approve this command.",
              submitLabel:
                approval.copy.primaryActionLabel ?? "Approve and continue",
            }}
            getSuccessMessage={() => null}
            onAuthenticate={async (args) => {
              const proofResult = await onAuthenticateForApproval({
                actionKey: approval.action.key,
                pinHash: args.pinHash,
                reason: approval.reason,
                requiredRole: approval.requiredRole,
                requestedByStaffProfileId,
                storeId,
                subject: approval.subject,
                username: args.username,
              });

              if (proofResult.kind !== "ok") {
                return proofResult;
              }

              approvedProofRef.current = proofResult.data;
              return {
                kind: "ok",
                data: toStaffAuthenticationResult(proofResult.data),
              };
            }}
            onAuthenticated={(
              _result: StaffAuthenticationResult,
              _mode: StaffAuthMode,
            ) => {
              const proof = approvedProofRef.current;
              approvedProofRef.current = null;

              if (!proof) {
                onAuthenticateForApprovalMissingProof();
                return;
              }

              onApproved({
                approval,
                approvalProofId: proof.approvalProofId,
                approvedByStaffProfileId: proof.approvedByStaffProfileId,
                expiresAt: proof.expiresAt,
              });
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function onAuthenticateForApprovalMissingProof() {
  console.error("Approval proof was not available after staff authentication.");
  presentCommandToast({
    kind: "unexpected_error",
    error: {
      title: GENERIC_UNEXPECTED_ERROR_TITLE,
      message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
    },
  });
}
