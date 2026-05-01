import { useRef } from "react";

import {
  StaffAuthenticationDialog,
  type StaffAuthMode,
  type StaffAuthenticationResult,
} from "@/components/staff-auth/StaffAuthenticationDialog";
import { Button } from "@/components/ui/button";
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

  if (!inlineResolution) {
    const asyncResolution = getAsyncResolution(approval);

    return (
      <Dialog open={open} onOpenChange={onDismiss}>
        <DialogContent className="w-[min(calc(100vw-2rem),34rem)] space-y-layout-lg">
          <div className="space-y-layout-xs">
            <DialogTitle>
              {asyncResolution ? "Manager review required" : approval.copy.title}
            </DialogTitle>
            <DialogDescription>{approval.copy.message}</DialogDescription>
          </div>

          {asyncResolution?.approvalRequestId ? (
            <p className="rounded-md border border-border bg-surface p-layout-sm text-sm text-muted-foreground">
              Approval request {asyncResolution.approvalRequestId} is pending in
              the review queue.
            </p>
          ) : null}

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
      <DialogContent className="w-[min(calc(100vw-2rem),38rem)] gap-0 overflow-hidden p-0">
        <div className="flex flex-col gap-layout-md border-b border-border bg-surface-raised p-layout-lg sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-layout-xs">
            <DialogTitle>{approval.copy.title}</DialogTitle>
            <DialogDescription>{approval.copy.message}</DialogDescription>
          </div>
          <Button
            type="button"
            variant="utility"
            size="sm"
            onClick={onDismiss}
          >
            Cancel approval
          </Button>
        </div>

        {approval.subject.label ? (
          <div className="border-b border-border px-layout-lg py-layout-sm text-sm text-muted-foreground">
            Subject: {approval.subject.label}
          </div>
        ) : null}

        <StaffAuthenticationDialog
          open
          presentation="inline"
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
