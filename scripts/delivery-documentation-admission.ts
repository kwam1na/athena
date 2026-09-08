import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
  createHarnessBlocker,
  HarnessBlockedError,
  runHarnessCliBoundary,
} from "./harness-blockers";
import { collectChangedPathsForDiff } from "./delivery-diff-fingerprint";
import {
  importHarnessConfig,
  wireRepo,
} from "../.agent-skills/current/runtime/cli-api.mjs";
import {
  computeDeliverableIdentity,
  type CapturedCandidate,
  type CandidateCapture,
} from "../.agent-skills/current/runtime/kernel.mjs";

async function captureDocumentationCandidate(rootDir: string) {
  const config = await importHarnessConfig(rootDir);
  return (await wireRepo(rootDir, config)).captureCandidate();
}

type PullRequestEvent = {
  number: number;
  pull_request: {
    head: { sha: string };
    base: { ref: string; sha: string };
  };
};

type AdmissionOptions = {
  evaluateDocumentation?: (rootDir: string) => DeliveryDocumentationCheckResult;
  collectDocuments?: (
    rootDir: string,
  ) => Promise<Array<{ path: string; content: string }>>;
  captureCandidate?: (rootDir: string) => Promise<CandidateCapture>;
  repository?: string;
  pullRequest?: PullRequestEvent;
  discoverWaiver?: typeof discoverDocumentationWaiverAttestation;
  requestJson?: GitHubJsonRequest;
  loadWorkflowAttestation?: (runId: number) => Promise<unknown>;
};

export type DeliveryDocumentationAdmissionResult =
  | {
      status: "pass";
      resolution: "live";
      documents: Array<{ path: string; content: string }>;
    }
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

async function collectCurrentDocuments(rootDir: string) {
  const changed = collectChangedPathsForDiff(rootDir, "origin/main");
  const documents = [];
  for (const file of changed.filter((file) =>
    /^docs\/(reports\/.+\.html|solutions\/.+\.md)$/.test(file),
  )) {
    try {
      documents.push({
        path: file,
        content: await readFile(path.join(rootDir, file), "utf8"),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return documents;
}

async function localPullRequest(rootDir: string) {
  const read = async (args: string[]) => {
    const child = Bun.spawn(["gh", ...args], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    if (exitCode !== 0) return undefined;
    return JSON.parse(stdout);
  };
  try {
    const pr = await read([
      "pr",
      "view",
      "--json",
      "number,headRefOid,baseRefName,baseRefOid",
    ]);
    if (!pr) return undefined;
    const repo = await read(["repo", "view", "--json", "nameWithOwner"]);
    if (!repo?.nameWithOwner) return undefined;
    return {
      repository: String(repo.nameWithOwner),
      pullRequest: {
        number: pr.number,
        pull_request: {
          head: { sha: pr.headRefOid },
          base: { ref: pr.baseRefName, sha: pr.baseRefOid },
        },
      } as PullRequestEvent,
    };
  } catch {
    return undefined;
  }
}

export async function evaluateDeliveryDocumentationAdmission(
  rootDir: string,
  options: AdmissionOptions = {},
): Promise<DeliveryDocumentationAdmissionResult> {
  const documentation = (
    options.evaluateDocumentation ?? evaluateDeliveryDocumentationCheck
  )(rootDir);
  if (documentation.status === "pass") {
    const documents = await (
      options.collectDocuments ?? collectCurrentDocuments
    )(rootDir);
    return { status: "pass", resolution: "live", documents };
  }

  const capture = await (
    options.captureCandidate ?? captureDocumentationCandidate
  )(rootDir);
  if (capture.ok === false) {
    return {
      status: "fail",
      documentation,
      reason: capture.blockers.map((blocker) => blocker.summary).join("; "),
    };
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
    },
  );
  if (!waiver) {
    return {
      status: "fail",
      documentation,
      reason:
        "No trusted documentation waiver matches this candidate and its live findings.",
    };
  }
  return { status: "pass", resolution: "waived", waiver };
}

export async function discoverCurrentDocumentationWaiver(
  rootDir: string,
  candidate: CapturedCandidate,
  documentation: DeliveryDocumentationCheckResult,
  options: Pick<
    AdmissionOptions,
    | "repository"
    | "pullRequest"
    | "discoverWaiver"
    | "requestJson"
    | "loadWorkflowAttestation"
  > = {},
) {
  if (documentation.status === "pass") return undefined;
  let repository = options.repository ?? process.env.GITHUB_REPOSITORY;
  let pullRequest =
    options.pullRequest ??
    (await readPullRequestEvent(process.env.GITHUB_EVENT_PATH));
  if ((!repository || !pullRequest) && !process.env.GITHUB_ACTIONS) {
    const local = await localPullRequest(rootDir);
    repository ??= local?.repository;
    pullRequest ??= local?.pullRequest;
  }
  if (!repository || !pullRequest) return undefined;
  if (
    candidate.base.tipSha !== pullRequest.pull_request.base.sha ||
    candidate.base.ref !== `origin/${pullRequest.pull_request.base.ref}`
  ) {
    return undefined;
  }
  // Approval remains bound to the exact PR commit. Only the product's narrower
  // record-neutral projection may differ while exporting the approved delivery.
  if (candidate.headSha !== pullRequest.pull_request.head.sha) return undefined;
  if (candidate.mode !== "clean") {
    if (candidate.mode !== "staged-index") return undefined;
    try {
      const config = await importHarnessConfig(rootDir);
      const projection = {
        ...config,
        computingIdentityVersion: "validation-tree/v1",
        reviewNeutral: config.recordNeutral,
      };
      const [approved, staged] = await Promise.all(
        [candidate.headSha, candidate.treeSha].map((treeSha) =>
          computeDeliverableIdentity({ rootDir, treeSha, config: projection }),
        ),
      );
      if (approved !== staged) return undefined;
    } catch {
      // Unreadable policy or Git objects cannot prove a neutral-only change.
      return undefined;
    }
  }

  return (options.discoverWaiver ?? discoverDocumentationWaiverAttestation)({
    expected: {
      repository,
      prNumber: pullRequest.number,
      headSha: pullRequest.pull_request.head.sha,
      deliverableTreeSha: candidate.deliverable.digest,
      identityVersion: candidate.deliverable.identity,
      baseRef: candidate.base.ref,
      baseTipSha: candidate.base.tipSha,
      diffBaseSha: candidate.base.mergeBaseSha,
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

export function assertDeliveryDocumentationAdmission(
  result: DeliveryDocumentationAdmissionResult,
): asserts result is Extract<
  DeliveryDocumentationAdmissionResult,
  { status: "pass" }
> {
  if (result.status === "pass") return;
  throw new HarnessBlockedError(
    [
      createHarnessBlocker({
        code: "documentation_admission_failed",
        source: { kind: "command", id: "delivery:documentation-admission" },
        summary: result.reason,
        details: result.documentation.findings
          .map((finding) => `${finding.label}:\n${finding.message}`)
          .join("\n\n"),
        remediations: [
          {
            id: "repair-delivery-documentation",
            kind: "manual_action",
            summary:
              "Repair the current report and solution findings, or obtain a trusted human approval for this exact candidate and finding scope.",
          },
        ],
      }),
    ],
    "Delivery documentation admission failed.",
  );
}

if (import.meta.main) {
  process.exitCode = await runHarnessCliBoundary({
    source: { kind: "command", id: "delivery:documentation-admission" },
    reproduce: [
      "bun",
      "run",
      "delivery:documentation-admission",
      ...process.argv.slice(2),
    ],
    run: async () => {
      const result = await evaluateDeliveryDocumentationAdmission(
        process.cwd(),
      );
      if (process.argv.includes("--json")) console.log(JSON.stringify(result));
      assertDeliveryDocumentationAdmission(result);
      if (process.argv.includes("--json")) return;
      if (result.resolution === "waived") {
        console.log(
          `Delivery documentation waived by ${result.waiver.approvedBy} for this candidate (${result.waiver.attestationUrl}).`,
        );
      } else {
        console.log(
          "Delivery documentation admission passed with live artifacts.",
        );
      }
    },
  });
}
