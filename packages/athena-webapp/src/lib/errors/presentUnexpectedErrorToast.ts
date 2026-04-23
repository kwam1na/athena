import { toast } from "sonner";

import { GENERIC_UNEXPECTED_ERROR_MESSAGE } from "~/shared/commandResult";

type ErrorToastOptions = NonNullable<Parameters<typeof toast.error>[1]>;

export function presentUnexpectedErrorToast(
  title: string,
  options?: Omit<ErrorToastOptions, "description">,
): void {
  toast.error(title, {
    ...options,
    description: GENERIC_UNEXPECTED_ERROR_MESSAGE,
  });
}
