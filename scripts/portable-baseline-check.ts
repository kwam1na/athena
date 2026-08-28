/**
 * Read-only drift and parity sensor for Athena's portable-workflow baseline.
 *
 * The baseline deliberately records source-backed behavior before any portable
 * extraction changes discovery. This checker validates the committed sources,
 * bounded closure, residual discovery inventory, and representative scenarios
 * without generating or rewriting any artifact.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";

import {
  BOUNDED_MEMBER_CONTRACTS,
  assertionSemanticDigest,
  NORMATIVE_SOURCE_CONTRACTS,
  REQUIRED_ASSERTION_SEMANTIC_DIGESTS,
  REQUIRED_BLOCKING_DEPENDENCY_CONTRACTS,
  REQUIRED_NON_BLOCKING_DEPENDENCY_TUPLES,
  REQUIRED_REFERENCE_DISPOSITION_CONTRACTS,
  REQUIRED_RESIDUAL_INVENTORY_DESCRIPTION,
  RULE_IDENTITY_CONTRACTS,
} from "./portable-baseline-contracts";
import {
  type ContainedPathState,
  PortableBaselinePathContainmentError,
  resolveContainedPath,
} from "./portable-baseline-filesystem";
import {
  isApprovalSourceKind,
  PortableBaselineDocumentValidationError,
  validatePortableBaselineDocuments,
} from "./portable-baseline-schema";

const BASELINE_PATH = ".agents/characterization-baseline.json";
const OVERLAY_MAP_PATH = ".agents/portable-overlay-map.json";
const FIXTURE_DIRECTORY = "scripts/portable-baseline-fixtures";

const BASELINE_SCHEMA_VERSION = "athena-portable-characterization-baseline/1";
const OVERLAY_SCHEMA_VERSION = "athena-portable-overlay-map/1";
const SCENARIO_SCHEMA_VERSION = "athena-portable-characterization-scenario/1";
const OBSERVED_ONLY_ASSERTION_ID = "host-tool-call-sequence-is-observed-only";

const RULE_CLASSIFICATIONS = new Set([
  "portable-candidate",
  "retained-overlay",
  "optional-adapter",
  "excluded",
]);
const MEMBER_CLASSIFICATIONS = new Set([
  "portable-candidate",
  "retained-overlay",
  "excluded",
]);

const REQUIRED_SCENARIO_CONTRACTS = {
  "bounded-implementation": {
    requestKind: "implementation",
    assertionIds: [
      "route-tracked-implementation-to-execute",
      "repository-policy-precedes-workflow-examples",
      "implementation-selects-explicit-test-posture",
      "smallest-honest-sensors-run-before-merge-gate",
      "pr-athena-remains-merge-ready-authority",
      "generated-artifact-obligations-remain-mandatory",
      "athena-pr-contract-remains-mandatory",
    ],
    classificationIds: [
      "routing-and-repository-discovery",
      "test-and-handoff-posture",
      "athena-merge-ready-gates",
      "athena-generated-artifacts",
      "athena-pr-policy",
    ],
  },
  compounding: {
    requestKind: "compounding",
    assertionIds: [
      "compounding-requires-a-reusable-learning",
      "athena-solution-format-remains-repository-owned",
      "landed-report-does-not-replace-durable-learning",
    ],
    classificationIds: ["compound-workflow", "athena-reporting-policy"],
  },
  "configured-harness-blocker": {
    requestKind: "configured-enforcement",
    assertionIds: [
      "configured-harness-blockers-cannot-degrade-away",
      "harness-blockers-use-typed-sources-and-remediations",
      "operator-and-provider-proof-lanes-stay-separated",
    ],
    classificationIds: ["athena-harness-evidence", "athena-merge-ready-gates"],
  },
  "linear-tracking": {
    requestKind: "tracking",
    assertionIds: [
      "tracker-neutral-workflow-has-actionable-no-tracker-handoff",
      "linear-context-resolution-is-adapter-behavior",
      "linear-work-is-atomic-and-dependency-aware",
      "linear-execution-keeps-ticket-state-current",
    ],
    classificationIds: [
      "tracker-neutral-capability-contract",
      "linear-tracker-adapter",
    ],
  },
  planning: {
    requestKind: "planning",
    assertionIds: [
      "route-approved-planning-to-plan-workflow",
      "repository-policy-precedes-workflow-examples",
      "planning-captures-test-posture-and-sensors",
      "planning-does-not-mutate-runtime-behavior",
    ],
    classificationIds: [
      "routing-and-repository-discovery",
      "planning-workflow",
      "test-and-handoff-posture",
    ],
  },
  review: {
    requestKind: "review",
    assertionIds: [
      "review-selects-core-and-risk-lenses",
      "review-is-independent-of-implementation",
      "actionable-findings-loop-to-resolution",
      "athena-review-evidence-binds-the-candidate",
    ],
    classificationIds: ["review-workflow", "athena-harness-evidence"],
  },
  routing: {
    requestKind: "routing",
    assertionIds: [
      "route-tracked-implementation-to-execute",
      "route-approved-ticket-creation-to-track",
      "route-fuzzy-requirements-to-brainstorm",
      "route-approved-planning-to-plan-workflow",
      "route-unknown-root-cause-to-debugging",
      "route-review-only-to-code-review",
      "route-explicit-skill-as-requested",
      "route-default-implementation-through-deliver-work",
      "repository-policy-precedes-workflow-examples",
    ],
    classificationIds: ["routing-and-repository-discovery"],
  },
} as const;

const REQUEST_KINDS = new Set([
  "compounding",
  "configured-enforcement",
  "implementation",
  "planning",
  "review",
  "routing",
  "tracking",
]);

const HOST_ALIAS_REFERENCE_NAMES = new Set([
  "designing-frontends",
  "frontend-skill",
  "requesting-code-review",
]);

const REQUIRED_DISCOVERY_ROOTS = new Map<
  string,
  PortableCharacterizationBaseline["discoveryRoots"][number]["state"]
>([
  [".agents/skills", "present"],
  [".claude/skills", "absent"],
]);

const APPROVAL_SOURCE_CONTRACTS = new Map<
  string,
  {
    path: string;
    kind: "approved-requirements" | "approved-plan";
  }
>([
  [
    "approved-requirements",
    {
      path: "docs/brainstorms/2026-08-27-cross-agent-delivery-skills-requirements.md",
      kind: "approved-requirements",
    },
  ],
  [
    "approved-delivery-plan",
    {
      path: "docs/plans/2026-08-27-002-feat-cross-agent-delivery-rails-and-skills-plan.md",
      kind: "approved-plan",
    },
  ],
]);

const SOURCE_BOUND_REFERENCE_FREE_DEPENDENCY_BINDINGS = [
  {
    fromMemberId: "deliver-work-body",
    selector:
      "If the request is a bug with unknown root cause, use a systematic debugging skill before planning the fix.",
    reference: "ce-debug",
    toMemberId: "ce-debug-source-bundle",
    requirement: "routing",
    parity: "blocking",
  },
  {
    fromMemberId: "deliver-work-body",
    selector:
      "If the task is purely a review, use the available code-review skill instead of implementing.",
    reference: "ce-code-review",
    toMemberId: "ce-code-review-source-bundle",
    requirement: "routing",
    parity: "blocking",
  },
  {
    fromMemberId: "ce-brainstorm-source-bundle",
    selector: "Suggest the alternative skill the user appears to want",
    reference: "ce-debug",
    toMemberId: "ce-debug-source-bundle",
    requirement: "conditional",
    parity: "blocking",
  },
  {
    fromMemberId: "compound-reviewer-prompts",
    selector: "Invoke them through the Skill tool",
    reference: "ce-session-extract",
    toMemberId: "ce-session-extract-source-bundle",
    requirement: "required",
    parity: "blocking",
  },
  {
    fromMemberId: "compound-reviewer-prompts",
    selector: "Extraction is delegated to two agent-facing skills.",
    reference: "ce-session-inventory",
    toMemberId: "ce-session-inventory-source-bundle",
    requirement: "required",
    parity: "blocking",
  },
] as const;

const REQUIRED_ATHENA_OVERLAYS = [
  "athena-deployment-handoff",
  "athena-generated-artifacts",
  "athena-harness-evidence",
  "athena-merge-ready-gates",
  "athena-pr-policy",
  "athena-reporting-policy",
  "athena-telemetry-policy",
] as const;

export type PortableBaselineSource = {
  id: string;
  path: string;
  kind:
    | "approved-plan"
    | "approved-requirements"
    | "enforcement-policy"
    | "repository-policy"
    | "workflow-policy";
  sha256: string;
};

export type PortableBaselineCitation = {
  sourceId: string;
  selector: string;
};

export type PortableBaselineAssertion = {
  id: string;
  area: string;
  statement: string;
  authority: "source-backed" | "explicitly-approved" | "observed-only";
  parity: "blocking" | "non-blocking";
  adjudication: "policy-backed" | "approved" | "unadjudicated";
  citations: PortableBaselineCitation[];
};

export type PortableCharacterizationBaseline = {
  schemaVersion: string;
  baselineId: string;
  capturedFor: string;
  readOnly: true;
  discoveryRoots: Array<{ path: string; state: "present" | "absent" }>;
  sources: PortableBaselineSource[];
  assertions: PortableBaselineAssertion[];
  scenarioFixtures: string[];
};

export type PortableOverlayClassification = {
  id: string;
  classification: string;
  rationale: string;
  assertionIds: string[];
};

export type BoundedClosureMember = {
  id: string;
  kind: "skill-bundle" | "dependency-bundle";
  path: string;
  classification: "portable-candidate" | "retained-overlay" | "excluded";
  fileCount: number;
  treeDigest: string;
  note?: string;
};

export type PortableOverlayMap = {
  schemaVersion: string;
  baselineId: string;
  readOnly: true;
  classificationSemantics: Record<string, string>;
  classifications: PortableOverlayClassification[];
  boundedClosure: {
    members: BoundedClosureMember[];
    auditedMemberIds: string[];
    directDependencies: Array<{
      fromMemberId: string;
      toMemberId: string;
      selector: string;
      requirement:
        "required" | "conditional" | "routing" | "host-alias" | "contextual";
      parity: "blocking" | "non-blocking";
    }>;
    referenceDispositions: Array<{
      fromMemberId: string;
      reference: string;
      resolution:
        "external-capability" | "host-alias" | "lexical-non-dependency";
      parity: "non-blocking";
      mappedMemberId?: string;
      rationale: string;
    }>;
  };
  outOfScopeInventory: {
    scanRoots: string[];
    fileCount: number;
    treeDigest: string;
    noMigrationCommitment: boolean;
    description: string;
  };
};

export type PortableBaselineScenario = {
  schemaVersion: string;
  readOnly: true;
  id: string;
  requestKind: string;
  expectedAssertionIds: string[];
  expectedClassificationIds: string[];
};

export type PortableBaselineDocuments = {
  baseline: PortableCharacterizationBaseline;
  overlayMap: PortableOverlayMap;
  scenarios: PortableBaselineScenario[];
};

export type PortableBaselineFinding = {
  code: string;
  message: string;
  path?: string;
};

export type PortableBaselineAuditResult = {
  ok: boolean;
  findings: PortableBaselineFinding[];
  scenarioIds: string[];
  summary: string;
};

export type PortableBaselineAuditOptions = {
  documents?: unknown;
};

type TreeEntry =
  | {
      path: string;
      digest: string;
      kind: "file";
      executable: boolean;
    }
  | {
      path: string;
      digest: string;
      kind: "symlink";
    };

type ResolvedMemberIdentity = {
  member: BoundedClosureMember;
  identityPath: string;
};

type SourceDependencyReference = {
  fromMemberId: string;
  reference: string;
  path: string;
};

class PortableBaselineReferenceTargetSymlinkError extends Error {
  constructor(readonly relativePath: string) {
    super(`Reference target ${relativePath} is a symlink.`);
    this.name = "PortableBaselineReferenceTargetSymlinkError";
  }
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function compareUtf8Bytes(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isSafeRelativePath(value: string) {
  return (
    value.length > 0 &&
    !path.isAbsolute(value) &&
    value !== ".." &&
    !value.startsWith(`..${path.sep}`) &&
    !value.split(/[\\/]/).includes("..")
  );
}

function isCanonicalRepoRelativePath(value: string) {
  return (
    isSafeRelativePath(value) &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment !== "" && segment !== ".") &&
    path.posix.normalize(value) === value
  );
}

function relativePosix(rootDir: string, absolutePath: string) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

export async function collectTreeEntries(
  rootDir: string,
  relativeRoot: string,
): Promise<TreeEntry[]> {
  const containedRoot = await resolveContainedPath(rootDir, relativeRoot, {
    allowExternalLeafSymlinkMetadata: true,
  });
  const { absolutePath: absoluteRoot, state } = containedRoot;
  if (state === "absent") return [];
  if (state === "file") {
    const fileStat = await lstat(absoluteRoot);
    return [
      {
        path: relativeRoot,
        digest: sha256(await readFile(absoluteRoot)),
        kind: "file",
        executable: (fileStat.mode & 0o111) !== 0,
      },
    ];
  }
  if (state === "symlink") {
    return [
      {
        path: relativeRoot,
        digest: sha256(`symlink:${await readlink(absoluteRoot)}`),
        kind: "symlink",
      },
    ];
  }

  const entries: TreeEntry[] = [];
  const visit = async (absoluteDirectory: string): Promise<void> => {
    const children = await readdir(absoluteDirectory, { withFileTypes: true });
    children.sort((left, right) => compareUtf8Bytes(left.name, right.name));
    for (const child of children) {
      const absoluteChild = path.join(absoluteDirectory, child.name);
      const relativeChild = relativePosix(
        containedRoot.realRoot,
        absoluteChild,
      );
      if (child.isDirectory()) {
        await visit(absoluteChild);
      } else if (child.isSymbolicLink()) {
        entries.push({
          path: relativeChild,
          digest: sha256(`symlink:${await readlink(absoluteChild)}`),
          kind: "symlink",
        });
      } else if (child.isFile()) {
        const fileStat = await lstat(absoluteChild);
        entries.push({
          path: relativeChild,
          digest: sha256(await readFile(absoluteChild)),
          kind: "file",
          executable: (fileStat.mode & 0o111) !== 0,
        });
      }
    }
  };
  await visit(absoluteRoot);
  return entries;
}

export function digestTreeEntries(entries: readonly TreeEntry[]) {
  const manifest = [...entries]
    .sort((left, right) => compareUtf8Bytes(left.path, right.path))
    .map(
      (entry) =>
        `${entry.path}\0${entry.kind}\0${entry.kind === "file" && entry.executable ? "executable" : "not-executable"}\0${entry.digest}`,
    )
    .join("\n");
  return sha256(manifest.length === 0 ? "" : `${manifest}\n`);
}

async function readJson(
  rootDir: string,
  relativePath: string,
): Promise<unknown> {
  const containedPath = await resolveContainedPath(rootDir, relativePath);
  try {
    return JSON.parse(
      await readFile(containedPath.absolutePath, "utf8"),
    ) as unknown;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new PortableBaselineDocumentValidationError([
        {
          code: "document-json-invalid",
          message: `${relativePath} is not valid JSON.`,
          path: relativePath,
        },
      ]);
    }
    throw error;
  }
}

async function loadScenarios(rootDir: string) {
  const fixtureRoot = await resolveContainedPath(rootDir, FIXTURE_DIRECTORY);
  const entries = await readdir(fixtureRoot.absolutePath, {
    withFileTypes: true,
  });
  const fixturePaths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.posix.join(FIXTURE_DIRECTORY, entry.name))
    .sort(compareUtf8Bytes);
  const scenarios = await Promise.all(
    fixturePaths.map((fixturePath) => readJson(rootDir, fixturePath)),
  );
  return { fixturePaths, scenarios };
}

export async function loadPortableBaselineDocuments(
  rootDir: string,
): Promise<PortableBaselineDocuments> {
  const [{ scenarios }, baseline, overlayMap] = await Promise.all([
    loadScenarios(rootDir),
    readJson(rootDir, BASELINE_PATH),
    readJson(rootDir, OVERLAY_MAP_PATH),
  ]);
  const validation = validatePortableBaselineDocuments({
    baseline,
    overlayMap,
    scenarios,
  });
  if (!validation.documents) {
    throw new PortableBaselineDocumentValidationError(validation.findings);
  }
  return validation.documents;
}

function pushDuplicateFindings(
  findings: PortableBaselineFinding[],
  values: readonly string[],
  code: string,
  label: string,
) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      findings.push({ code, message: `${label} ${value} is duplicated.` });
    }
    seen.add(value);
  }
}

function dependencyTupleKey(
  dependency: PortableOverlayMap["boundedClosure"]["directDependencies"][number],
) {
  return [
    dependency.fromMemberId,
    dependency.toMemberId,
    dependency.selector,
    dependency.requirement,
    dependency.parity,
  ].join("\0");
}

function hasRuleClassification(value: unknown): value is string {
  return typeof value === "string" && RULE_CLASSIFICATIONS.has(value);
}

function hasMemberClassification(
  value: unknown,
): value is BoundedClosureMember["classification"] {
  return typeof value === "string" && MEMBER_CLASSIFICATIONS.has(value);
}

function invalidApprovalCitationSourceIds(
  assertion: PortableBaselineAssertion,
  sourceById: ReadonlyMap<string, PortableBaselineSource>,
) {
  return assertion.citations
    .filter((citation) => {
      const source = sourceById.get(citation.sourceId);
      const contract = APPROVAL_SOURCE_CONTRACTS.get(citation.sourceId);
      return (
        !source ||
        !contract ||
        source.path !== contract.path ||
        source.kind !== contract.kind
      );
    })
    .map((citation) => citation.sourceId);
}

function memberOwnsPath(memberPath: string, targetPath: string) {
  const normalizedMemberPath = memberPath.replace(/\/$/, "");
  const normalizedTargetPath = targetPath.replace(/\/$/, "");
  return (
    normalizedTargetPath === normalizedMemberPath ||
    normalizedTargetPath.startsWith(`${normalizedMemberPath}/`)
  );
}

async function resolveReferenceTargetPath(rootDir: string, reference: string) {
  const skillPath = `.agents/skills/${reference}`;
  const skillTarget = await resolveContainedPath(rootDir, skillPath, {
    allowExternalLeafSymlinkMetadata: true,
  });
  if (skillTarget.state === "symlink") {
    throw new PortableBaselineReferenceTargetSymlinkError(skillPath);
  }
  if (skillTarget.state !== "absent") {
    return skillPath;
  }
  const agentPath = `.agents/agents/${reference}.agent.md`;
  const agentTarget = await resolveContainedPath(rootDir, agentPath, {
    allowExternalLeafSymlinkMetadata: true,
  });
  if (agentTarget.state === "symlink") {
    throw new PortableBaselineReferenceTargetSymlinkError(agentPath);
  }
  if (agentTarget.state !== "absent") {
    return agentPath;
  }
  return undefined;
}

function findReferenceTargetMember(
  members: readonly BoundedClosureMember[],
  sourceMember: BoundedClosureMember,
  targetPath: string,
) {
  if (
    sourceMember.path === targetPath ||
    sourceMember.path.startsWith(`${targetPath.replace(/\/$/, "")}/`)
  ) {
    return sourceMember;
  }
  return (
    members.find((member) => memberOwnsPath(member.path, targetPath)) ??
    members.find((member) => member.path === `${targetPath}/SKILL.md`)
  );
}

function extractExplicitSelectorReferences(selector: string) {
  const references = new Set<string>();
  for (const match of selector.matchAll(/\bce-[a-z0-9]+(?:-[a-z0-9]+)*\b/g)) {
    references.add(match[0]);
  }
  for (const match of selector.matchAll(/\$([a-z][a-z0-9-]*)\b/g)) {
    references.add(match[1]);
  }
  return [...references];
}

async function collectSourceDependencyReferences(
  rootDir: string,
  members: readonly BoundedClosureMember[],
  memberEntriesById: ReadonlyMap<string, readonly TreeEntry[]>,
) {
  const skillRoot = await resolveContainedPath(rootDir, ".agents/skills");
  const skillNames = new Set(
    (await readdir(skillRoot.absolutePath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const references = new Map<string, SourceDependencyReference>();
  for (const member of members) {
    const entries = memberEntriesById.get(member.id) ?? [];
    for (const entry of entries) {
      if (entry.kind === "symlink") continue;
      let sourceText: string;
      try {
        sourceText = await readFile(path.join(rootDir, entry.path), "utf8");
      } catch {
        continue;
      }
      const names = new Set<string>();
      for (const match of sourceText.matchAll(
        /\bce-[a-z0-9]+(?:-[a-z0-9]+)*\b/g,
      )) {
        names.add(match[0]);
      }
      for (const match of sourceText.matchAll(/\$([a-z][a-z0-9-]*)\b/g)) {
        if (
          skillNames.has(match[1]) ||
          HOST_ALIAS_REFERENCE_NAMES.has(match[1])
        ) {
          names.add(match[1]);
        }
      }
      for (const reference of names) {
        const key = `${member.id}\0${reference}`;
        if (!references.has(key)) {
          references.set(key, {
            fromMemberId: member.id,
            reference,
            path: entry.path,
          });
        }
      }
    }
  }
  return [...references.values()];
}

export async function auditPortableWorkflowBaseline(
  rootDir: string,
  options: PortableBaselineAuditOptions = {},
): Promise<PortableBaselineAuditResult> {
  const findings: PortableBaselineFinding[] = [];
  let rawDocuments: unknown;
  try {
    rawDocuments = Object.prototype.hasOwnProperty.call(options, "documents")
      ? options.documents
      : await loadPortableBaselineDocuments(rootDir);
  } catch (error: unknown) {
    if (error instanceof PortableBaselineDocumentValidationError) {
      return {
        ok: false,
        findings: error.findings,
        scenarioIds: [],
        summary: `[portable-baseline] Found ${error.findings.length} document shape issue(s).`,
      };
    }
    if (error instanceof PortableBaselinePathContainmentError) {
      return {
        ok: false,
        findings: [
          {
            code: "document-path-outside-root",
            message: `Baseline document path ${error.relativePath} resolves outside the repository root.`,
            path: error.relativePath,
          },
        ],
        scenarioIds: [],
        summary: "[portable-baseline] Found 1 document path issue(s).",
      };
    }
    throw error;
  }
  const validation = validatePortableBaselineDocuments(rawDocuments);
  if (!validation.documents) {
    return {
      ok: false,
      findings: validation.findings,
      scenarioIds: [],
      summary: `[portable-baseline] Found ${validation.findings.length} document shape issue(s).`,
    };
  }
  const documents = validation.documents;
  const { baseline, overlayMap, scenarios } = documents;
  const referenceTargetPathCache = new Map<string, string | undefined>();
  const resolveCheckedReferenceTargetPath = async (reference: string) => {
    if (referenceTargetPathCache.has(reference)) {
      return referenceTargetPathCache.get(reference);
    }
    try {
      const targetPath = await resolveReferenceTargetPath(rootDir, reference);
      referenceTargetPathCache.set(reference, targetPath);
      return targetPath;
    } catch (error: unknown) {
      if (error instanceof PortableBaselineReferenceTargetSymlinkError) {
        findings.push({
          code: "source-reference-target-symlink-unsupported",
          message: `Reference ${reference} resolves to a symlink and cannot certify a required dependency target.`,
          path: error.relativePath,
        });
        referenceTargetPathCache.set(reference, undefined);
        return undefined;
      }
      if (!(error instanceof PortableBaselinePathContainmentError)) throw error;
      findings.push({
        code: "source-reference-target-outside-root",
        message: `Reference ${reference} resolves outside the repository root.`,
        path: error.relativePath,
      });
      referenceTargetPathCache.set(reference, undefined);
      return undefined;
    }
  };

  if (baseline.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    findings.push({
      code: "baseline-schema-unsupported",
      message: `Unsupported baseline schema ${baseline.schemaVersion}.`,
    });
  }
  if (overlayMap.schemaVersion !== OVERLAY_SCHEMA_VERSION) {
    findings.push({
      code: "overlay-schema-unsupported",
      message: `Unsupported overlay schema ${overlayMap.schemaVersion}.`,
    });
  }
  if (baseline.baselineId !== overlayMap.baselineId) {
    findings.push({
      code: "baseline-id-mismatch",
      message: "The baseline and overlay map do not share one baselineId.",
    });
  }

  pushDuplicateFindings(
    findings,
    baseline.sources.map((source) => source.id),
    "source-id-duplicate",
    "Source id",
  );
  pushDuplicateFindings(
    findings,
    baseline.sources.map((source) => source.path),
    "source-path-duplicate",
    "Source path",
  );
  pushDuplicateFindings(
    findings,
    baseline.assertions.map((assertion) => assertion.id),
    "assertion-id-duplicate",
    "Assertion id",
  );
  pushDuplicateFindings(
    findings,
    baseline.discoveryRoots.map((discoveryRoot) => discoveryRoot.path),
    "discovery-root-duplicate",
    "Discovery root path",
  );
  for (const [requiredPath, requiredState] of REQUIRED_DISCOVERY_ROOTS) {
    const matchingRoots = baseline.discoveryRoots.filter(
      (discoveryRoot) => discoveryRoot.path === requiredPath,
    );
    if (matchingRoots.length === 0) {
      findings.push({
        code: "discovery-root-required-missing",
        message: `Required discovery root ${requiredPath} is missing from the baseline.`,
        path: requiredPath,
      });
      continue;
    }
    if (matchingRoots.length !== 1) {
      findings.push({
        code: "discovery-root-required-duplicate",
        message: `Required discovery root ${requiredPath} must appear exactly once.`,
        path: requiredPath,
      });
    }
    if (matchingRoots.some((root) => root.state !== requiredState)) {
      findings.push({
        code: "discovery-root-required-state-mismatch",
        message: `Required discovery root ${requiredPath} must record state ${requiredState}.`,
        path: requiredPath,
      });
    }
  }
  for (const discoveryRoot of baseline.discoveryRoots) {
    if (!REQUIRED_DISCOVERY_ROOTS.has(discoveryRoot.path)) {
      findings.push({
        code: "discovery-root-unexpected",
        message: `Discovery root ${discoveryRoot.path} is outside the authoritative baseline root set.`,
        path: discoveryRoot.path,
      });
    }
  }

  const rejectedSourceIds = new Set<string>();
  const sourceIdCounts = new Map<string, number>();
  for (const source of baseline.sources) {
    sourceIdCounts.set(source.id, (sourceIdCounts.get(source.id) ?? 0) + 1);
  }
  for (const [sourceId, count] of sourceIdCounts) {
    if (count > 1) rejectedSourceIds.add(sourceId);
  }
  for (const [sourceId, contract] of NORMATIVE_SOURCE_CONTRACTS) {
    if (!baseline.sources.some((source) => source.id === sourceId)) {
      findings.push({
        code: "normative-source-contract-missing",
        message: `Required normative source ${sourceId} is missing.`,
      });
      continue;
    }
    if (
      baseline.sources.some(
        (source) =>
          source.id === sourceId &&
          (source.path !== contract.path || source.kind !== contract.kind),
      )
    ) {
      findings.push({
        code: "normative-source-contract-mismatch",
        message: `Normative source ${sourceId} must remain ${contract.kind} at ${contract.path}.`,
      });
      rejectedSourceIds.add(sourceId);
    }
  }
  for (const source of baseline.sources) {
    if (!NORMATIVE_SOURCE_CONTRACTS.has(source.id)) {
      findings.push({
        code: "normative-source-contract-unexpected",
        message: `Normative source ${source.id} is outside the complete source identity contract.`,
        path: source.path,
      });
      rejectedSourceIds.add(source.id);
    }
  }
  const sourceById = new Map(
    baseline.sources.map((source) => [source.id, source]),
  );
  for (const [sourceId, contract] of APPROVAL_SOURCE_CONTRACTS) {
    const source = sourceById.get(sourceId);
    if (!source) {
      findings.push({
        code: "approval-source-contract-missing",
        message: `Required approval source ${sourceId} is missing.`,
      });
      continue;
    }
    if (source.path !== contract.path || source.kind !== contract.kind) {
      findings.push({
        code: "approval-source-contract-mismatch",
        message: `Approval source ${sourceId} must remain ${contract.kind} at ${contract.path}.`,
        path: source.path,
      });
    }
  }
  for (const source of baseline.sources) {
    if (
      isApprovalSourceKind(source.kind) &&
      !APPROVAL_SOURCE_CONTRACTS.has(source.id)
    ) {
      findings.push({
        code: "approval-source-contract-unexpected",
        message: `Source ${source.id} is not authorized to represent explicit approval.`,
        path: source.path,
      });
    }
  }
  const sourceTextById = new Map<string, string>();
  const sourceIdentities: Array<{
    source: PortableBaselineSource;
    identityPath: string;
  }> = [];
  for (const source of baseline.sources) {
    if (!isSafeRelativePath(source.path)) {
      findings.push({
        code: "source-path-unsafe",
        message: `Source ${source.id} has unsafe path ${source.path}.`,
        path: source.path,
      });
      continue;
    }
    if (!isCanonicalRepoRelativePath(source.path)) {
      findings.push({
        code: "source-path-noncanonical",
        message: `Source ${source.id} must use a canonical slash-separated repository path.`,
        path: source.path,
      });
      continue;
    }
    try {
      const containedSource = await resolveContainedPath(rootDir, source.path, {
        allowExternalLeafSymlinkMetadata: true,
      });
      if (containedSource.state === "absent") {
        findings.push({
          code: "source-missing",
          message: `Source ${source.id} is missing.`,
          path: source.path,
        });
        continue;
      }
      if (containedSource.state === "symlink") {
        findings.push({
          code: "source-symlink-unsupported",
          message: `Normative source ${source.id} is a symlink and cannot certify policy provenance.`,
          path: source.path,
        });
        continue;
      }
      if (containedSource.identityPath === null) {
        findings.push({
          code: "source-filesystem-identity-missing",
          message: `Normative source ${source.id} has no repository-relative filesystem identity.`,
          path: source.path,
        });
        continue;
      }
      sourceIdentities.push({
        source,
        identityPath: containedSource.identityPath,
      });
      if (containedSource.identityPath !== source.path) {
        findings.push({
          code: "source-path-filesystem-noncanonical",
          message: `Normative source ${source.id} must use filesystem-canonical path ${containedSource.identityPath}.`,
          path: source.path,
        });
      }
      if (rejectedSourceIds.has(source.id)) continue;
      const sourceText = await readFile(containedSource.absolutePath, "utf8");
      sourceTextById.set(source.id, sourceText);
      if (sha256(sourceText) !== source.sha256) {
        findings.push({
          code: "source-digest-drift",
          message: `Source ${source.id} no longer matches its recorded digest.`,
          path: source.path,
        });
      }
    } catch (error: unknown) {
      if (error instanceof PortableBaselinePathContainmentError) {
        findings.push({
          code: "source-path-outside-root",
          message: `Source ${source.id} resolves outside the repository root.`,
          path: source.path,
        });
        continue;
      }
      findings.push({
        code: "source-missing",
        message: `Source ${source.id} is missing.`,
        path: source.path,
      });
    }
  }
  pushDuplicateFindings(
    findings,
    sourceIdentities.map(({ identityPath }) => identityPath),
    "source-identity-duplicate",
    "Normative source filesystem identity",
  );

  for (const discoveryRoot of baseline.discoveryRoots) {
    if (!isSafeRelativePath(discoveryRoot.path)) {
      findings.push({
        code: "discovery-root-path-unsafe",
        message: `Discovery root path ${discoveryRoot.path} is unsafe.`,
        path: discoveryRoot.path,
      });
      continue;
    }
    let state: ContainedPathState;
    try {
      const containedRoot = await resolveContainedPath(
        rootDir,
        discoveryRoot.path,
      );
      state = containedRoot.state;
    } catch (error: unknown) {
      if (error instanceof PortableBaselinePathContainmentError) {
        findings.push({
          code: "discovery-root-path-outside-root",
          message: `Discovery root ${discoveryRoot.path} resolves outside the repository root.`,
          path: discoveryRoot.path,
        });
        continue;
      }
      throw error;
    }
    const actual = state === "absent" ? "absent" : "present";
    if (actual !== discoveryRoot.state) {
      findings.push({
        code: "discovery-root-drift",
        message: `Discovery root ${discoveryRoot.path} is ${actual}, expected ${discoveryRoot.state}.`,
        path: discoveryRoot.path,
      });
    }
  }

  const assertionById = new Map(
    baseline.assertions.map((assertion) => [assertion.id, assertion]),
  );
  for (const [
    assertionId,
    semanticDigest,
  ] of REQUIRED_ASSERTION_SEMANTIC_DIGESTS) {
    const assertion = assertionById.get(assertionId);
    const isObservedOnlyContract = assertionId === OBSERVED_ONLY_ASSERTION_ID;
    if (!assertion) {
      findings.push({
        code: isObservedOnlyContract
          ? "required-assertion-contract-missing"
          : "required-blocking-assertion-contract-missing",
        message: `Required assertion ${assertionId} is missing.`,
      });
      continue;
    }
    if (assertionSemanticDigest(assertion) !== semanticDigest) {
      findings.push({
        code: isObservedOnlyContract
          ? "required-assertion-contract-mismatch"
          : "required-blocking-assertion-contract-mismatch",
        message: `Required assertion ${assertionId} no longer matches its exact approved semantics and citation provenance.`,
      });
    }
  }
  for (const assertion of baseline.assertions) {
    if (
      assertion.parity === "blocking" &&
      !REQUIRED_ASSERTION_SEMANTIC_DIGESTS.has(assertion.id)
    ) {
      findings.push({
        code: "blocking-assertion-contract-unexpected",
        message: `Blocking assertion ${assertion.id} has no approved exact semantic contract.`,
      });
    }
    if (assertion.authority === "source-backed") {
      if (
        assertion.adjudication !== "policy-backed" ||
        assertion.citations.length === 0
      ) {
        findings.push({
          code: "source-backed-assertion-uncited",
          message: `Assertion ${assertion.id} is source-backed but lacks policy-backed citations.`,
        });
      }
    } else if (assertion.authority === "explicitly-approved") {
      if (
        assertion.adjudication !== "approved" ||
        assertion.citations.length === 0
      ) {
        findings.push({
          code: "explicitly-approved-assertion-uncited",
          message: `Assertion ${assertion.id} is explicitly approved but lacks an approved decision citation.`,
        });
      }
      for (const sourceId of invalidApprovalCitationSourceIds(
        assertion,
        sourceById,
      )) {
        findings.push({
          code: "explicitly-approved-citation-invalid",
          message: `Assertion ${assertion.id} cites ${sourceId}, which is not an approved requirements or plan source.`,
        });
      }
    } else if (assertion.authority === "observed-only") {
      const approved =
        assertion.adjudication === "approved" && assertion.citations.length > 0;
      if (assertion.parity === "blocking") {
        if (!approved) {
          findings.push({
            code: "observed-only-blocker-unadjudicated",
            message: `Observed-only assertion ${assertion.id} cannot block parity before explicit approval with a source citation.`,
          });
        }
      }
      if (
        assertion.adjudication === "approved" ||
        assertion.parity === "blocking"
      ) {
        for (const sourceId of invalidApprovalCitationSourceIds(
          assertion,
          sourceById,
        )) {
          findings.push({
            code: "observed-only-approval-citation-invalid",
            message: `Observed-only assertion ${assertion.id} cites ${sourceId}, which cannot represent explicit approval.`,
          });
        }
      }
    } else if (assertion.authority !== "observed-only") {
      findings.push({
        code: "assertion-authority-invalid",
        message: `Assertion ${assertion.id} has unknown authority ${String(assertion.authority)}.`,
      });
    }

    for (const citation of assertion.citations) {
      const source = sourceById.get(citation.sourceId);
      if (!source) {
        findings.push({
          code: "citation-source-missing",
          message: `Assertion ${assertion.id} cites unknown source ${citation.sourceId}.`,
        });
        continue;
      }
      if (
        citation.selector.length === 0 ||
        !sourceTextById.get(source.id)?.includes(citation.selector)
      ) {
        findings.push({
          code: "citation-selector-drift",
          message: `Assertion ${assertion.id} selector is absent from ${source.path}.`,
          path: source.path,
        });
      }
    }
  }

  pushDuplicateFindings(
    findings,
    overlayMap.classifications.map((entry) => entry.id),
    "classification-id-duplicate",
    "Classification id",
  );
  for (const [ruleId, contract] of RULE_IDENTITY_CONTRACTS) {
    const rule = overlayMap.classifications.find(
      (entry) => entry.id === ruleId,
    );
    if (!rule) {
      findings.push({
        code: "rule-contract-missing",
        message: `Required rule ${ruleId} is missing.`,
      });
      continue;
    }
    if (
      rule.classification !== contract.classification ||
      rule.rationale !== contract.rationale ||
      JSON.stringify(rule.assertionIds) !==
        JSON.stringify(contract.assertionIds)
    ) {
      findings.push({
        code: "rule-contract-mismatch",
        message: `Rule ${ruleId} must preserve its exact classification, rationale, and assertion membership.`,
      });
    }
  }
  for (const rule of overlayMap.classifications) {
    if (!RULE_IDENTITY_CONTRACTS.has(rule.id)) {
      findings.push({
        code: "rule-contract-unexpected",
        message: `Rule ${rule.id} is outside the complete rule identity contract.`,
      });
    }
  }
  const assertionIds = new Set(
    baseline.assertions.map((assertion) => assertion.id),
  );
  const classificationById = new Map(
    overlayMap.classifications.map((entry) => [entry.id, entry]),
  );
  const classifiedAssertionIds = new Set<string>();
  for (const classification of overlayMap.classifications) {
    if (!hasRuleClassification(classification.classification)) {
      findings.push({
        code: "classification-invalid",
        message: `Classification ${classification.id} has unknown value ${classification.classification}.`,
      });
    }
    if (classification.assertionIds.length === 0) {
      findings.push({
        code: "classification-unbacked",
        message: `Classification ${classification.id} cites no baseline assertion.`,
      });
    }
    for (const assertionId of classification.assertionIds) {
      classifiedAssertionIds.add(assertionId);
      const assertion = assertionById.get(assertionId);
      if (!assertionIds.has(assertionId)) {
        findings.push({
          code: "classification-assertion-missing",
          message: `Classification ${classification.id} cites unknown assertion ${assertionId}.`,
        });
      } else if (
        assertion?.authority === "observed-only" &&
        (assertion.adjudication !== "approved" ||
          assertion.citations.length === 0 ||
          invalidApprovalCitationSourceIds(assertion, sourceById).length > 0) &&
        (assertion.parity !== "non-blocking" ||
          classification.classification !== "excluded")
      ) {
        findings.push({
          code: "observed-only-promotion-unapproved",
          message: `Unadjudicated observed-only assertion ${assertion.id} may only remain excluded and non-blocking until explicitly approved.`,
        });
      }
    }
  }
  for (const assertion of baseline.assertions) {
    if (!classifiedAssertionIds.has(assertion.id)) {
      findings.push({
        code: "assertion-unclassified",
        message: `Assertion ${assertion.id} has no overlay-map classification.`,
      });
    }
  }

  const members = overlayMap.boundedClosure.members;
  const rejectedMemberIds = new Set<string>();
  for (const member of members) {
    if (!isSafeRelativePath(member.path)) {
      findings.push({
        code: "bounded-member-path-unsafe",
        message: `Bounded member ${member.id} has unsafe path ${member.path}.`,
        path: member.path,
      });
      rejectedMemberIds.add(member.id);
      continue;
    }
    if (!isCanonicalRepoRelativePath(member.path)) {
      findings.push({
        code: "bounded-member-path-noncanonical",
        message: `Bounded member ${member.id} must use a canonical slash-separated repository path.`,
        path: member.path,
      });
      rejectedMemberIds.add(member.id);
      continue;
    }
  }
  const memberById = new Map(members.map((member) => [member.id, member]));
  for (const [memberId, contract] of BOUNDED_MEMBER_CONTRACTS) {
    const member = memberById.get(memberId);
    if (!member) {
      findings.push({
        code: "bounded-member-contract-missing",
        message: `Required bounded member ${memberId} is missing.`,
      });
      continue;
    }
    if (
      member.path !== contract.path ||
      member.kind !== contract.kind ||
      member.classification !== contract.classification ||
      member.note !== contract.note
    ) {
      findings.push({
        code: "bounded-member-contract-mismatch",
        message: `Bounded member ${memberId} must preserve its exact canonical path, kind, classification, and optional note semantics.`,
      });
    }
  }
  for (const member of members) {
    if (!BOUNDED_MEMBER_CONTRACTS.has(member.id)) {
      findings.push({
        code: "bounded-member-contract-unexpected",
        message: `Bounded member ${member.id} is outside the complete closure identity contract.`,
        path: member.path,
      });
    }
  }
  pushDuplicateFindings(
    findings,
    members.map((member) => member.id),
    "bounded-member-duplicate",
    "Bounded member id",
  );
  const memberEntriesById = new Map<string, TreeEntry[]>();
  const resolvedMemberIdentities: ResolvedMemberIdentity[] = [];
  for (const member of members) {
    if (!hasMemberClassification(member.classification)) {
      findings.push({
        code: "bounded-member-unclassified",
        message: `Bounded member ${member.id} has no valid classification.`,
      });
    }
    if (rejectedMemberIds.has(member.id)) continue;
    let entries: TreeEntry[];
    try {
      const containedMemberRoot = await resolveContainedPath(
        rootDir,
        member.path,
        { allowExternalLeafSymlinkMetadata: true },
      );
      if (containedMemberRoot.state === "absent") {
        findings.push({
          code: "bounded-member-missing",
          message: `Bounded member ${member.id} does not exist.`,
          path: member.path,
        });
        rejectedMemberIds.add(member.id);
        continue;
      }
      if (containedMemberRoot.state === "symlink") {
        findings.push({
          code: "bounded-member-symlink-unsupported",
          message: `Bounded member ${member.id} is a symlink and cannot certify the required closure.`,
          path: member.path,
        });
        rejectedMemberIds.add(member.id);
        continue;
      }
      const identityPath = containedMemberRoot.identityPath;
      if (identityPath === null) {
        findings.push({
          code: "bounded-member-filesystem-identity-missing",
          message: `Bounded member ${member.id} has no repository-relative filesystem identity.`,
          path: member.path,
        });
        rejectedMemberIds.add(member.id);
        continue;
      }
      resolvedMemberIdentities.push({
        member,
        identityPath,
      });
      if (identityPath !== member.path) {
        findings.push({
          code: "bounded-member-path-filesystem-noncanonical",
          message: `Bounded member ${member.id} must use filesystem-canonical path ${identityPath}.`,
          path: member.path,
        });
      }
      entries = await collectTreeEntries(rootDir, member.path);
      if (entries.some((entry) => entry.kind === "symlink")) {
        findings.push({
          code: "bounded-member-symlink-unsupported",
          message: `Bounded member ${member.id} contains a symlink and cannot certify the required closure.`,
          path: member.path,
        });
        rejectedMemberIds.add(member.id);
        continue;
      }
      if (containedMemberRoot.state === "directory" && entries.length === 0) {
        findings.push({
          code: "bounded-member-empty-directory-unapproved",
          message: `Bounded member ${member.id} is an empty directory; empty-directory members require an explicit future baseline policy.`,
          path: member.path,
        });
        rejectedMemberIds.add(member.id);
        continue;
      }
    } catch (error: unknown) {
      if (error instanceof PortableBaselinePathContainmentError) {
        findings.push({
          code: "bounded-member-path-outside-root",
          message: `Bounded member ${member.id} resolves outside the repository root.`,
          path: member.path,
        });
        rejectedMemberIds.add(member.id);
        continue;
      }
      throw error;
    }
    memberEntriesById.set(member.id, entries);
    if (entries.length !== member.fileCount) {
      findings.push({
        code: "bounded-member-count-drift",
        message: `Bounded member ${member.id} has ${entries.length} files, expected ${member.fileCount}.`,
        path: member.path,
      });
    }
    if (digestTreeEntries(entries) !== member.treeDigest) {
      findings.push({
        code: "bounded-member-digest-drift",
        message: `Bounded member ${member.id} no longer matches its tree digest.`,
        path: member.path,
      });
    }
  }
  pushDuplicateFindings(
    findings,
    resolvedMemberIdentities.map((resolved) => resolved.identityPath),
    "bounded-member-duplicate",
    "Bounded member filesystem identity",
  );
  for (const [index, resolved] of resolvedMemberIdentities.entries()) {
    for (const other of resolvedMemberIdentities.slice(index + 1)) {
      if (
        resolved.identityPath.startsWith(`${other.identityPath}/`) ||
        other.identityPath.startsWith(`${resolved.identityPath}/`)
      ) {
        findings.push({
          code: "bounded-member-overlap",
          message: `Bounded members ${resolved.member.id} and ${other.member.id} overlap, so files would have more than one classification.`,
        });
      }
    }
  }

  const directDependencies = overlayMap.boundedClosure.directDependencies ?? [];
  const referenceDispositions =
    overlayMap.boundedClosure.referenceDispositions ?? [];
  const auditedMemberIds = overlayMap.boundedClosure.auditedMemberIds ?? [];
  pushDuplicateFindings(
    findings,
    auditedMemberIds,
    "bounded-member-dependency-audit-duplicate",
    "Dependency-audited member id",
  );
  const auditedMemberIdSet = new Set(auditedMemberIds);
  for (const member of members) {
    if (!auditedMemberIdSet.has(member.id)) {
      findings.push({
        code: "bounded-member-dependency-audit-missing",
        message: `Bounded member ${member.id} has not had its direct dependencies audited.`,
      });
    }
  }
  for (const auditedMemberId of auditedMemberIds) {
    if (!memberById.has(auditedMemberId)) {
      findings.push({
        code: "bounded-member-dependency-audit-unknown",
        message: `Dependency audit cites unknown bounded member ${auditedMemberId}.`,
      });
    }
  }
  pushDuplicateFindings(
    findings,
    directDependencies.map(
      (dependency) =>
        `${dependency.fromMemberId}\0${dependency.toMemberId}\0${dependency.selector}`,
    ),
    "direct-dependency-duplicate",
    "Direct dependency",
  );
  for (const contract of REQUIRED_BLOCKING_DEPENDENCY_CONTRACTS) {
    const matchingEdges = directDependencies.filter(
      (dependency) =>
        dependency.fromMemberId === contract.fromMemberId &&
        dependency.toMemberId === contract.toMemberId &&
        dependency.selector === contract.selector &&
        dependency.requirement === contract.requirement &&
        dependency.parity === contract.parity,
    );
    const referenceMatches =
      contract.relation === "literal-reference"
        ? extractExplicitSelectorReferences(contract.selector).includes(
            contract.reference,
          )
        : SOURCE_BOUND_REFERENCE_FREE_DEPENDENCY_BINDINGS.some(
            (binding) =>
              binding.fromMemberId === contract.fromMemberId &&
              binding.toMemberId === contract.toMemberId &&
              binding.selector === contract.selector &&
              binding.reference === contract.reference &&
              binding.requirement === contract.requirement &&
              binding.parity === contract.parity,
          );
    if (matchingEdges.length !== 1 || !referenceMatches) {
      findings.push({
        code: "required-blocking-dependency-contract-mismatch",
        message: `Required blocking dependency ${contract.fromMemberId} -> ${contract.toMemberId} must preserve its exact source selector, target, requirement, parity, and ${contract.relation} provenance.`,
      });
    }
  }
  for (const dependency of directDependencies) {
    if (
      dependency.parity === "blocking" &&
      !REQUIRED_BLOCKING_DEPENDENCY_CONTRACTS.some(
        (contract) =>
          dependency.fromMemberId === contract.fromMemberId &&
          dependency.toMemberId === contract.toMemberId &&
          dependency.selector === contract.selector &&
          dependency.requirement === contract.requirement &&
          dependency.parity === contract.parity,
      )
    ) {
      findings.push({
        code: "blocking-dependency-contract-unexpected",
        message: `Blocking dependency ${dependency.fromMemberId} -> ${dependency.toMemberId} has no exact source-backed contract.`,
      });
    }
  }
  const requiredNonBlockingDependencyKeys = new Set(
    REQUIRED_NON_BLOCKING_DEPENDENCY_TUPLES.map((tuple) => tuple.join("\0")),
  );
  const actualNonBlockingDependencyKeys = directDependencies
    .filter((dependency) => dependency.parity === "non-blocking")
    .map(dependencyTupleKey);
  for (const requiredKey of requiredNonBlockingDependencyKeys) {
    if (
      actualNonBlockingDependencyKeys.filter((key) => key === requiredKey)
        .length !== 1
    ) {
      findings.push({
        code: "non-blocking-dependency-contract-mismatch",
        message:
          "Every required non-blocking dependency must preserve its exact source, target, selector, requirement, and parity tuple.",
      });
    }
  }
  for (const actualKey of actualNonBlockingDependencyKeys) {
    if (!requiredNonBlockingDependencyKeys.has(actualKey)) {
      findings.push({
        code: "non-blocking-dependency-contract-mismatch",
        message:
          "A non-blocking dependency is missing from the exact bounded-closure contract.",
      });
    }
  }
  for (const dependency of directDependencies) {
    const fromMember = memberById.get(dependency.fromMemberId);
    if (!fromMember) {
      findings.push({
        code: "direct-dependency-source-missing",
        message: `Direct dependency source ${dependency.fromMemberId} is not in the bounded closure.`,
      });
    }
    if (!memberById.has(dependency.toMemberId)) {
      findings.push({
        code: "direct-dependency-target-missing",
        message: `Direct dependency target ${dependency.toMemberId} is not in the bounded closure.`,
      });
    }
    if (dependency.selector.length === 0) {
      findings.push({
        code: "direct-dependency-selector-empty",
        message: `Direct dependency ${dependency.fromMemberId} -> ${dependency.toMemberId} has no source selector.`,
      });
    } else if (fromMember && !rejectedMemberIds.has(fromMember.id)) {
      const entries = memberEntriesById.get(fromMember.id) ?? [];
      const selectorFound = (
        await Promise.all(
          entries.map(async (entry) => {
            if (entry.kind === "symlink") return false;
            try {
              return (
                await readFile(path.join(rootDir, entry.path), "utf8")
              ).includes(dependency.selector);
            } catch {
              return false;
            }
          }),
        )
      ).some(Boolean);
      if (!selectorFound) {
        findings.push({
          code: "direct-dependency-selector-drift",
          message: `Direct dependency selector for ${dependency.fromMemberId} -> ${dependency.toMemberId} is absent from the source bundle.`,
          path: fromMember.path,
        });
      }
    }
  }
  const referenceFreeDependencies = directDependencies.filter(
    (dependency) =>
      extractExplicitSelectorReferences(dependency.selector).length === 0,
  );
  for (const dependency of referenceFreeDependencies) {
    const matchingBindings =
      SOURCE_BOUND_REFERENCE_FREE_DEPENDENCY_BINDINGS.filter(
        (binding) =>
          binding.fromMemberId === dependency.fromMemberId &&
          binding.selector === dependency.selector &&
          binding.toMemberId === dependency.toMemberId &&
          binding.requirement === dependency.requirement &&
          binding.parity === dependency.parity,
      );
    if (matchingBindings.length !== 1) {
      findings.push({
        code: "reference-free-dependency-binding-mismatch",
        message: `Reference-free dependency ${dependency.fromMemberId} -> ${dependency.toMemberId} must have exactly one exact source-bound tuple.`,
      });
    }
  }
  for (const binding of SOURCE_BOUND_REFERENCE_FREE_DEPENDENCY_BINDINGS) {
    const matchingEdges = directDependencies.filter(
      (dependency) =>
        dependency.fromMemberId === binding.fromMemberId &&
        dependency.selector === binding.selector &&
        dependency.toMemberId === binding.toMemberId &&
        dependency.requirement === binding.requirement &&
        dependency.parity === binding.parity,
    );
    if (matchingEdges.length !== 1) {
      findings.push({
        code: "reference-free-dependency-binding-mismatch",
        message: `Source-bound tuple ${binding.fromMemberId} -> ${binding.toMemberId} must preserve its exact selector, reference, requirement, and parity.`,
      });
      if (binding.fromMemberId === "deliver-work-body") {
        findings.push({
          code: "source-routing-binding-mismatch",
          message: `Generic router binding ${binding.fromMemberId} -> ${binding.toMemberId} must preserve its exact selector and blocking routing edge.`,
        });
      }
    }
  }

  pushDuplicateFindings(
    findings,
    referenceDispositions.map(
      (disposition) => `${disposition.fromMemberId}\0${disposition.reference}`,
    ),
    "source-reference-disposition-duplicate",
    "Source reference disposition",
  );
  const dispositionByReference = new Map(
    referenceDispositions.map((disposition) => [
      `${disposition.fromMemberId}\0${disposition.reference}`,
      disposition,
    ]),
  );
  const dispositionContractKeys = new Set(
    REQUIRED_REFERENCE_DISPOSITION_CONTRACTS.map(
      (contract) => `${contract.fromMemberId}\0${contract.reference}`,
    ),
  );
  for (const contract of REQUIRED_REFERENCE_DISPOSITION_CONTRACTS) {
    const matchingDispositions = referenceDispositions.filter(
      (disposition) =>
        disposition.fromMemberId === contract.fromMemberId &&
        disposition.reference === contract.reference,
    );
    const disposition = matchingDispositions[0];
    const mappedMemberMatches =
      contract.resolution === "host-alias"
        ? disposition?.mappedMemberId === contract.mappedMemberId
        : disposition?.mappedMemberId === undefined;
    const exactDispositionMatches =
      matchingDispositions.length === 1 &&
      disposition?.resolution === contract.resolution &&
      disposition.parity === contract.parity &&
      disposition.rationale === contract.rationale &&
      mappedMemberMatches;
    const aliasDependencyMatches =
      contract.resolution !== "host-alias" ||
      directDependencies.filter(
        (dependency) =>
          dependency.fromMemberId === contract.fromMemberId &&
          dependency.toMemberId === contract.dependency.toMemberId &&
          dependency.selector === contract.dependency.selector &&
          dependency.requirement === contract.dependency.requirement &&
          dependency.parity === contract.dependency.parity,
      ).length === 1;
    if (!exactDispositionMatches || !aliasDependencyMatches) {
      findings.push({
        code: "reference-disposition-contract-mismatch",
        message: `Reference disposition ${contract.fromMemberId} -> ${contract.reference} must preserve its exact resolution, mapping, rationale, and host-alias dependency when applicable.`,
      });
    }
  }
  for (const disposition of referenceDispositions) {
    if (
      !dispositionContractKeys.has(
        `${disposition.fromMemberId}\0${disposition.reference}`,
      )
    ) {
      findings.push({
        code: "reference-disposition-contract-unexpected",
        message: `Reference disposition ${disposition.fromMemberId} -> ${disposition.reference} is outside the exact disposition contract.`,
      });
    }
  }
  for (const disposition of referenceDispositions) {
    if (!memberById.has(disposition.fromMemberId)) {
      findings.push({
        code: "source-reference-disposition-source-missing",
        message: `Reference disposition source ${disposition.fromMemberId} is not in the bounded closure.`,
      });
    }
    if (disposition.parity !== "non-blocking") {
      findings.push({
        code: "source-reference-disposition-blocking",
        message: `Reference disposition ${disposition.fromMemberId} -> ${disposition.reference} must remain non-blocking.`,
      });
    }
    if (disposition.rationale.trim().length === 0) {
      findings.push({
        code: "source-reference-disposition-rationale-missing",
        message: `Reference disposition ${disposition.fromMemberId} -> ${disposition.reference} has no rationale.`,
      });
    }
    if (
      disposition.resolution === "host-alias" &&
      (!disposition.mappedMemberId ||
        !memberById.has(disposition.mappedMemberId))
    ) {
      findings.push({
        code: "source-reference-host-alias-target-missing",
        message: `Host alias ${disposition.reference} does not map to a classified bounded member.`,
      });
    }
  }

  for (const dependency of directDependencies) {
    const sourceMember = memberById.get(dependency.fromMemberId);
    if (!sourceMember) continue;
    const explicitReferences = extractExplicitSelectorReferences(
      dependency.selector,
    );
    if (explicitReferences.length === 0) continue;
    const resolvedTargetMemberIds = new Set<string>();
    for (const reference of explicitReferences) {
      const targetPath = await resolveCheckedReferenceTargetPath(reference);
      if (targetPath) {
        const targetMember = findReferenceTargetMember(
          members,
          sourceMember,
          targetPath,
        );
        if (targetMember) resolvedTargetMemberIds.add(targetMember.id);
        continue;
      }
      const disposition = dispositionByReference.get(
        `${dependency.fromMemberId}\0${reference}`,
      );
      if (disposition?.mappedMemberId) {
        resolvedTargetMemberIds.add(disposition.mappedMemberId);
      }
    }
    if (resolvedTargetMemberIds.size === 0) {
      findings.push({
        code: "direct-dependency-reference-unresolved",
        message: `Direct dependency ${dependency.fromMemberId} -> ${dependency.toMemberId} names an explicit selector reference that does not resolve to a classified member.`,
      });
    } else if (
      resolvedTargetMemberIds.size !== 1 ||
      !resolvedTargetMemberIds.has(dependency.toMemberId)
    ) {
      findings.push({
        code: "direct-dependency-reference-target-mismatch",
        message: `Direct dependency ${dependency.fromMemberId} selector resolves to ${[...resolvedTargetMemberIds].join(", ")}, not its declared target ${dependency.toMemberId}; requirement=${dependency.requirement}, parity=${dependency.parity}.`,
      });
    }
  }

  let sourceReferences: SourceDependencyReference[] = [];
  try {
    sourceReferences = await collectSourceDependencyReferences(
      rootDir,
      members,
      memberEntriesById,
    );
  } catch (error: unknown) {
    if (!(error instanceof PortableBaselinePathContainmentError)) throw error;
    findings.push({
      code: "source-dependency-root-outside-root",
      message:
        "The repository skill discovery root resolves outside the repository root.",
      path: error.relativePath,
    });
  }
  for (const mapping of SOURCE_BOUND_REFERENCE_FREE_DEPENDENCY_BINDINGS) {
    const sourceMember = memberById.get(mapping.fromMemberId);
    if (!sourceMember) {
      findings.push({
        code: "source-routing-mapping-member-missing",
        message: `Generic router mapping source ${mapping.fromMemberId} is not in the bounded closure.`,
      });
      continue;
    }
    if (rejectedMemberIds.has(sourceMember.id)) continue;
    const entries = memberEntriesById.get(sourceMember.id) ?? [];
    let selectorPath: string | undefined;
    for (const entry of entries) {
      if (entry.kind === "symlink") continue;
      try {
        if (
          (await readFile(path.join(rootDir, entry.path), "utf8")).includes(
            mapping.selector,
          )
        ) {
          selectorPath = entry.path;
          break;
        }
      } catch {
        continue;
      }
    }
    if (!selectorPath) {
      findings.push({
        code: "source-routing-selector-drift",
        message: `Generic router mapping ${mapping.fromMemberId} -> ${mapping.reference} no longer matches its exact source selector.`,
        path: sourceMember.path,
      });
      continue;
    }
    if (
      !sourceReferences.some(
        (reference) =>
          reference.fromMemberId === mapping.fromMemberId &&
          reference.reference === mapping.reference,
      )
    ) {
      sourceReferences.push({
        fromMemberId: mapping.fromMemberId,
        reference: mapping.reference,
        path: selectorPath,
      });
    }
  }
  const directDependencyPairs = new Set(
    directDependencies.map(
      (dependency) => `${dependency.fromMemberId}\0${dependency.toMemberId}`,
    ),
  );
  const discoveredReferenceKeys = new Set(
    sourceReferences.map(
      (reference) => `${reference.fromMemberId}\0${reference.reference}`,
    ),
  );
  for (const reference of sourceReferences) {
    const sourceMember = memberById.get(reference.fromMemberId);
    if (!sourceMember) continue;
    const targetPath = await resolveCheckedReferenceTargetPath(
      reference.reference,
    );
    const disposition = dispositionByReference.get(
      `${reference.fromMemberId}\0${reference.reference}`,
    );
    if (!targetPath) {
      if (
        !disposition ||
        (disposition.resolution !== "host-alias" &&
          disposition.resolution !== "lexical-non-dependency")
      ) {
        findings.push({
          code: "source-reference-unclassified",
          message: `Source member ${reference.fromMemberId} references ${reference.reference}, which is neither a repository skill/agent nor an explicit non-blocking alias or lexical exclusion.`,
          path: reference.path,
        });
      }
      continue;
    }
    const targetMember = findReferenceTargetMember(
      members,
      sourceMember,
      targetPath,
    );
    if (!targetMember) {
      if (!disposition || disposition.resolution !== "external-capability") {
        findings.push({
          code: "source-dependency-member-missing",
          message: `Source member ${reference.fromMemberId} references ${reference.reference} at ${targetPath}, but that dependency has no classified bounded member or explicit non-blocking external-capability disposition.`,
          path: reference.path,
        });
      }
      continue;
    }
    if (
      targetMember.id !== sourceMember.id &&
      !directDependencyPairs.has(`${sourceMember.id}\0${targetMember.id}`)
    ) {
      findings.push({
        code: "source-dependency-edge-missing",
        message: `Source member ${sourceMember.id} references classified dependency ${targetMember.id} via ${reference.reference}, but the source-derived edge is missing.`,
        path: reference.path,
      });
    }
  }
  for (const disposition of referenceDispositions) {
    const key = `${disposition.fromMemberId}\0${disposition.reference}`;
    if (!discoveredReferenceKeys.has(key)) {
      findings.push({
        code: "source-reference-disposition-stale",
        message: `Reference disposition ${disposition.fromMemberId} -> ${disposition.reference} no longer matches selected source content.`,
      });
    }
    const targetPath = await resolveCheckedReferenceTargetPath(
      disposition.reference,
    );
    if (disposition.resolution === "lexical-non-dependency" && targetPath) {
      findings.push({
        code: "source-reference-lexical-exclusion-invalid",
        message: `Reference ${disposition.reference} resolves to ${targetPath} and cannot be excluded as lexical-only.`,
      });
    }
    if (disposition.resolution === "external-capability" && !targetPath) {
      findings.push({
        code: "source-reference-external-capability-missing",
        message: `External capability ${disposition.reference} no longer resolves to a repository skill or agent source.`,
      });
    }
  }

  if (!overlayMap.outOfScopeInventory.noMigrationCommitment) {
    findings.push({
      code: "inventory-implies-migration",
      message:
        "Residual discovery inventory must explicitly carry no migration commitment.",
    });
  }
  if (
    overlayMap.outOfScopeInventory.description !==
    REQUIRED_RESIDUAL_INVENTORY_DESCRIPTION
  ) {
    findings.push({
      code: "inventory-description-contract-mismatch",
      message:
        "Residual inventory must preserve the exact bounded no-migration description.",
    });
  }
  const discoveryRootPaths = baseline.discoveryRoots
    .map((root) => root.path)
    .sort(compareUtf8Bytes);
  const inventoryRootPaths = [...overlayMap.outOfScopeInventory.scanRoots].sort(
    compareUtf8Bytes,
  );
  if (
    JSON.stringify(discoveryRootPaths) !== JSON.stringify(inventoryRootPaths)
  ) {
    findings.push({
      code: "inventory-root-mismatch",
      message:
        "Residual inventory must scan every recorded workflow discovery root.",
    });
  }
  const classifiedPaths = resolvedMemberIdentities.map(
    (resolved) => resolved.identityPath,
  );
  const safeInventoryRoots = overlayMap.outOfScopeInventory.scanRoots.filter(
    (scanRoot) => {
      if (isSafeRelativePath(scanRoot)) return true;
      findings.push({
        code: "inventory-root-path-unsafe",
        message: `Inventory scan root ${scanRoot} is unsafe.`,
        path: scanRoot,
      });
      return false;
    },
  );
  const collectedInventoryEntries: TreeEntry[] = [];
  for (const scanRoot of safeInventoryRoots) {
    try {
      collectedInventoryEntries.push(
        ...(await collectTreeEntries(rootDir, scanRoot)),
      );
    } catch (error: unknown) {
      if (error instanceof PortableBaselinePathContainmentError) {
        findings.push({
          code: "inventory-root-path-outside-root",
          message: `Inventory root ${scanRoot} resolves outside the repository root.`,
          path: scanRoot,
        });
        continue;
      }
      throw error;
    }
  }
  const inventoryEntries = collectedInventoryEntries.filter(
    (entry) =>
      !classifiedPaths.some(
        (classifiedPath) =>
          entry.path === classifiedPath ||
          entry.path.startsWith(`${classifiedPath}/`),
      ),
  );
  const residualSymlink = inventoryEntries.find(
    (entry) => entry.kind === "symlink",
  );
  if (residualSymlink) {
    findings.push({
      code: "inventory-symlink-unsupported",
      message:
        "Residual discovery inventory contains a symlink and cannot certify stable content identity.",
      path: residualSymlink.path,
    });
  }
  if (inventoryEntries.length !== overlayMap.outOfScopeInventory.fileCount) {
    findings.push({
      code: "inventory-count-drift",
      message: `Residual discovery inventory has ${inventoryEntries.length} files, expected ${overlayMap.outOfScopeInventory.fileCount}.`,
    });
  }
  if (
    digestTreeEntries(inventoryEntries) !==
    overlayMap.outOfScopeInventory.treeDigest
  ) {
    findings.push({
      code: "inventory-digest-drift",
      message:
        "Residual discovery inventory no longer matches its tree digest.",
    });
  }

  const scenarioIds = scenarios
    .map((scenario) => scenario.id)
    .sort(compareUtf8Bytes);
  pushDuplicateFindings(
    findings,
    scenarioIds,
    "scenario-id-duplicate",
    "Scenario id",
  );
  for (const requiredScenario of Object.keys(REQUIRED_SCENARIO_CONTRACTS)) {
    if (!scenarioIds.includes(requiredScenario)) {
      findings.push({
        code: "scenario-required-missing",
        message: `Required characterization scenario ${requiredScenario} is missing.`,
      });
    }
  }
  for (const scenario of scenarios) {
    if (scenario.schemaVersion !== SCENARIO_SCHEMA_VERSION) {
      findings.push({
        code: "scenario-schema-unsupported",
        message: `Scenario ${scenario.id} has unsupported schema ${scenario.schemaVersion}.`,
      });
    }
    if (!REQUEST_KINDS.has(scenario.requestKind)) {
      findings.push({
        code: "scenario-request-kind-invalid",
        message: `Scenario ${scenario.id} has unsupported requestKind ${JSON.stringify(scenario.requestKind)}.`,
      });
    }
    if (scenario.expectedAssertionIds.length === 0) {
      findings.push({
        code: "scenario-assertions-empty",
        message: `Scenario ${scenario.id} must expect at least one assertion.`,
      });
    }
    if (scenario.expectedClassificationIds.length === 0) {
      findings.push({
        code: "scenario-classifications-empty",
        message: `Scenario ${scenario.id} must expect at least one classification.`,
      });
    }
    const requiredContract =
      REQUIRED_SCENARIO_CONTRACTS[
        scenario.id as keyof typeof REQUIRED_SCENARIO_CONTRACTS
      ];
    if (requiredContract) {
      if (scenario.requestKind !== requiredContract.requestKind) {
        findings.push({
          code: "scenario-contract-request-kind-mismatch",
          message: `Scenario ${scenario.id} must retain requestKind ${requiredContract.requestKind}.`,
        });
      }
      if (
        JSON.stringify(scenario.expectedAssertionIds) !==
          JSON.stringify(requiredContract.assertionIds) ||
        JSON.stringify(scenario.expectedClassificationIds) !==
          JSON.stringify(requiredContract.classificationIds)
      ) {
        findings.push({
          code: "scenario-contract-coverage-mismatch",
          message: `Scenario ${scenario.id} must preserve its exact ordered assertion and classification coverage.`,
        });
      }
      for (const assertionId of requiredContract.assertionIds) {
        if (!scenario.expectedAssertionIds.includes(assertionId)) {
          findings.push({
            code: "scenario-contract-assertion-missing",
            message: `Scenario ${scenario.id} no longer requires assertion ${assertionId}.`,
          });
        }
      }
      for (const classificationId of requiredContract.classificationIds) {
        if (!scenario.expectedClassificationIds.includes(classificationId)) {
          findings.push({
            code: "scenario-contract-classification-missing",
            message: `Scenario ${scenario.id} no longer requires classification ${classificationId}.`,
          });
        }
      }
    }
    for (const assertionId of scenario.expectedAssertionIds) {
      if (!assertionIds.has(assertionId)) {
        findings.push({
          code: "scenario-assertion-missing",
          message: `Scenario ${scenario.id} cites unknown assertion ${assertionId}.`,
        });
      }
    }
    for (const classificationId of scenario.expectedClassificationIds) {
      if (!classificationById.has(classificationId)) {
        findings.push({
          code: "scenario-classification-missing",
          message: `Scenario ${scenario.id} cites unknown classification ${classificationId}.`,
        });
      }
    }
    const scenarioClassificationAssertionIds = new Set(
      scenario.expectedClassificationIds.flatMap(
        (classificationId) =>
          classificationById.get(classificationId)?.assertionIds ?? [],
      ),
    );
    for (const assertionId of scenario.expectedAssertionIds) {
      if (!scenarioClassificationAssertionIds.has(assertionId)) {
        findings.push({
          code: "scenario-assertion-classification-mismatch",
          message: `Scenario ${scenario.id} expects assertion ${assertionId}, but none of its expected classifications covers that assertion.`,
        });
      }
    }
  }

  const loadedFixturePaths = (await loadScenarios(rootDir)).fixturePaths;
  if (
    JSON.stringify(loadedFixturePaths) !==
    JSON.stringify([...baseline.scenarioFixtures].sort())
  ) {
    findings.push({
      code: "scenario-inventory-drift",
      message:
        "Baseline scenario fixture inventory does not match the checked fixture files.",
    });
  }

  if (
    classificationById.get("tracker-neutral-capability-contract")
      ?.classification !== "portable-candidate"
  ) {
    findings.push({
      code: "tracker-neutral-classification-invalid",
      message: "Tracker-neutral behavior must remain a portable candidate.",
    });
  }
  if (
    classificationById.get("linear-tracker-adapter")?.classification !==
    "optional-adapter"
  ) {
    findings.push({
      code: "linear-classification-invalid",
      message: "Linear behavior must remain an optional adapter.",
    });
  }
  for (const classificationId of REQUIRED_ATHENA_OVERLAYS) {
    if (
      classificationById.get(classificationId)?.classification !==
      "retained-overlay"
    ) {
      findings.push({
        code: "athena-overlay-classification-invalid",
        message: `${classificationId} must remain a retained Athena overlay.`,
      });
    }
  }

  const ok = findings.length === 0;
  const sourceBackedAssertionCount = baseline.assertions.filter(
    (assertion) => assertion.authority === "source-backed",
  ).length;
  return {
    ok,
    findings,
    scenarioIds,
    summary: ok
      ? `[portable-baseline] Validated ${sourceBackedAssertionCount} source-backed assertions, ${members.length} bounded-closure members, ${scenarioIds.length} characterization scenarios, and ${inventoryEntries.length} out-of-scope discovery files.`
      : `[portable-baseline] Found ${findings.length} baseline/parity issue(s).`,
  };
}

if (import.meta.main) {
  try {
    const result = await auditPortableWorkflowBaseline(
      path.resolve(import.meta.dirname, ".."),
    );
    if (!result.ok) {
      for (const finding of result.findings) {
        console.error(`[${finding.code}] ${finding.message}`);
      }
      process.exitCode = 1;
    } else {
      console.log(result.summary);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
