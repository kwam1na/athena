import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  openSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import {
  discoverDocumentationWaiverAttestation,
  DOCUMENTATION_WAIVER_ARTIFACT_NAME,
  type DiscoveredDocumentationWaiver,
  type GitHubJsonRequest,
} from "./documentation-waiver-attestation";
import {
  evaluateDeliveryDocumentationCheck,
  type DeliveryDocumentationCheckResult,
} from "./delivery-documentation-check";
import {
  captureStableHarnessCandidate,
  type HarnessCandidate,
  type HarnessCandidateCapture,
} from "./harness-candidate";
import {
  classifyCurrentHarnessExecutionContext,
  type HarnessExecutionContext,
} from "./harness-execution-context";
import {
  ATHENA_PR_VALIDATION_GATE_ID,
  HARNESS_GATE_REGISTRY,
} from "./harness-gate-registry";
import { computeDeliverableTreeIdentity } from "./harness-review-identity";

type PullRequestEvent = {
  number: number;
  pull_request: {
    head: { sha: string };
    base: { ref: string; sha: string };
  };
};

type AdmissionOptions = {
  evaluateDocumentation?: (rootDir: string) => DeliveryDocumentationCheckResult;
  captureCandidate?: (rootDir: string) => Promise<HarnessCandidateCapture>;
  repository?: string;
  pullRequest?: PullRequestEvent;
  discoverWaiver?: typeof discoverDocumentationWaiverAttestation;
  requestJson?: GitHubJsonRequest;
  loadWorkflowAttestation?: (runId: number) => Promise<unknown>;
  computeHeadDeliverableIdentity?: typeof computeDeliverableTreeIdentity;
  computeHeadDiffBaseSha?: (
    rootDir: string,
    headSha: string,
  ) => Promise<string>;
  classifyContext?: () => HarnessExecutionContext;
  hasControllingTerminal?: () => boolean;
  promptForWaiver?: (
    documentation: Extract<
      DeliveryDocumentationCheckResult,
      { status: "fail" }
    >,
  ) => Promise<boolean>;
};

export type DeliveryDocumentationAdmissionResult =
  | { status: "pass"; resolution: "live" }
  | { status: "pass"; resolution: "invocation-waived" }
  | {
      status: "pass";
      resolution: "waived";
      waiver: DiscoveredDocumentationWaiver;
    }
  | {
      status: "fail";
      documentation: DeliveryDocumentationCheckResult;
      reason: string;
    };

export const WAIVABLE_DOCUMENTATION_FINDING_POLICIES = [
  "compound-solution",
  "landed-change-report",
] as const satisfies readonly DeliveryDocumentationCheckResult["findings"][number]["policy"][];

async function readPullRequestEvent(eventPath: string | undefined) {
  if (!eventPath) return undefined;
  try {
    const value = JSON.parse(
      await readFile(eventPath, "utf8"),
    ) as PullRequestEvent;
    return value?.pull_request ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function requestGitHubJson(path: string): Promise<unknown> {
  const child = Bun.spawn(["gh", "api", path], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...processEnv(),
      ...(process.env.GITHUB_TOKEN && !process.env.GH_TOKEN
        ? { GH_TOKEN: process.env.GITHUB_TOKEN }
        : {}),
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `gh api ${path} failed`);
  }
  return JSON.parse(stdout);
}

async function downloadGitHubArtifact(repository: string, artifactId: number) {
  const child = Bun.spawn(
    ["gh", "api", `/repos/${repository}/actions/artifacts/${artifactId}/zip`],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...processEnv(),
        ...(process.env.GITHUB_TOKEN && !process.env.GH_TOKEN
          ? { GH_TOKEN: process.env.GITHUB_TOKEN }
          : {}),
      },
    },
  );
  const [bytes, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || "GitHub waiver artifact download failed.");
  }
  return bytes;
}

export async function loadGitHubWorkflowAttestation(
  repository: string,
  runId: number,
  requestJson: GitHubJsonRequest = requestGitHubJson,
) {
  const response = (await requestJson(
    `/repos/${repository}/actions/runs/${runId}/artifacts`,
  )) as {
    artifacts?: Array<{ id?: number; name?: string; expired?: boolean }>;
  };
  const artifact = response.artifacts?.find(
    (entry) =>
      entry.name === DOCUMENTATION_WAIVER_ARTIFACT_NAME &&
      entry.expired !== true &&
      Number.isInteger(entry.id),
  );
  if (!artifact?.id) return undefined;

  const temporaryDir = await mkdtemp(
    path.join(tmpdir(), "athena-documentation-waiver-"),
  );
  const archivePath = path.join(temporaryDir, "attestation.zip");
  try {
    await Bun.write(
      archivePath,
      await downloadGitHubArtifact(repository, artifact.id),
    );
    const child = Bun.spawn(
      ["unzip", "-p", archivePath, "documentation-waiver-attestation.json"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    return exitCode === 0 ? JSON.parse(stdout) : undefined;
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

function processEnv() {
  return process.env as Record<string, string | undefined>;
}

export async function evaluateDeliveryDocumentationAdmission(
  rootDir: string,
  options: AdmissionOptions = {},
): Promise<DeliveryDocumentationAdmissionResult> {
  const documentation = (
    options.evaluateDocumentation ?? evaluateDeliveryDocumentationCheck
  )(rootDir);
  if (documentation.status === "pass") {
    return { status: "pass", resolution: "live" };
  }

  const capture = await (
    options.captureCandidate ?? captureStableHarnessCandidate
  )(rootDir);
  if (capture.ok === false) {
    return { status: "fail", documentation, reason: capture.reason };
  }
  const waiver = await discoverCurrentDocumentationWaiver(
    rootDir,
    capture.candidate,
    documentation,
    {
      repository: options.repository,
      pullRequest: options.pullRequest,
      discoverWaiver: options.discoverWaiver,
      requestJson: options.requestJson,
      loadWorkflowAttestation: options.loadWorkflowAttestation,
      computeHeadDeliverableIdentity: options.computeHeadDeliverableIdentity,
      computeHeadDiffBaseSha: options.computeHeadDiffBaseSha,
    },
  );
  if (!waiver) {
    const context = classifyDocumentationAdmissionContext(options);
    const obligation =
      HARNESS_GATE_REGISTRY.obligations["documentation.current"];
    const findingsAreWaivable = documentation.findings.every((finding) =>
      WAIVABLE_DOCUMENTATION_FINDING_POLICIES.includes(finding.policy),
    );
    if (
      context.kind === "human" &&
      obligation.humanWaiverAllowed &&
      findingsAreWaivable &&
      (await (options.promptForWaiver ?? promptForDocumentationWaiver)(
        documentation,
      ))
    ) {
      const promptCapture = await (
        options.captureCandidate ?? captureStableHarnessCandidate
      )(rootDir);
      if (
        !promptCapture.ok ||
        !sameCandidate(capture.candidate, promptCapture.candidate)
      ) {
        return {
          status: "fail",
          documentation,
          reason: "The candidate changed while the waiver prompt was open.",
        };
      }
      return { status: "pass", resolution: "invocation-waived" };
    }
    return {
      status: "fail",
      documentation,
      reason:
        "No trusted documentation waiver matches this candidate and its live findings.",
    };
  }
  return { status: "pass", resolution: "waived", waiver };
}

function classifyDocumentationAdmissionContext(options: AdmissionOptions) {
  const context = (
    options.classifyContext ??
    (() =>
      classifyCurrentHarnessExecutionContext(
        ATHENA_PR_VALIDATION_GATE_ID,
        "documentation.current",
      ))
  )();
  if (
    context.kind === "unknown" &&
    context.reason === "noninteractive_unrecognized" &&
    (options.hasControllingTerminal ?? hasControllingTerminal)()
  ) {
    return { kind: "human", interactive: true } as const;
  }
  return context;
}

function hasControllingTerminal() {
  try {
    const descriptor = openSync("/dev/tty", "r+");
    closeSync(descriptor);
    return true;
  } catch {
    return false;
  }
}

async function promptForDocumentationWaiver(
  documentation: Extract<DeliveryDocumentationCheckResult, { status: "fail" }>,
) {
  const input = createReadStream("/dev/tty");
  const output = createWriteStream("/dev/tty");
  const terminal = createInterface({ input, output });
  try {
    output.write("This candidate is blocked by documentation.current:\n");
    for (const finding of documentation.findings) {
      output.write(`- ${finding.label}: ${finding.message}\n`);
    }
    const answer = await terminal.question(
      "Waive documentation.current for this pre-push invocation? Type 'yes' to continue: ",
    );
    return answer.trim().toLowerCase() === "yes";
  } catch {
    return false;
  } finally {
    terminal.close();
    input.destroy();
    output.end();
  }
}

function sameCandidate(left: HarnessCandidate, right: HarnessCandidate) {
  return (
    left.treeSha === right.treeSha &&
    left.baseRef === right.baseRef &&
    left.baseTipSha === right.baseTipSha &&
    left.diffBaseSha === right.diffBaseSha &&
    left.headSha === right.headSha &&
    left.mode === right.mode &&
    left.status === right.status &&
    JSON.stringify(left.untrackedFiles) === JSON.stringify(right.untrackedFiles)
  );
}

export async function discoverCurrentDocumentationWaiver(
  rootDir: string,
  candidate: HarnessCandidate,
  documentation: DeliveryDocumentationCheckResult,
  options: Pick<
    AdmissionOptions,
    | "repository"
    | "pullRequest"
    | "discoverWaiver"
    | "requestJson"
    | "loadWorkflowAttestation"
    | "computeHeadDeliverableIdentity"
    | "computeHeadDiffBaseSha"
  > = {},
) {
  if (documentation.status === "pass") return undefined;
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY;
  const pullRequest =
    options.pullRequest ??
    (await readPullRequestEvent(process.env.GITHUB_EVENT_PATH));
  if (!repository || !pullRequest) return undefined;
  if (
    candidate.baseTipSha !== pullRequest.pull_request.base.sha ||
    candidate.baseRef !== `origin/${pullRequest.pull_request.base.ref}`
  ) {
    return undefined;
  }
  const headIdentity = await (
    options.computeHeadDeliverableIdentity ?? computeDeliverableTreeIdentity
  )(rootDir, pullRequest.pull_request.head.sha);
  const headDiffBaseSha = await (
    options.computeHeadDiffBaseSha ?? computeHeadDiffBaseSha
  )(rootDir, pullRequest.pull_request.head.sha);

  return (options.discoverWaiver ?? discoverDocumentationWaiverAttestation)({
    expected: {
      repository,
      prNumber: pullRequest.number,
      headSha: pullRequest.pull_request.head.sha,
      deliverableTreeSha: headIdentity.deliverableTreeSha,
      identityVersion: headIdentity.identityVersion,
      baseRef: candidate.baseRef,
      baseTipSha: candidate.baseTipSha,
      diffBaseSha: headDiffBaseSha,
    },
    findingCodes: documentation.findings.map((finding) => finding.policy),
    requestJson: options.requestJson ?? requestGitHubJson,
    loadWorkflowAttestation:
      options.loadWorkflowAttestation ??
      ((runId) =>
        loadGitHubWorkflowAttestation(
          repository,
          runId,
          options.requestJson ?? requestGitHubJson,
        )),
  });
}

async function computeHeadDiffBaseSha(rootDir: string, headSha: string) {
  const child = Bun.spawn(["git", "merge-base", "origin/main", headSha], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0 || !stdout.trim()) {
    throw new Error(
      stderr.trim() || "Unable to compute the pull-request head merge base.",
    );
  }
  return stdout.trim();
}

export function assertDeliveryDocumentationAdmission(
  result: DeliveryDocumentationAdmissionResult,
): asserts result is Extract<
  DeliveryDocumentationAdmissionResult,
  { status: "pass" }
> {
  if (result.status === "pass") return;
  throw new Error(
    `Delivery documentation admission failed: ${result.reason}\n\n${result.documentation.findings
      .map((finding) => `${finding.label}:\n${finding.message}`)
      .join("\n\n")}`,
  );
}

if (import.meta.main) {
  evaluateDeliveryDocumentationAdmission(process.cwd())
    .then((result) => {
      assertDeliveryDocumentationAdmission(result);
      if (result.resolution === "waived") {
        console.log(
          `Delivery documentation waived by ${result.waiver.approvedBy} for this candidate (${result.waiver.attestationUrl}).`,
        );
      } else if (result.resolution === "invocation-waived") {
        console.log(
          "Delivery documentation waived by an interactive human for this invocation.",
        );
      } else {
        console.log(
          "Delivery documentation admission passed with live artifacts.",
        );
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
