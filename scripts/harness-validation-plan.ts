import { createHash } from "node:crypto";
import {
  resolveValidationImpact,
  validateImpactPolicy,
  type ValidationSnapshots,
} from "./harness-validation-impact";
import {
  type CanonicalValidationCheck,
  type CanonicalValidationRegistry,
  VALIDATION_PLAN_POLICY,
} from "./harness-app-registry";

export type ValidationPlanMode = "delivery" | "comparison" | "full-health";
export type ValidationChange = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
};
export type PlannedValidationCheck = CanonicalValidationCheck & {
  /** Fingerprint of declarations and membership, not captured file bytes or evidence. */
  identity: string;
  reasons: string[];
  coveredChecks: string[];
};
export type ValidationPlan = {
  schemaVersion: typeof VALIDATION_PLAN_POLICY.schemaVersion;
  authority: "legacy-gate";
  mode: ValidationPlanMode;
  changes: ValidationChange[];
  checks: PlannedValidationCheck[];
  digest: string;
  evidence: "not-evaluated";
};
export type ValidationPlanDiagnostic =
  | "malformed-map"
  | "unknown-check"
  | "cyclic-prerequisite"
  | "uncovered-input"
  | "empty-plan"
  | "invalid-supersession";
export class ValidationPlanError extends Error {
  constructor(
    readonly code: ValidationPlanDiagnostic,
    message: string,
  ) {
    super(message);
    this.name = "ValidationPlanError";
  }
}
const sorted = (values: string[]) => [...new Set(values)].sort();
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (code: ValidationPlanDiagnostic, message: string): never => {
  throw new ValidationPlanError(code, message);
};
const validPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.split("/").includes("..") &&
  !/[\x00-\x1f]/.test(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === "string" && entry.length > 0);
const matches = (file: string, prefix: string) =>
  file === prefix || file.startsWith(`${prefix}/`);

export function validateCanonicalRegistry(
  value: unknown,
): asserts value is CanonicalValidationRegistry {
  const registry = value as CanonicalValidationRegistry;
  if (
    !registry ||
    registry.schemaVersion !== "athena-validation-registry/1" ||
    !Array.isArray(registry.checks) ||
    !Array.isArray(registry.surfaces) ||
    !strings(registry.alwaysRequired)
  )
    fail(
      "malformed-map",
      "Expected canonical registry version 1, checks, surfaces and alwaysRequired.",
    );
  const ids = new Set<string>();
  for (const check of registry.checks) {
    if (
      !check ||
      typeof check.id !== "string" ||
      !check.id ||
      ids.has(check.id) ||
      typeof check.profile !== "string" ||
      !check.profile ||
      !strings(check.argv) ||
      !check.argv.length ||
      !validPath(check.cwd) ||
      !strings(check.membership) ||
      !strings(check.inputs) ||
      !strings(check.absentInputs) ||
      !strings(check.prerequisites) ||
      !Array.isArray(check.supersedes) ||
      [...check.membership, ...check.inputs, ...check.absentInputs].some(
        (p) => !validPath(p),
      )
    )
      fail("malformed-map", "Invalid or duplicate check definition.");
    if (
      check.absentInputs.some(
        (p) => check.inputs.includes(p) || check.membership.includes(p),
      )
    )
      fail("malformed-map", `Conflicting presence and absence in ${check.id}.`);
    ids.add(check.id);
  }
  const requireCheck = (id: string) => {
    if (!ids.has(id)) fail("unknown-check", `Unknown check: ${id}`);
  };
  registry.alwaysRequired.forEach(requireCheck);
  const surfaces = new Set<string>();
  for (const surface of registry.surfaces) {
    if (
      !surface ||
      typeof surface.id !== "string" ||
      !surface.id ||
      surfaces.has(surface.id) ||
      !strings(surface.pathPrefixes) ||
      !surface.pathPrefixes.length ||
      surface.pathPrefixes.some((p) => !validPath(p)) ||
      !strings(surface.checks) ||
      !surface.checks.length ||
      typeof surface.reason !== "string" ||
      !surface.reason
    )
      fail("malformed-map", "Invalid or duplicate surface definition.");
    surfaces.add(surface.id);
    surface.checks.forEach(requireCheck);
  }
  const byId = new Map(registry.checks.map((check) => [check.id, check]));
  for (const check of registry.checks) {
    check.prerequisites.forEach(requireCheck);
    for (const declaration of check.supersedes) {
      if (!declaration || typeof declaration.checkId !== "string")
        fail("invalid-supersession", `Invalid supersession in ${check.id}.`);
      requireCheck(declaration.checkId);
      const other = byId.get(declaration.checkId)!;
      if (
        other.supersedes.length > 0 ||
        other.id === check.id ||
        declaration.profile !== other.profile ||
        other.profile !== check.profile ||
        typeof declaration.reason !== "string" ||
        !declaration.reason.trim() ||
        other.cwd !== check.cwd ||
        other.membership.some((file) => !check.membership.includes(file))
      )
        fail(
          "invalid-supersession",
          `Supersession must name an equivalent profile and contain its membership: ${check.id} -> ${other.id}.`,
        );
    }
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id))
      fail("cyclic-prerequisite", `Check prerequisite cycle includes ${id}.`);
    if (visited.has(id)) return;
    visiting.add(id);
    byId.get(id)!.prerequisites.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  registry.checks.forEach((check) => visit(check.id));
  validateImpactPolicy(registry);
}

/** Pure qualification planning: no check execution, receipt lookup, or admission decision. */
export function buildValidationPlan(
  registry: CanonicalValidationRegistry,
  changes: ValidationChange[],
  mode: ValidationPlanMode = "comparison",
  snapshots?: ValidationSnapshots,
): ValidationPlan {
  validateCanonicalRegistry(registry);
  if (!VALIDATION_PLAN_POLICY.modes.includes(mode))
    fail("malformed-map", `Unknown mode: ${mode}`);
  for (const change of changes)
    if (
      !change ||
      !validPath(change.path) ||
      !["added", "modified", "deleted", "renamed"].includes(change.status) ||
      (change.status === "renamed" && !validPath(change.oldPath)) ||
      (change.oldPath !== undefined &&
        (change.status !== "renamed" || !validPath(change.oldPath)))
    )
      fail("malformed-map", "Invalid semantic change.");
  if (snapshots !== undefined) {
    registry = resolveValidationImpact(
      registry,
      changes,
      snapshots,
      mode === "full-health",
    );
    validateCanonicalRegistry(registry);
  }
  const normalizedChanges = [
    ...new Map(
      changes.map(({ path, status, oldPath }) => {
        const change = { path, status, ...(oldPath ? { oldPath } : {}) };
        return [JSON.stringify(change), change] as const;
      }),
    ).values(),
  ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const byId = new Map(registry.checks.map((check) => [check.id, check]));
  const reasons = new Map<string, Set<string>>();
  const select = (id: string, reason: string) => {
    const existing = reasons.get(id) ?? new Set<string>();
    if (existing.has(reason)) return;
    existing.add(reason);
    reasons.set(id, existing);
    for (const prerequisite of byId.get(id)!.prerequisites)
      select(prerequisite, `Prerequisite of ${id}`);
  };
  registry.alwaysRequired.forEach((id) =>
    select(id, "Always required: plan integrity"),
  );
  if (mode === "full-health")
    registry.checks.forEach((check) =>
      select(
        check.id,
        "Full-health: complete registered inventory, independent of diff",
      ),
    );
  for (const change of normalizedChanges)
    for (const file of sorted([
      change.path,
      ...(change.oldPath ? [change.oldPath] : []),
    ])) {
      const surfaces = registry.surfaces.filter((surface) =>
        surface.pathPrefixes.some((prefix) => matches(file, prefix)),
      );
      if (!surfaces.length)
        fail(
          "uncovered-input",
          `No obligation covers ${change.status} input ${file}.`,
        );
      for (const surface of surfaces)
        surface.checks.forEach((id) =>
          select(id, `${surface.id}: ${surface.reason} (${file})`),
        );
    }
  if (!reasons.size)
    fail("empty-plan", "No required obligation justifies an empty plan.");
  const groups = new Map<string, PlannedValidationCheck>();
  for (const id of [...reasons.keys()].sort()) {
    const original = byId.get(id)!;
    const check: CanonicalValidationCheck = {
      ...original,
      membership: sorted(original.membership),
      inputs: sorted(original.inputs),
      absentInputs: sorted(original.absentInputs),
      prerequisites: sorted(original.prerequisites),
      supersedes: [...original.supersedes].sort((a, b) =>
        a.checkId.localeCompare(b.checkId),
      ),
    };
    // Only an exact argv/cwd/profile/input contract permits membership union.
    const key = hash({
      profile: check.profile,
      argv: check.argv,
      cwd: check.cwd,
      inputs: check.inputs,
      absentInputs: check.absentInputs,
      prerequisites: check.prerequisites,
      supersedes: check.supersedes,
    });
    const prior = groups.get(key);
    if (prior) {
      prior.membership = sorted([...prior.membership, ...check.membership]);
      prior.reasons = sorted([...prior.reasons, ...reasons.get(id)!]);
      prior.coveredChecks.push(id);
    } else
      groups.set(key, {
        ...check,
        identity: "",
        reasons: sorted([...reasons.get(id)!]),
        coveredChecks: [id],
      });
  }
  const checks = [...groups.values()];
  // Preserve prerequisite obligations: supersession is not a license to erase dependencies.
  const requiredPrerequisites = new Set(
    checks.flatMap((check) => check.prerequisites),
  );
  const superseded = new Set<string>();
  for (const check of checks)
    for (const declaration of check.supersedes) {
      if (requiredPrerequisites.has(declaration.checkId)) continue;
      const other = checks.find((entry) =>
        entry.coveredChecks.includes(declaration.checkId),
      );
      if (
        !other ||
        superseded.has(other.id) ||
        other === check ||
        other.coveredChecks.length !== 1
      )
        continue;
      superseded.add(other.id);
      check.reasons = sorted([
        ...check.reasons,
        ...other.reasons,
        `Supersedes ${other.id}: ${declaration.reason}`,
      ]);
      check.coveredChecks = sorted([...check.coveredChecks, other.id]);
    }
  const selected = checks
    .filter((check) => !superseded.has(check.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const check of selected)
    check.identity = hash({
      profile: check.profile,
      argv: check.argv,
      cwd: check.cwd,
      membership: check.membership,
      inputs: check.inputs,
      absentInputs: check.absentInputs,
      prerequisites: check.prerequisites,
      supersedes: check.supersedes,
    });
  const body = {
    schemaVersion: VALIDATION_PLAN_POLICY.schemaVersion,
    authority: "legacy-gate" as const,
    mode,
    changes: normalizedChanges,
    checks: selected,
    evidence: "not-evaluated" as const,
  };
  return { ...body, digest: hash(body) };
}

export function renderValidationPlan(plan: ValidationPlan): string {
  return [
    `Validation plan ${plan.digest} (${plan.mode}); authority: ${plan.authority}; evidence: ${plan.evidence}`,
    ...plan.checks.flatMap((check) => [
      `${check.id} [${check.profile}] ${check.membership.length} test members`,
      `  cwd: ${check.cwd}; argv: ${JSON.stringify(check.argv)}`,
      ...check.reasons.map((reason) => `  ${reason}`),
    ]),
  ].join("\n");
}

import { readFile } from "node:fs/promises";
import { collectCanonicalValidationRegistry } from "./harness-repo-validation";
import {
  HarnessBlockedError,
  createHarnessBlocker,
  runHarnessCliBoundary,
} from "./harness-blockers";

export async function runValidationPlanCli(
  args: string[],
  log: (text: string) => void = console.log,
  options: { stdoutIsTTY?: boolean } = {},
) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    log(
      [
        "Usage: bun run harness:plan -- --input <request.json> [--json | --text]",
        "Read-only planning: no checks execute and the legacy gate stays authoritative.",
        "Request: mode is delivery, comparison, or full-health; changes contains semantic path/status entries;",
        "inventory lists explicit repository-relative file paths. An optional registry supplies a canonical fixture.",
        "Optional snapshots: {base: {path: sourceText}, candidate: {path: sourceText}} enables affected-consumer qualification from complete source inventories.",
        'Minimal request: {"mode":"full-health","changes":[],"inventory":["package.json"]}',
        'Change example: {"path":"scripts/example.ts","status":"modified"}; renamed entries also supply oldPath.',
        "JSON is the default for piped output; --text forces human-readable output.",
        "Example: bun run harness:plan -- --input scripts/fixtures/affected-validation/planner/report-request.json --json",
      ].join("\n"),
    );
    return;
  }
  const inputIndex = args.indexOf("--input");
  if (
    inputIndex < 0 ||
    !args[inputIndex + 1] ||
    args.some(
      (arg, index) =>
        index !== inputIndex + 1 &&
        !["--input", "--json", "--text"].includes(arg),
    ) ||
    (args.includes("--json") && args.includes("--text"))
  )
    fail(
      "malformed-map",
      "Usage: bun run harness:plan -- --input <request.json> [--json | --text]; use --help for request fields.",
    );
  let request: {
    mode: ValidationPlanMode;
    changes: ValidationChange[];
    inventory: string[];
    registry?: CanonicalValidationRegistry;
    snapshots?: ValidationSnapshots;
  };
  try {
    request = JSON.parse(await readFile(args[inputIndex + 1], "utf8"));
  } catch {
    return fail("malformed-map", "Cannot read a JSON plan request.");
  }
  if (
    !request ||
    !Array.isArray(request.changes) ||
    !Array.isArray(request.inventory) ||
    request.inventory.some((file) => !validPath(file))
  )
    fail(
      "malformed-map",
      "Request requires mode, semantic changes and explicit repository-relative inventory.",
    );
  const plan = buildValidationPlan(
    request.registry ?? collectCanonicalValidationRegistry(request.inventory),
    request.changes,
    request.mode,
    request.snapshots,
  );
  log(
    args.includes("--json") ||
      (!args.includes("--text") &&
        !(options.stdoutIsTTY ?? process.stdout.isTTY))
      ? JSON.stringify(plan, null, 2)
      : renderValidationPlan(plan),
  );
}

async function runValidationPlanBoundary() {
  try {
    await runValidationPlanCli(Bun.argv.slice(2));
  } catch (error) {
    if (!(error instanceof ValidationPlanError)) throw error;
    throw new HarnessBlockedError([
      createHarnessBlocker({
        code: `validation_plan_${error.code.replaceAll("-", "_")}`,
        source: { kind: "command", id: "harness:plan" },
        summary: "Canonical validation planning failed before execution.",
        details: error.message,
        remediations: [
          {
            id: "repair-validation-plan-request",
            kind: "code_change",
            summary:
              "Correct the authored registry or request using the named diagnostic; regenerate derived maps before retrying.",
          },
        ],
      }),
    ]);
  }
}

if (import.meta.main) {
  process.exitCode = await runHarnessCliBoundary({
    source: { kind: "command", id: "harness:plan" },
    reproduce: [
      "bun",
      "run",
      "harness:plan",
      "--",
      "--input",
      "<request.json>",
    ],
    run: runValidationPlanBoundary,
  });
}
