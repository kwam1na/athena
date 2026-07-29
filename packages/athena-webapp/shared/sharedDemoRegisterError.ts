export const SHARED_DEMO_REGISTER_UNAVAILABLE_CODE =
  "shared_demo_register_unavailable" as const;
export const SHARED_DEMO_REGISTER_UNAVAILABLE_MESSAGE =
  "The demo register is unavailable on this browser.";

export type SharedDemoRegisterUnavailableData = {
  code: typeof SHARED_DEMO_REGISTER_UNAVAILABLE_CODE;
  message: typeof SHARED_DEMO_REGISTER_UNAVAILABLE_MESSAGE;
};

export function isSharedDemoRegisterUnavailableError(error: unknown) {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  const data = (error as { data: unknown }).data;
  if (!data || typeof data !== "object") return false;
  return (
    (data as Record<string, unknown>).code ===
    SHARED_DEMO_REGISTER_UNAVAILABLE_CODE
  );
}
