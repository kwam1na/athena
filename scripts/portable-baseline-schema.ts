import type {
  PortableBaselineDocuments,
  PortableBaselineFinding,
} from "./portable-baseline-check";

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
const CLASSIFICATIONS = new Set([
  "portable-candidate",
  "retained-overlay",
  "optional-adapter",
  "excluded",
]);
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

function validateBaseline(value: unknown, findings: PortableBaselineFinding[]) {
  const context: ShapeContext = { family: "baseline", findings };
  const baseline = expectRecord(value, context, "baseline");
  if (!baseline) return;
  expectNonEmptyString(
    baseline.schemaVersion,
    context,
    "baseline.schemaVersion",
  );
  expectNonEmptyString(baseline.baselineId, context, "baseline.baselineId");

  const discoveryRoots = expectArray(
    baseline.discoveryRoots,
    context,
    "baseline.discoveryRoots",
  );
  discoveryRoots?.forEach((entry, index) => {
    const fieldPath = `baseline.discoveryRoots[${index}]`;
    const root = expectRecord(entry, context, fieldPath);
    if (!root) return;
    expectNonEmptyString(root.path, context, `${fieldPath}.path`);
    expectEnum(root.state, DISCOVERY_STATES, context, `${fieldPath}.state`);
  });

  const sources = expectArray(baseline.sources, context, "baseline.sources");
  sources?.forEach((entry, index) => {
    const fieldPath = `baseline.sources[${index}]`;
    const source = expectRecord(entry, context, fieldPath);
    if (!source) return;
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
  expectNonEmptyString(
    overlay.schemaVersion,
    context,
    "overlayMap.schemaVersion",
  );
  expectNonEmptyString(overlay.baselineId, context, "overlayMap.baselineId");

  const classifications = expectArray(
    overlay.classifications,
    context,
    "overlayMap.classifications",
  );
  classifications?.forEach((entry, index) => {
    const fieldPath = `overlayMap.classifications[${index}]`;
    const classification = expectRecord(entry, context, fieldPath);
    if (!classification) return;
    expectNonEmptyString(classification.id, context, `${fieldPath}.id`);
    expectEnum(
      classification.classification,
      CLASSIFICATIONS,
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
    const members = expectArray(
      closure.members,
      context,
      "overlayMap.boundedClosure.members",
    );
    members?.forEach((entry, index) => {
      const fieldPath = `overlayMap.boundedClosure.members[${index}]`;
      const member = expectRecord(entry, context, fieldPath);
      if (!member) return;
      expectNonEmptyString(member.id, context, `${fieldPath}.id`);
      expectEnum(member.kind, MEMBER_KINDS, context, `${fieldPath}.kind`);
      expectNonEmptyString(member.path, context, `${fieldPath}.path`);
      expectEnum(
        member.classification,
        CLASSIFICATIONS,
        context,
        `${fieldPath}.classification`,
      );
      expectNonNegativeInteger(
        member.fileCount,
        context,
        `${fieldPath}.fileCount`,
      );
      expectDigest(member.treeDigest, context, `${fieldPath}.treeDigest`);
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
    if (typeof inventory.noMigrationCommitment !== "boolean") {
      report(
        context,
        "overlayMap.outOfScopeInventory.noMigrationCommitment",
        "must be a boolean",
      );
    }
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
    expectNonEmptyString(
      scenario.schemaVersion,
      context,
      `${fieldPath}.schemaVersion`,
    );
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
  validateBaseline(documents.baseline, findings);
  validateOverlay(documents.overlayMap, findings);
  validateScenarios(documents.scenarios, findings);
  if (findings.length > 0) return { findings };

  // Every field consumed by the audit has been checked above before this cast.
  return { documents: value as PortableBaselineDocuments, findings };
}
