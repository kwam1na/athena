import { toast } from "sonner";

import type {
  ApprovalRequiredCommandResult,
  NormalizedCommandResult,
} from "./runCommand";
import { toOperatorMessage } from "./operatorMessages";

function getApprovalGuidance(result: ApprovalRequiredCommandResult) {
  return (
    result.approval.copy.message ||
    "Manager approval is required before this action can continue."
  );
}

export function presentCommandToast<T>(
  result:
    | Exclude<NormalizedCommandResult<T>, { kind: "ok" }>
    | ApprovalRequiredCommandResult,
): void {
  if (result.kind === "user_error") {
    toast.error(toOperatorMessage(result.error.message));
    return;
  }

  if (result.kind === "approval_required") {
    toast.error(getApprovalGuidance(result));
    return;
  }

  toast.error(result.error.message);
}
