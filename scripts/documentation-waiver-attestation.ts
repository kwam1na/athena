import type { DeliveryDocumentationFinding } from "./delivery-documentation-check";
import {
  HARNESS_REVIEW_IDENTITY_VERSION,
  type HarnessReviewIdentityVersion,
} from "./harness-review-identity";

export const DOCUMENTATION_WAIVER_SCHEMA_VERSION = 4 as const;
export const DOCUMENTATION_WAIVER_DISPATCHER =
  "github-actions[bot]" as const;
export const DOCUMENTATION_WAIVER_REQUEST_WORKFLOW_PATH =
  ".github/workflows/athena-documentation-waiver-request.yml" as const;
export const DOCUMENTATION_WAIVER_CHECK_NAME =
  "athena/documentation-waiver" as const;
export const DOCUMENTATION_WAIVER_WORKFLOW_PATH =
  ".github/workflows/athena-documentation-waiver.yml" as const;
export const DOCUMENTATION_WAIVER_ARTIFACT_NAME =
  "athena-documentation-waiver-attestation" as const;

export type DocumentationWaiverFindingCode =
  DeliveryDocumentationFinding["policy"];

export type DocumentationWaiverCandidate = {
  repository: string;
  prNumber: number;
  headSha: string;
  deliverableTreeSha: string;
  identityVersion: HarnessReviewIdentityVersion;
  baseRef: string;
  baseTipSha: string;
  diffBaseSha: string;
};

export type DocumentationWaiverAttestation =
  DocumentationWaiverCandidate & {
    schemaVersion: typeof DOCUMENTATION_WAIVER_SCHEMA_VERSION;
    kind: "documentation_waiver";
    obligationId: "documentation.current";
    waivedFindingCodes: DocumentationWaiverFindingCode[];
    requestedBy: string;
    requestedByType: "User";
    relayedBy: typeof DOCUMENTATION_WAIVER_DISPATCHER;
    relayWorkflowRunId: number;
    passkeyApprovalId: string;
    passkeyCredentialId: string;
    passkeyApprovedAt: number;
    approvedBy: string;
    approvalEnvironment: "athena-documentation-waiver";
    reason: string;
    workflowRunId: number;
    createdAt: string;
  };

export type DocumentationWaiverWorkflowRun = {
  id: number;
  event: string;
  path: string;
  headBranch: string;
  conclusion: string | null;
  actor: string;
  actorType: string;
  relay: {
    id: number;
    event: string;
    path: string;
    headBranch: string;
    conclusion: string | null;
    actor: string;
    actorType: string;
  };
  approvals: Array<{
    state: string;
    user: string;
    userType: string;
    environments: string[];
  }>;
};

type VerificationFailureCode =
  | "invalid_attestation"
  | "candidate_mismatch"
  | "finding_not_waived"
  | "untrusted_workflow";

export type DocumentationWaiverVerification =
  | { ok: true; attestation: DocumentationWaiverAttestation }
  | { ok: false; code: VerificationFailureCode; reason: string };

export type GitHubJsonRequest = (path: string) => Promise<unknown>;

export type DiscoveredDocumentationWaiver = {
  recordId: string;
  approvedBy: string;
  attestationUrl: string;
  attestation: DocumentationWaiverAttestation;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseDocumentationWaiverAttestation(
  value: unknown,
): DocumentationWaiverAttestation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<DocumentationWaiverAttestation>;
  if (
    record.schemaVersion !== DOCUMENTATION_WAIVER_SCHEMA_VERSION ||
    record.kind !== "documentation_waiver" ||
    record.obligationId !== "documentation.current" ||
    record.identityVersion !== HARNESS_REVIEW_IDENTITY_VERSION ||
    !Number.isInteger(record.prNumber) ||
    (record.prNumber as number) < 1 ||
    !Number.isInteger(record.workflowRunId) ||
    (record.workflowRunId as number) < 1 ||
    !Number.isInteger(record.relayWorkflowRunId) ||
    (record.relayWorkflowRunId as number) < 1 ||
    !Number.isFinite(record.passkeyApprovedAt) ||
    (record.passkeyApprovedAt as number) <= 0 ||
    !nonEmpty(record.repository) ||
    !nonEmpty(record.headSha) ||
    !nonEmpty(record.deliverableTreeSha) ||
    !nonEmpty(record.baseRef) ||
    !nonEmpty(record.baseTipSha) ||
    !nonEmpty(record.diffBaseSha) ||
    !nonEmpty(record.approvedBy) ||
    !nonEmpty(record.requestedBy) ||
    record.requestedByType !== "User" ||
    record.relayedBy !== DOCUMENTATION_WAIVER_DISPATCHER ||
    !nonEmpty(record.passkeyApprovalId) ||
    !nonEmpty(record.passkeyCredentialId) ||
    record.approvalEnvironment !== "athena-documentation-waiver" ||
    !nonEmpty(record.reason) ||
    !nonEmpty(record.createdAt) ||
    !Array.isArray(record.waivedFindingCodes) ||
    record.waivedFindingCodes.length === 0 ||
    !record.waivedFindingCodes.every(
      (code) =>
        code === "compound-solution" || code === "landed-change-report",
    )
  ) {
    return undefined;
  }
  return record as DocumentationWaiverAttestation;
}

export function verifyDocumentationWaiverAttestation(input: {
  attestation: unknown;
  expected: DocumentationWaiverCandidate;
  findingCodes: readonly DocumentationWaiverFindingCode[];
  workflowRun: DocumentationWaiverWorkflowRun;
}): DocumentationWaiverVerification {
  const attestation = parseDocumentationWaiverAttestation(input.attestation);
  if (!attestation) {
    return {
      ok: false,
      code: "invalid_attestation",
      reason: "The GitHub documentation waiver has an invalid shape.",
    };
  }

  const expected = input.expected;
  if (
    attestation.repository !== expected.repository ||
    attestation.prNumber !== expected.prNumber ||
    attestation.headSha !== expected.headSha ||
    attestation.deliverableTreeSha !== expected.deliverableTreeSha ||
    attestation.identityVersion !== expected.identityVersion ||
    attestation.baseRef !== expected.baseRef ||
    attestation.baseTipSha !== expected.baseTipSha ||
    attestation.diffBaseSha !== expected.diffBaseSha
  ) {
    return {
      ok: false,
      code: "candidate_mismatch",
      reason: "The GitHub documentation waiver does not match this candidate.",
    };
  }

  const waived = new Set(attestation.waivedFindingCodes);
  if (input.findingCodes.some((code) => !waived.has(code))) {
    return {
      ok: false,
      code: "finding_not_waived",
      reason: "The GitHub documentation waiver does not cover every live finding.",
    };
  }

  const workflow = input.workflowRun;
  const relay = workflow.relay;
  if (
    workflow.id !== attestation.workflowRunId ||
    workflow.event !== "workflow_dispatch" ||
    workflow.path !== DOCUMENTATION_WAIVER_WORKFLOW_PATH ||
    workflow.headBranch !== "main" ||
    workflow.conclusion !== "success" ||
    workflow.actor !== DOCUMENTATION_WAIVER_DISPATCHER ||
    workflow.actorType !== "Bot" ||
    attestation.relayedBy !== workflow.actor ||
    relay.id !== attestation.relayWorkflowRunId ||
    relay.event !== "workflow_dispatch" ||
    relay.path !== DOCUMENTATION_WAIVER_REQUEST_WORKFLOW_PATH ||
    relay.headBranch !== "main" ||
    relay.conclusion !== "success" ||
    relay.actor !== attestation.requestedBy ||
    relay.actorType !== attestation.requestedByType ||
    !workflow.approvals.some(
      (approval) =>
        approval.state === "approved" &&
        approval.user === attestation.approvedBy &&
        approval.userType === "User" &&
        approval.environments.includes(attestation.approvalEnvironment),
    )
  ) {
    return {
      ok: false,
      code: "untrusted_workflow",
      reason: "The waiver was not issued by the trusted default-branch workflow.",
    };
  }

  return { ok: true, attestation };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function discoverDocumentationWaiverAttestation(input: {
  expected: DocumentationWaiverCandidate;
  findingCodes: readonly DocumentationWaiverFindingCode[];
  requestJson: GitHubJsonRequest;
  loadWorkflowAttestation: (runId: number) => Promise<unknown>;
}): Promise<DiscoveredDocumentationWaiver | undefined> {
  const response = asObject(
    await input.requestJson(
      `/repos/${input.expected.repository}/commits/${input.expected.headSha}/check-runs?check_name=${DOCUMENTATION_WAIVER_CHECK_NAME}`,
    ),
  );
  const checkRuns = Array.isArray(response?.check_runs)
    ? response.check_runs
    : [];

  for (const value of [...checkRuns].reverse()) {
    const check = asObject(value);
    const app = asObject(check?.app);
    const externalId =
      typeof check?.external_id === "string" ? check.external_id : "";
    const runIdMatch = /^athena-documentation-waiver\/v1\/(\d+)$/.exec(
      externalId,
    );
    if (
      check?.name !== DOCUMENTATION_WAIVER_CHECK_NAME ||
      check?.conclusion !== "success" ||
      app?.slug !== "github-actions" ||
      typeof check?.id !== "number" ||
      !nonEmpty(check?.details_url) ||
      !runIdMatch
    ) {
      continue;
    }

    const workflowRunId = Number(runIdMatch[1]);
    const canonicalRunUrl = `https://github.com/${input.expected.repository}/actions/runs/${workflowRunId}`;
    if (check.details_url !== canonicalRunUrl) continue;
    const parsed = parseDocumentationWaiverAttestation(
      await input.loadWorkflowAttestation(workflowRunId),
    );
    if (!parsed) continue;
    const run = asObject(
      await input.requestJson(
        `/repos/${input.expected.repository}/actions/runs/${workflowRunId}`,
      ),
    );
    const actor = asObject(run?.actor);
    const approvalsValue = await input.requestJson(
      `/repos/${input.expected.repository}/actions/runs/${workflowRunId}/approvals`,
    );
    const approvals = Array.isArray(approvalsValue)
      ? approvalsValue.flatMap((value) => {
          const review = asObject(value);
          const user = asObject(review?.user);
          const environments = Array.isArray(review?.environments)
            ? review.environments.flatMap((environment) => {
                const parsedEnvironment = asObject(environment);
                return typeof parsedEnvironment?.name === "string"
                  ? [parsedEnvironment.name]
                  : [];
              })
            : [];
          return typeof review?.state === "string" &&
            typeof user?.login === "string" &&
            typeof user?.type === "string"
            ? [{ state: review.state, user: user.login, userType: user.type, environments }]
            : [];
        })
      : [];
    const relayRun = asObject(
      await input.requestJson(
        `/repos/${input.expected.repository}/actions/runs/${parsed.relayWorkflowRunId}`,
      ),
    );
    const relayActor = asObject(relayRun?.actor);
    const verification = verifyDocumentationWaiverAttestation({
      attestation: parsed,
      expected: input.expected,
      findingCodes: input.findingCodes,
      workflowRun: {
        id: typeof run?.id === "number" ? run.id : -1,
        event: typeof run?.event === "string" ? run.event : "",
        path: typeof run?.path === "string" ? run.path : "",
        headBranch:
          typeof run?.head_branch === "string" ? run.head_branch : "",
        conclusion:
          typeof run?.conclusion === "string" ? run.conclusion : null,
        actor: typeof actor?.login === "string" ? actor.login : "",
        actorType: typeof actor?.type === "string" ? actor.type : "",
        relay: {
          id: typeof relayRun?.id === "number" ? relayRun.id : -1,
          event: typeof relayRun?.event === "string" ? relayRun.event : "",
          path: typeof relayRun?.path === "string" ? relayRun.path : "",
          headBranch:
            typeof relayRun?.head_branch === "string"
              ? relayRun.head_branch
              : "",
          conclusion:
            typeof relayRun?.conclusion === "string"
              ? relayRun.conclusion
              : null,
          actor:
            typeof relayActor?.login === "string" ? relayActor.login : "",
          actorType:
            typeof relayActor?.type === "string" ? relayActor.type : "",
        },
        approvals,
      },
    });
    if (!verification.ok) continue;
    return {
      recordId: `github-check:${check.id}`,
      approvedBy: parsed.approvedBy,
      attestationUrl: canonicalRunUrl,
      attestation: parsed,
    };
  }
  return undefined;
}
