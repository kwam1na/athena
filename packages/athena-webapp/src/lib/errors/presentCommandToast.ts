import { toast } from "sonner";

import type { NormalizedCommandResult } from "./runCommand";
import { toOperatorMessage } from "./operatorMessages";

export function presentCommandToast<T>(
  result: Exclude<NormalizedCommandResult<T>, { kind: "ok" }>,
): void {
  if (result.kind === "user_error") {
    toast.error(toOperatorMessage(result.error.message));
    return;
  }

  toast.error(result.error.message);
}
