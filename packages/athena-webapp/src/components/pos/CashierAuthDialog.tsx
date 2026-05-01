import { useMutation } from "convex/react";

import {
  StaffAuthenticationDialog,
  type StaffAuthenticationResult,
  type StaffAuthMode,
} from "@/components/staff-auth/StaffAuthenticationDialog";
import { runCommand } from "@/lib/errors/runCommand";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { userError } from "~/shared/commandResult";
import type { RegisterWorkflowMode } from "~/src/lib/pos/presentation/register/registerUiState";

interface CashierAuthDialogProps {
  onAuthenticated: (staffProfileId: Id<"staffProfile">) => void;
  onDismiss: () => void;
  open: boolean;
  presentation?: "dialog" | "inline";
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  workflowMode?: RegisterWorkflowMode;
}

function getStaffDisplayName(result: StaffAuthenticationResult) {
  return (
    result.staffProfile.fullName ||
    [result.staffProfile.firstName, result.staffProfile.lastName]
      .filter(Boolean)
      .join(" ")
  );
}

export function CashierAuthDialog({
  onAuthenticated,
  onDismiss,
  open,
  presentation = "dialog",
  storeId,
  terminalId,
  workflowMode = "pos",
}: CashierAuthDialogProps) {
  const authenticateStaffCredentialForTerminal = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForTerminal,
  );
  const expireAllSessionsForStaff = useMutation(
    api.inventory.posSessions.expireAllSessionsForStaff,
  );
  const isExpenseWorkflow = workflowMode === "expense";

  async function authenticateStaff(args: {
    mode: StaffAuthMode;
    pinHash: string;
    username: string;
  }) {
    const authenticationResult = await runCommand(() =>
      authenticateStaffCredentialForTerminal({
        allowedRoles: ["cashier", "manager"],
        allowActiveSessionsOnOtherTerminals: args.mode === "recover",
        pinHash: args.pinHash,
        storeId,
        terminalId,
        username: args.username,
      }),
    );

    if (authenticationResult.kind !== "ok") {
      return authenticationResult;
    }

    if (args.mode === "authenticate") {
      return authenticationResult;
    }

    const expireResult = await expireAllSessionsForStaff({
      staffProfileId: authenticationResult.data.staffProfileId,
      terminalId,
    });

    if (!expireResult.success) {
      return userError({
        code: "precondition_failed",
        message: isExpenseWorkflow
          ? "Other session sign-outs not completed. Try again."
          : "Other register sign-outs not completed. Try again.",
      });
    }

    return authenticationResult;
  }

  const primaryCopy = isExpenseWorkflow
    ? {
        title: "Sign in required",
        description: "Authenticate to record expenses.",
      }
    : {
        title: "Sign in required",
        description: "Authenticate to add items.",
      };
  const recoveryLabel = isExpenseWorkflow
    ? "Sign out from other sessions"
    : "Sign out from other registers";

  return (
    <StaffAuthenticationDialog
      open={open}
      presentation={presentation}
      onDismiss={onDismiss}
      copy={{
        title: primaryCopy.title,
        description: primaryCopy.description,
        submitLabel: "Sign in",
      }}
      alternateCopy={{
        title: recoveryLabel,
        description: isExpenseWorkflow
          ? "Confirm your staff credentials to end other active expense sessions."
          : "Confirm your staff credentials to end other active register sessions.",
        submitLabel: isExpenseWorkflow
          ? "Sign out from other sessions"
          : "Sign out from all registers",
      }}
      alternateTriggerLabel={recoveryLabel}
      returnTriggerLabel="Return to sign in"
      onAuthenticate={authenticateStaff}
      getSuccessMessage={(result, mode) => {
        if (mode === "recover") {
          return isExpenseWorkflow
            ? "Signed out from other sessions."
            : "Signed out from all registers.";
        }

        const staffDisplayName = getStaffDisplayName(result);
        return staffDisplayName
          ? `Signed in as ${staffDisplayName}.`
          : "Signed in.";
      }}
      onAuthenticated={(result) => {
        onAuthenticated(result.staffProfileId);
      }}
    />
  );
}
