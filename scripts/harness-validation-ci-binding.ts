import {
  runHealthProcess,
  type HealthDigest,
} from "./harness-validation-health";

export type HealthRunIdentity = Pick<
  HealthDigest,
  "repository" | "runId" | "runAttempt" | "headSha"
>;

export type HostedValidationBinding = HealthRunIdentity & { baseSha: string };
import { HEALTH_WORKFLOW_PATH } from "./harness-validation-local-authority.ts";
export { HEALTH_WORKFLOW_PATH } from "./harness-validation-local-authority.ts";
export type JsonRequest = (
  endpoint: string,
  signal?: AbortSignal,
) => Promise<unknown>;
export const jsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const shaValue = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export const requestCiJson: JsonRequest = async (endpoint, signal) => {
  const result = await runHealthProcess(
    ["gh", "api", endpoint],
    signal ?? AbortSignal.timeout(30_000),
  );
  if (result.exitCode !== 0)
    throw new Error("GitHub validation metadata unavailable");
  return JSON.parse(result.stdout.toString("utf8")) as unknown;
};

/** Authenticate all coordinates against GitHub, including the PR base. A local
 * uploaded plan, branch name or manually supplied SHA is not accepted instead. */
export async function resolveHostedValidationBinding(
  command: "health" | "qualify",
  env: NodeJS.ProcessEnv,
  request: JsonRequest = requestCiJson,
) {
  const repository = env.GITHUB_REPOSITORY ?? "";
  const candidateSha = env.VALIDATION_CANDIDATE_SHA ?? env.GITHUB_SHA;
  const runId = Number(env.GITHUB_RUN_ID),
    runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (command === "health" && runAttempt !== 1)
    throw new Error(
      "Full-health producer refuses GitHub reruns; dispatch a new full-health run",
    );
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !Number.isSafeInteger(runAttempt) ||
    runAttempt <= 0 ||
    !shaValue(candidateSha)
  )
    throw new Error("Invalid hosted validation coordinates");
  const base = `/repos/${repository}`;
  const workflowPath =
    command === "health"
      ? HEALTH_WORKFLOW_PATH
      : ".github/workflows/athena-pr-tests.yml";
  const metadata = await request(`${base}/actions/runs/${runId}`);
  if (
    !jsonRecord(metadata) ||
    metadata.id !== runId ||
    metadata.run_attempt !== runAttempt ||
    metadata.head_sha !== candidateSha ||
    metadata.event !== env.GITHUB_EVENT_NAME ||
    !jsonRecord(metadata.repository) ||
    metadata.repository.full_name !== repository ||
    !jsonRecord(metadata.head_repository) ||
    metadata.head_repository.full_name !== repository ||
    !Number.isSafeInteger(metadata.workflow_id) ||
    Number(metadata.workflow_id) <= 0 ||
    metadata.path !== workflowPath
  )
    throw new Error(
      "Authenticated workflow run does not match validation coordinates",
    );
  const workflow = await request(
    `${base}/actions/workflows/${workflowPath.slice(workflowPath.lastIndexOf("/") + 1)}`,
  );
  if (
    !jsonRecord(workflow) ||
    workflow.id !== metadata.workflow_id ||
    workflow.path !== workflowPath
  )
    throw new Error(
      "Authenticated workflow identity does not match expected workflow",
    );
  const repo = await request(base);
  if (
    !jsonRecord(repo) ||
    typeof repo.default_branch !== "string" ||
    !repo.default_branch
  )
    throw new Error("Default branch unavailable");
  const defaultBranch = repo.default_branch;
  if (
    command === "health" &&
    (metadata.head_branch !== defaultBranch ||
      env.GITHUB_REF !== `refs/heads/${defaultBranch}` ||
      !["schedule", "workflow_dispatch"].includes(String(metadata.event)))
  )
    throw new Error(
      "Full-health producer must run on the protected default branch",
    );
  const main = await request(
    `${base}/commits/${encodeURIComponent(defaultBranch)}`,
  );
  if (!jsonRecord(main) || !shaValue(main.sha))
    throw new Error("Protected default branch identity unavailable");
  let baseSha = main.sha;
  if (metadata.event === "pull_request") {
    if (!/^[1-9]\d*$/.test(env.VALIDATION_PR_NUMBER ?? ""))
      throw new Error("Pull request identity required");
    const pull = await request(`${base}/pulls/${env.VALIDATION_PR_NUMBER}`);
    if (
      !jsonRecord(pull) ||
      !jsonRecord(pull.base) ||
      !shaValue(pull.base.sha) ||
      pull.base.ref !== defaultBranch ||
      !jsonRecord(pull.base.repo) ||
      pull.base.repo.full_name !== repository ||
      !jsonRecord(pull.head) ||
      !jsonRecord(pull.head.repo) ||
      pull.head.repo.full_name !== repository ||
      pull.head.sha !== candidateSha
    )
      throw new Error("Pull request base or candidate changed");
    baseSha = pull.base.sha;
  } else if (command === "qualify" && metadata.event !== "workflow_dispatch")
    throw new Error("Unsupported qualification event");
  if (
    env.VALIDATION_GUARD_BASE_SHA !== undefined &&
    env.VALIDATION_GUARD_BASE_SHA !== baseSha
  )
    throw new Error(
      "Pinned base moved after independent guard; revalidate the current base",
    );
  return {
    repository,
    runId,
    runAttempt,
    headSha: candidateSha,
    baseSha,
    defaultBranch,
    defaultMainSha: main.sha,
    workflowId: Number(metadata.workflow_id),
  };
}
