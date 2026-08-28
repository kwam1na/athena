import type {
  PortableBaselineDocuments,
  PortableBaselineFinding,
} from "./portable-baseline-check";

const BASELINE_SCHEMA_VERSION = "athena-portable-characterization-baseline/1";
const OVERLAY_SCHEMA_VERSION = "athena-portable-overlay-map/1";
const SCENARIO_SCHEMA_VERSION = "athena-portable-characterization-scenario/1";
const BASELINE_ID = "athena-portable-workflows-v1-2026-08-27";
const CAPTURED_FOR = "V26-1413";

const SOURCE_KINDS = new Set([
  "approved-plan",
  "approved-requirements",
  "enforcement-policy",
  "repository-policy",
  "workflow-policy",
]);
const APPROVAL_SOURCE_KINDS = new Set([
  "approved-plan",
  "approved-requirements",
]);
const AUTHORITIES = new Set([
  "source-backed",
  "explicitly-approved",
  "observed-only",
]);
const PARITIES = new Set(["blocking", "non-blocking"]);
const ADJUDICATIONS = new Set(["policy-backed", "approved", "unadjudicated"]);
const DISCOVERY_STATES = new Set(["present", "absent"]);
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
const CLASSIFICATION_SEMANTICS = {
  "portable-candidate":
    "A digest-bound source or rule slice for downstream extraction and cross-host proof; this does not authorize wholesale migration.",
  "retained-overlay":
    "Athena-owned policy or enforcement that remains mandatory locally.",
  "optional-adapter":
    "Tracker or host-specific behavior that may implement a neutral capability without entering the core.",
  excluded:
    "Domain or dependency material outside the bounded portable v1 corpus.",
} as const;
const MEMBER_KINDS = new Set(["skill-bundle", "dependency-bundle"]);
const DEPENDENCY_REQUIREMENTS = new Set([
  "required",
  "conditional",
  "routing",
  "host-alias",
  "contextual",
]);
const DISPOSITION_RESOLUTIONS = new Set([
  "external-capability",
  "host-alias",
  "lexical-non-dependency",
]);
const DISPOSITION_PARITIES = new Set(["non-blocking"]);
const REQUEST_KINDS = new Set([
  "compounding",
  "configured-enforcement",
  "implementation",
  "planning",
  "review",
  "routing",
  "tracking",
]);
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;

type DocumentFamily = "baseline" | "overlay" | "scenario";
type ShapeContext = {
  family: DocumentFamily;
  findings: PortableBaselineFinding[];
};

function findingCode(family: DocumentFamily) {
  return `${family}-document-shape-invalid`;
}

function report(context: ShapeContext, fieldPath: string, message: string) {
  context.findings.push({
    code: findingCode(context.family),
    message: `${fieldPath}: ${message}`,
    path: fieldPath,
  });
}

function expectRecord(
  value: unknown,
  context: ShapeContext,
  fieldPath: string,
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    report(context, fieldPath, "must be an object");
    return undefined;
  }
  return value as Record<string, unknown>;
}

function expectExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  context: ShapeContext,
  fieldPath: string,
) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      report(context, `${fieldPath}.${key}`, "is not an allowed field");
    }
  }
}

function expectArray(
  value: unknown,
  context: ShapeContext,
  fieldPath: string,
): unknown[] | undefined {
  if (!Array.isArray(value)) {
    report(context, fieldPath, "must be an array");
    return undefined;
  }
  return value;
}

function expectNonEmptyString(
  value: unknown,
  context: ShapeContext,
  fieldPath: string,
) {
  if (typeof value !== "string" || value.trim().length === 0) {
    report(context, fieldPath, "must be a non-empty string");
    return undefined;
  }
  return value;
}

function expectEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  context: ShapeContext,
  fieldPath: string,
) {
  const stringValue = expectNonEmptyString(value, context, fieldPath);
  if (stringValue !== undefined && !allowed.has(stringValue)) {
    report(
      context,
      fieldPath,
      `has unsupported value ${JSON.stringify(value)}`,
    );
  }
}

function expectStringArray(
  value: unknown,
  context: ShapeContext,
  fieldPath: string,
) {
  const values = expectArray(value, context, fieldPath);
  if (!values) return;
  values.forEach((entry, index) =>
    expectNonEmptyString(entry, context, `${fieldPath}[${index}]`),
  );
}

function expectNonNegativeInteger(
  value: unknown,
  context: ShapeContext,
  fieldPath: string,
) {
  if (!Number.isInteger(value) || (value as number) < 0) {
    report(context, fieldPath, "must be a non-negative integer");
  }
}

function expectDigest(
  value: unknown,
  context: ShapeContext,
  fieldPath: string,
) {
  if (typeof value !== "string" || !LOWERCASE_SHA256.test(value)) {
    report(
      context,
      fieldPath,
      "must be a 64-character lowercase SHA-256 digest",
    );
  }
}

function expectLiteral(
  value: unknown,
  expected: string | boolean,
  context: ShapeContext,
  fieldPath: string,
) {
  if (value !== expected) {
    report(context, fieldPath, `must equal ${JSON.stringify(expected)}`);
  }
}

function validateBaseline(value: unknown, findings: PortableBaselineFinding[]) {
  const context: ShapeContext = { family: "baseline", findings };
  const baseline = expectRecord(value, context, "baseline");
  if (!baseline) return;
  expectExactKeys(
    baseline,
    [
      "schemaVersion",
      "baselineId",
      "capturedFor",
      "readOnly",
      "discoveryRoots",
      "sources",
      "assertions",
      "scenarioFixtures",
    ],
    context,
    "baseline",
  );
  expectLiteral(
    baseline.schemaVersion,
    BASELINE_SCHEMA_VERSION,
    context,
    "baseline.schemaVersion",
  );
  expectLiteral(
    baseline.baselineId,
    BASELINE_ID,
    context,
    "baseline.baselineId",
  );
  expectLiteral(
    baseline.capturedFor,
    CAPTURED_FOR,
    context,
    "baseline.capturedFor",
  );
  expectLiteral(baseline.readOnly, true, context, "baseline.readOnly");

  const discoveryRoots = expectArray(
    baseline.discoveryRoots,
    context,
    "baseline.discoveryRoots",
  );
  discoveryRoots?.forEach((entry, index) => {
    const fieldPath = `baseline.discoveryRoots[${index}]`;
    const root = expectRecord(entry, context, fieldPath);
    if (!root) return;
    expectExactKeys(root, ["path", "state"], context, fieldPath);
    expectNonEmptyString(root.path, context, `${fieldPath}.path`);
    expectEnum(root.state, DISCOVERY_STATES, context, `${fieldPath}.state`);
  });

  const sources = expectArray(baseline.sources, context, "baseline.sources");
  sources?.forEach((entry, index) => {
    const fieldPath = `baseline.sources[${index}]`;
    const source = expectRecord(entry, context, fieldPath);
    if (!source) return;
    expectExactKeys(
      source,
      ["id", "path", "kind", "sha256"],
      context,
      fieldPath,
    );
    expectNonEmptyString(source.id, context, `${fieldPath}.id`);
    expectNonEmptyString(source.path, context, `${fieldPath}.path`);
    expectEnum(source.kind, SOURCE_KINDS, context, `${fieldPath}.kind`);
    expectDigest(source.sha256, context, `${fieldPath}.sha256`);
  });

  const assertions = expectArray(
    baseline.assertions,
    context,
    "baseline.assertions",
  );
  assertions?.forEach((entry, index) => {
    const fieldPath = `baseline.assertions[${index}]`;
    const assertion = expectRecord(entry, context, fieldPath);
    if (!assertion) return;
    expectExactKeys(
      assertion,
      [
        "id",
        "area",
        "statement",
        "authority",
        "parity",
        "adjudication",
        "citations",
      ],
      context,
      fieldPath,
    );
    expectNonEmptyString(assertion.id, context, `${fieldPath}.id`);
    expectNonEmptyString(assertion.area, context, `${fieldPath}.area`);
    expectNonEmptyString(
      assertion.statement,
      context,
      `${fieldPath}.statement`,
    );
    expectEnum(
      assertion.authority,
      AUTHORITIES,
      context,
      `${fieldPath}.authority`,
    );
    expectEnum(assertion.parity, PARITIES, context, `${fieldPath}.parity`);
    expectEnum(
      assertion.adjudication,
      ADJUDICATIONS,
      context,
      `${fieldPath}.adjudication`,
    );
    const citations = expectArray(
      assertion.citations,
      context,
      `${fieldPath}.citations`,
    );
    citations?.forEach((citationEntry, citationIndex) => {
      const citationPath = `${fieldPath}.citations[${citationIndex}]`;
      const citation = expectRecord(citationEntry, context, citationPath);
      if (!citation) return;
      expectExactKeys(
        citation,
        ["sourceId", "selector"],
        context,
        citationPath,
      );
      expectNonEmptyString(
        citation.sourceId,
        context,
        `${citationPath}.sourceId`,
      );
      expectNonEmptyString(
        citation.selector,
        context,
        `${citationPath}.selector`,
      );
    });
  });
  expectStringArray(
    baseline.scenarioFixtures,
    context,
    "baseline.scenarioFixtures",
  );
}

function validateOverlay(value: unknown, findings: PortableBaselineFinding[]) {
  const context: ShapeContext = { family: "overlay", findings };
  const overlay = expectRecord(value, context, "overlayMap");
  if (!overlay) return;
  expectExactKeys(
    overlay,
    [
      "schemaVersion",
      "baselineId",
      "readOnly",
      "classificationSemantics",
      "classifications",
      "boundedClosure",
      "outOfScopeInventory",
    ],
    context,
    "overlayMap",
  );
  expectLiteral(
    overlay.schemaVersion,
    OVERLAY_SCHEMA_VERSION,
    context,
    "overlayMap.schemaVersion",
  );
  expectLiteral(
    overlay.baselineId,
    BASELINE_ID,
    context,
    "overlayMap.baselineId",
  );
  expectLiteral(overlay.readOnly, true, context, "overlayMap.readOnly");

  const classificationSemantics = expectRecord(
    overlay.classificationSemantics,
    context,
    "overlayMap.classificationSemantics",
  );
  if (classificationSemantics) {
    expectExactKeys(
      classificationSemantics,
      Object.keys(CLASSIFICATION_SEMANTICS),
      context,
      "overlayMap.classificationSemantics",
    );
    for (const [classification, semantics] of Object.entries(
      CLASSIFICATION_SEMANTICS,
    )) {
      expectLiteral(
        classificationSemantics[classification],
        semantics,
        context,
        `overlayMap.classificationSemantics.${classification}`,
      );
    }
  }

  const classifications = expectArray(
    overlay.classifications,
    context,
    "overlayMap.classifications",
  );
  classifications?.forEach((entry, index) => {
    const fieldPath = `overlayMap.classifications[${index}]`;
    const classification = expectRecord(entry, context, fieldPath);
    if (!classification) return;
    expectExactKeys(
      classification,
      ["id", "classification", "rationale", "assertionIds"],
      context,
      fieldPath,
    );
    expectNonEmptyString(classification.id, context, `${fieldPath}.id`);
    expectEnum(
      classification.classification,
      RULE_CLASSIFICATIONS,
      context,
      `${fieldPath}.classification`,
    );
    expectNonEmptyString(
      classification.rationale,
      context,
      `${fieldPath}.rationale`,
    );
    expectStringArray(
      classification.assertionIds,
      context,
      `${fieldPath}.assertionIds`,
    );
  });

  const closure = expectRecord(
    overlay.boundedClosure,
    context,
    "overlayMap.boundedClosure",
  );
  if (closure) {
    expectExactKeys(
      closure,
      [
        "members",
        "auditedMemberIds",
        "directDependencies",
        "referenceDispositions",
      ],
      context,
      "overlayMap.boundedClosure",
    );
    const members = expectArray(
      closure.members,
      context,
      "overlayMap.boundedClosure.members",
    );
    members?.forEach((entry, index) => {
      const fieldPath = `overlayMap.boundedClosure.members[${index}]`;
      const member = expectRecord(entry, context, fieldPath);
      if (!member) return;
      expectExactKeys(
        member,
        [
          "id",
          "kind",
          "path",
          "classification",
          "fileCount",
          "treeDigest",
          "note",
        ],
        context,
        fieldPath,
      );
      expectNonEmptyString(member.id, context, `${fieldPath}.id`);
      expectEnum(member.kind, MEMBER_KINDS, context, `${fieldPath}.kind`);
      expectNonEmptyString(member.path, context, `${fieldPath}.path`);
      expectEnum(
        member.classification,
        MEMBER_CLASSIFICATIONS,
        context,
        `${fieldPath}.classification`,
      );
      expectNonNegativeInteger(
        member.fileCount,
        context,
        `${fieldPath}.fileCount`,
      );
      expectDigest(member.treeDigest, context, `${fieldPath}.treeDigest`);
      if (member.note !== undefined) {
        expectNonEmptyString(member.note, context, `${fieldPath}.note`);
      }
    });
    expectStringArray(
      closure.auditedMemberIds,
      context,
      "overlayMap.boundedClosure.auditedMemberIds",
    );

    const dependencies = expectArray(
      closure.directDependencies,
      context,
      "overlayMap.boundedClosure.directDependencies",
    );
    dependencies?.forEach((entry, index) => {
      const fieldPath = `overlayMap.boundedClosure.directDependencies[${index}]`;
      const dependency = expectRecord(entry, context, fieldPath);
      if (!dependency) return;
      expectExactKeys(
        dependency,
        ["fromMemberId", "toMemberId", "selector", "requirement", "parity"],
        context,
        fieldPath,
      );
      expectNonEmptyString(
        dependency.fromMemberId,
        context,
        `${fieldPath}.fromMemberId`,
      );
      expectNonEmptyString(
        dependency.toMemberId,
        context,
        `${fieldPath}.toMemberId`,
      );
      expectNonEmptyString(
        dependency.selector,
        context,
        `${fieldPath}.selector`,
      );
      expectEnum(
        dependency.requirement,
        DEPENDENCY_REQUIREMENTS,
        context,
        `${fieldPath}.requirement`,
      );
      expectEnum(dependency.parity, PARITIES, context, `${fieldPath}.parity`);
    });

    const dispositions = expectArray(
      closure.referenceDispositions,
      context,
      "overlayMap.boundedClosure.referenceDispositions",
    );
    dispositions?.forEach((entry, index) => {
      const fieldPath = `overlayMap.boundedClosure.referenceDispositions[${index}]`;
      const disposition = expectRecord(entry, context, fieldPath);
      if (!disposition) return;
      expectExactKeys(
        disposition,
        [
          "fromMemberId",
          "reference",
          "resolution",
          "parity",
          "mappedMemberId",
          "rationale",
        ],
        context,
        fieldPath,
      );
      expectNonEmptyString(
        disposition.fromMemberId,
        context,
        `${fieldPath}.fromMemberId`,
      );
      expectNonEmptyString(
        disposition.reference,
        context,
        `${fieldPath}.reference`,
      );
      expectEnum(
        disposition.resolution,
        DISPOSITION_RESOLUTIONS,
        context,
        `${fieldPath}.resolution`,
      );
      expectEnum(
        disposition.parity,
        DISPOSITION_PARITIES,
        context,
        `${fieldPath}.parity`,
      );
      if (disposition.mappedMemberId !== undefined) {
        expectNonEmptyString(
          disposition.mappedMemberId,
          context,
          `${fieldPath}.mappedMemberId`,
        );
      }
      expectNonEmptyString(
        disposition.rationale,
        context,
        `${fieldPath}.rationale`,
      );
    });
  }

  const inventory = expectRecord(
    overlay.outOfScopeInventory,
    context,
    "overlayMap.outOfScopeInventory",
  );
  if (inventory) {
    expectExactKeys(
      inventory,
      [
        "scanRoots",
        "fileCount",
        "treeDigest",
        "noMigrationCommitment",
        "description",
      ],
      context,
      "overlayMap.outOfScopeInventory",
    );
    expectStringArray(
      inventory.scanRoots,
      context,
      "overlayMap.outOfScopeInventory.scanRoots",
    );
    expectNonNegativeInteger(
      inventory.fileCount,
      context,
      "overlayMap.outOfScopeInventory.fileCount",
    );
    expectDigest(
      inventory.treeDigest,
      context,
      "overlayMap.outOfScopeInventory.treeDigest",
    );
    expectLiteral(
      inventory.noMigrationCommitment,
      true,
      context,
      "overlayMap.outOfScopeInventory.noMigrationCommitment",
    );
    expectNonEmptyString(
      inventory.description,
      context,
      "overlayMap.outOfScopeInventory.description",
    );
  }
}

function validateScenarios(
  value: unknown,
  findings: PortableBaselineFinding[],
) {
  const context: ShapeContext = { family: "scenario", findings };
  const scenarios = expectArray(value, context, "scenarios");
  scenarios?.forEach((entry, index) => {
    const fieldPath = `scenarios[${index}]`;
    const scenario = expectRecord(entry, context, fieldPath);
    if (!scenario) return;
    expectExactKeys(
      scenario,
      [
        "schemaVersion",
        "readOnly",
        "id",
        "requestKind",
        "expectedAssertionIds",
        "expectedClassificationIds",
      ],
      context,
      fieldPath,
    );
    expectLiteral(
      scenario.schemaVersion,
      SCENARIO_SCHEMA_VERSION,
      context,
      `${fieldPath}.schemaVersion`,
    );
    expectLiteral(scenario.readOnly, true, context, `${fieldPath}.readOnly`);
    expectNonEmptyString(scenario.id, context, `${fieldPath}.id`);
    expectEnum(
      scenario.requestKind,
      REQUEST_KINDS,
      context,
      `${fieldPath}.requestKind`,
    );
    expectStringArray(
      scenario.expectedAssertionIds,
      context,
      `${fieldPath}.expectedAssertionIds`,
    );
    expectStringArray(
      scenario.expectedClassificationIds,
      context,
      `${fieldPath}.expectedClassificationIds`,
    );
  });
}

export function isApprovalSourceKind(value: unknown) {
  return typeof value === "string" && APPROVAL_SOURCE_KINDS.has(value);
}

export class PortableBaselineDocumentValidationError extends Error {
  constructor(readonly findings: PortableBaselineFinding[]) {
    super(
      `Portable baseline documents failed shape validation with ${findings.length} finding(s).`,
    );
    this.name = "PortableBaselineDocumentValidationError";
  }
}

export function validatePortableBaselineDocuments(value: unknown): {
  documents?: PortableBaselineDocuments;
  findings: PortableBaselineFinding[];
} {
  const findings: PortableBaselineFinding[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    findings.push({
      code: "baseline-document-shape-invalid",
      message: "documents: must be an object",
      path: "documents",
    });
    return { findings };
  }
  const documents = value as Record<string, unknown>;
  expectExactKeys(
    documents,
    ["baseline", "overlayMap", "scenarios"],
    { family: "baseline", findings },
    "documents",
  );
  validateBaseline(documents.baseline, findings);
  validateOverlay(documents.overlayMap, findings);
  validateScenarios(documents.scenarios, findings);
  if (findings.length > 0) return { findings };

  // Every field consumed by the audit has been checked above before this cast.
  return { documents: value as PortableBaselineDocuments, findings };
}
