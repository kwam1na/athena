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

/**
 * A demo session that ran past its admission window.
 *
 * This is NOT `shared_demo_action_denied`. That one means "the demo does not
 * do this" and is terminal — retrying changes nothing. This one means "your
 * session ended", which the client can resolve on its own by taking a fresh
 * admission. The two must stay distinguishable: the client renews on this and
 * only this, and renewing on a policy denial would spin forever.
 *
 * It travels as `ConvexError` data rather than an error message because Convex
 * scrubs the message of a plain `Error` outside dev. Matching on message text
 * therefore works on a developer's machine and silently stops working in
 * production, which is precisely the trap this code exists to close.
 */
export const SHARED_DEMO_SESSION_EXPIRED_CODE =
  "shared_demo_session_expired" as const;
export const SHARED_DEMO_SESSION_EXPIRED_MESSAGE =
  "The demo session has expired. Open the demo again." as const;

export type SharedDemoSessionExpiredData = {
  code: typeof SHARED_DEMO_SESSION_EXPIRED_CODE;
  // Optional because the guard below verifies only the code. Promising a
  // field the predicate never checks hands the compiler a guarantee that does
  // not hold, and a consumer reading it would get `undefined` at runtime.
  message?: typeof SHARED_DEMO_SESSION_EXPIRED_MESSAGE;
};

export function isSharedDemoSessionExpiredData(
  value: unknown,
): value is SharedDemoSessionExpiredData {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return candidate.code === SHARED_DEMO_SESSION_EXPIRED_CODE;
}
