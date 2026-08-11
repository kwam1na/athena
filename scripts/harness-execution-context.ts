export const RECOGNIZED_AGENT_SIGNALS = [
  "CODEX_THREAD_ID",
  "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  "CODEX_CI",
  "CLAUDE_CODE",
] as const;

export type HarnessExecutionContext =
  | {
      kind: "ci";
      policyId: "athena-pr-tests";
      runner: "github-actions";
      workflow: "Athena PR Tests";
      job: "harness-validation";
      event: "pull_request";
    }
  | {
      kind: "agent";
      signal: (typeof RECOGNIZED_AGENT_SIGNALS)[number];
    }
  | { kind: "human"; interactive: true }
  | {
      kind: "unknown";
      reason: "unauthorized_automation" | "noninteractive_unrecognized";
    };

export type HarnessCiDelegationPolicy = {
  id: string;
  runner: "github-actions";
  workflow: string;
  job: string;
  event: string;
  gateId: string;
  obligationId: string;
};

export const ATHENA_PR_TESTS_CI_POLICY = {
  id: "athena-pr-tests",
  runner: "github-actions",
  workflow: "Athena PR Tests",
  job: "harness-validation",
  event: "pull_request",
  gateId: "athena.pr-validation",
  obligationId: "review.green",
} as const satisfies HarnessCiDelegationPolicy;

type ClassifyOptions = {
  gateId: string;
  obligationId: string;
  env: Readonly<Record<string, string | undefined>>;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  ciPolicies?: readonly HarnessCiDelegationPolicy[];
};

function isPresent(value: string | undefined) {
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
}

export function classifyHarnessExecutionContext({
  gateId,
  obligationId,
  env,
  stdinIsTTY,
  stdoutIsTTY,
  ciPolicies = [ATHENA_PR_TESTS_CI_POLICY],
}: ClassifyOptions): HarnessExecutionContext {
  const githubAutomationClaim = env.GITHUB_ACTIONS === "true";
  const declaredPolicyId = env.ATHENA_HARNESS_CI_POLICY;

  if (githubAutomationClaim || declaredPolicyId) {
    const matchingPolicy = ciPolicies.find(
      (policy) =>
        policy.id === declaredPolicyId &&
        policy.runner === "github-actions" &&
        policy.workflow === env.GITHUB_WORKFLOW &&
        policy.job === env.GITHUB_JOB &&
        policy.event === env.GITHUB_EVENT_NAME &&
        policy.gateId === gateId &&
        policy.obligationId === obligationId,
    );

    if (githubAutomationClaim && matchingPolicy) {
      return {
        kind: "ci",
        policyId: "athena-pr-tests",
        runner: "github-actions",
        workflow: "Athena PR Tests",
        job: "harness-validation",
        event: "pull_request",
      };
    }

    return { kind: "unknown", reason: "unauthorized_automation" };
  }

  for (const signal of RECOGNIZED_AGENT_SIGNALS) {
    if (isPresent(env[signal])) return { kind: "agent", signal };
  }

  if (stdinIsTTY && stdoutIsTTY) return { kind: "human", interactive: true };

  return { kind: "unknown", reason: "noninteractive_unrecognized" };
}

export function classifyCurrentHarnessExecutionContext(
  gateId: string,
  obligationId: string,
  ciPolicies?: readonly HarnessCiDelegationPolicy[],
) {
  return classifyHarnessExecutionContext({
    gateId,
    obligationId,
    env: process.env,
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    ciPolicies,
  });
}
