import {
  evaluateDeliveryDocumentationCheck,
  type DeliveryDocumentationFinding,
} from "./delivery-documentation-check";
import type { DocumentationWaiverFindingCode } from "./documentation-waiver-attestation";
import type { HarnessCandidate } from "./harness-candidate";
import { evaluatePrAthenaPreparationReceipt } from "./pr-athena-prepare";

type WaiverCandidate = Pick<
  HarnessCandidate,
  | "headSha"
  | "deliverableTreeSha"
  | "identityVersion"
  | "baseRef"
  | "baseTipSha"
  | "diffBaseSha"
  | "mode"
>;

type PullRequestIdentity = {
  number: number;
  headSha: string;
  baseRef: string;
  baseSha: string;
};

export type DocumentationWaiverWorkflowInputs = {
  repository: string;
  pr_number: string;
  head_sha: string;
  base_ref: string;
  base_sha: string;
  diff_base_sha: string;
  deliverable_tree_sha: string;
  identity_version: string;
  waived_finding_codes: string;
  reason: string;
};

export function buildDocumentationWaiverRequest(input: {
  candidate: WaiverCandidate;
  repository: string;
  pullRequest: PullRequestIdentity;
  findingCodes: readonly DocumentationWaiverFindingCode[];
  reason: string;
}): DocumentationWaiverWorkflowInputs {
  if (input.candidate.mode !== "clean") {
    throw new Error(
      "A CI-visible waiver requires a committed clean candidate; commit and push the prepared tree first.",
    );
  }
  if (
    input.candidate.headSha !== input.pullRequest.headSha ||
    input.candidate.baseTipSha !== input.pullRequest.baseSha ||
    input.candidate.baseRef !== `origin/${input.pullRequest.baseRef}`
  ) {
    throw new Error(
      "The prepared candidate does not match the pull request head and base.",
    );
  }
  if (!input.repository || !input.reason.trim()) {
    throw new Error("Repository and waiver reason are required.");
  }
  if (input.findingCodes.length === 0) {
    throw new Error("The current candidate has no documentation findings to waive.");
  }

  return {
    repository: input.repository,
    pr_number: String(input.pullRequest.number),
    head_sha: input.candidate.headSha,
    base_ref: input.candidate.baseRef,
    base_sha: input.candidate.baseTipSha,
    diff_base_sha: input.candidate.diffBaseSha,
    deliverable_tree_sha: input.candidate.deliverableTreeSha,
    identity_version: input.candidate.identityVersion,
    waived_finding_codes: JSON.stringify([...new Set(input.findingCodes)].sort()),
    reason: input.reason.trim(),
  };
}

async function runGh(args: string[]) {
  const child = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `gh ${args.join(" ")} failed`);
  }
  return stdout.trim();
}

async function ghJson(args: string[]) {
  return JSON.parse(await runGh(args)) as Record<string, unknown>;
}

export function parseDocumentationWaiverArgs(argv: string[]) {
  let pr: string | undefined;
  let reason = "";
  const readValue = (flag: string, index: number) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--pr") pr = readValue("--pr", index++);
    else if (argv[index] === "--reason") {
      reason = readValue("--reason", index++);
    }
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!reason.trim()) throw new Error("Pass a non-empty --reason.");
  return { pr, reason };
}

function documentationFindingCodes(findings: DeliveryDocumentationFinding[]) {
  return findings.map((finding) => finding.policy);
}

async function main() {
  const args = parseDocumentationWaiverArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const prepared = await evaluatePrAthenaPreparationReceipt(rootDir);
  if (prepared.prepared === false) {
    throw new Error(`${prepared.reason}. Remediation: ${prepared.remediation}`);
  }
  const documentation = evaluateDeliveryDocumentationCheck(rootDir);
  if (documentation.status === "pass") {
    throw new Error("Delivery documentation is already current; no waiver is needed.");
  }

  const repository = await ghJson(["repo", "view", "--json", "nameWithOwner"]);
  const prArgs = [
    "pr",
    "view",
    ...(args.pr ? [args.pr] : []),
    "--json",
    "number,headRefOid,baseRefName,baseRefOid",
  ];
  const pullRequest = await ghJson(prArgs);
  const inputs = buildDocumentationWaiverRequest({
    candidate: prepared.candidate,
    repository: String(repository.nameWithOwner ?? ""),
    pullRequest: {
      number: Number(pullRequest.number),
      headSha: String(pullRequest.headRefOid ?? ""),
      baseRef: String(pullRequest.baseRefName ?? ""),
      baseSha: String(pullRequest.baseRefOid ?? ""),
    },
    findingCodes: documentationFindingCodes(documentation.findings),
    reason: args.reason,
  });

  const fields = Object.entries(inputs).flatMap(([key, value]) => [
    "-f",
    `${key}=${value}`,
  ]);
  await runGh([
    "workflow",
    "run",
    "athena-documentation-waiver.yml",
    "--ref",
    "main",
    ...fields,
  ]);
  console.log(
    `Requested documentation waiver for PR #${inputs.pr_number} at ${inputs.head_sha}. Approve the athena-documentation-waiver environment deployment in GitHub to publish it.`,
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
