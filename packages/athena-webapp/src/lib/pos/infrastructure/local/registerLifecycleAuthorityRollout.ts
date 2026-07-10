export type RegisterLifecycleAuthorityRolloutMode =
  "disabled" | "shadow" | "canary" | "broad";

export type RegisterLifecycleAuthorityRolloutPolicy = {
  canaryTerminalIds: ReadonlySet<string>;
  mode: RegisterLifecycleAuthorityRolloutMode;
};

export type RegisterLifecycleAuthorityRolloutCohort =
  | "shadow"
  | "canary"
  | "broad";

export function resolveRegisterLifecycleAuthorityRolloutPolicy(input: {
  canaryTerminalIds?: string;
  configuredMode?: string;
  isDevelopment: boolean;
}): RegisterLifecycleAuthorityRolloutPolicy {
  // Local development defaults broad so heartbeat-disabled drawer flows remain
  // directly testable. Production defaults shadow until an operator explicitly
  // selects canary/broad; `disabled` is the rollback switch and never clears IDB.
  return {
    canaryTerminalIds: new Set(
      (input.canaryTerminalIds ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    mode: isRolloutMode(input.configuredMode)
      ? input.configuredMode
      : input.isDevelopment
        ? "broad"
        : "shadow",
  };
}

export function getRegisterLifecycleAuthorityRolloutPolicy() {
  return resolveRegisterLifecycleAuthorityRolloutPolicy({
    canaryTerminalIds: import.meta.env
      .VITE_POS_REGISTER_AUTHORITY_CANARY_TERMINAL_IDS,
    configuredMode: import.meta.env.VITE_POS_REGISTER_AUTHORITY_ROLLOUT_MODE,
    isDevelopment:
      String(import.meta.env.DEV) === "true" ||
      import.meta.env.MODE === "development",
  });
}

export function shouldSubscribeToRegisterLifecycleAuthority(
  policy: RegisterLifecycleAuthorityRolloutPolicy,
) {
  return policy.mode !== "disabled";
}

export function shouldApplyRegisterLifecycleAuthority(
  policy: RegisterLifecycleAuthorityRolloutPolicy,
  terminalId: string,
) {
  return (
    policy.mode === "broad" ||
    (policy.mode === "canary" && policy.canaryTerminalIds.has(terminalId))
  );
}

export function resolveRegisterLifecycleAuthorityRolloutCohort(
  policy: RegisterLifecycleAuthorityRolloutPolicy,
  terminalId: string,
): RegisterLifecycleAuthorityRolloutCohort {
  if (policy.mode === "broad") return "broad";
  if (
    policy.mode === "canary" &&
    policy.canaryTerminalIds.has(terminalId)
  ) {
    return "canary";
  }
  return "shadow";
}

function isRolloutMode(
  value: string | undefined,
): value is RegisterLifecycleAuthorityRolloutMode {
  return (
    value === "disabled" ||
    value === "shadow" ||
    value === "canary" ||
    value === "broad"
  );
}
