export const SHARED_DEMO_ACTION_DENIED_CODE =
  "shared_demo_action_denied" as const;
export const SHARED_DEMO_ACTION_DENIED_MESSAGE =
  "This action isn't allowed in the demo.";

export type SharedDemoActionDeniedData = {
  code: typeof SHARED_DEMO_ACTION_DENIED_CODE;
  message: typeof SHARED_DEMO_ACTION_DENIED_MESSAGE;
};

export function isSharedDemoActionDeniedData(
  value: unknown,
): value is SharedDemoActionDeniedData {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return (
    candidate.code === SHARED_DEMO_ACTION_DENIED_CODE &&
    candidate.message === SHARED_DEMO_ACTION_DENIED_MESSAGE
  );
}
