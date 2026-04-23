import { toast } from "sonner";

import type { NormalizedCommandResult } from "./runCommand";

export function presentCommandToast<T>(
  result: Exclude<NormalizedCommandResult<T>, { kind: "ok" }>,
): void {
  if (result.kind === "user_error") {
    toast.error(result.error.message);
    return;
  }

  toast.error(result.error.message);
}
