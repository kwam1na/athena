import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
  defineHarnessConfig,
  GATE_STRUCTURAL_FINDING_CODES,
  type HarnessConfig,
  type ObligationPolicy,
  type ProviderRegistration,
  type ScopedExecutionProfile,
  type ScopedCheckDefinition,
} from "../.agent-skills/current/runtime/kernel.mjs";
import { validationCheckCommand } from "./harness-validation-command.ts";
import type {
  ValidationPlan,
  PlannedValidationCheck,
} from "./harness-validation-plan.ts";

const sorted = (values: readonly string[]) => [...new Set(values)].sort();
const stableId = (id: string) =>
  createHash("sha256").update(id).digest("hex").slice(0, 24);
const guardId = "athena.selection-guard";
const guardProfile = "athena-selection-guard";

export type ValidationExecutionPolicy = {
  profiles: readonly ScopedExecutionProfile[];
  profileByCheck: Readonly<Record<string, string>>;
  mechanicalChecks: readonly string[];
  environment?: ScopedCheckDefinition["environment"];
  environmentByCheck?: Readonly<
    Record<string, ScopedCheckDefinition["environment"]>
  >;
  packageScripts?: Readonly<Record<string, Record<string, unknown>>>;
};

/** Repository declaration only. Native preparation, execution, freshness and
 * evidence remain product-owned. The caller supplies freshly captured selection. */
export function projectValidationPolicy(
  base: HarnessConfig,
  plan: ValidationPlan,
  execution: ValidationExecutionPolicy,
) {
  if (base.scopedExecution || !plan.checks.length)
    throw new Error(
      "Expected an unprojected policy and a nonempty canonical plan",
    );
  const canonical = new Map<string, PlannedValidationCheck>();
  for (const check of plan.checks) {
    for (const id of sorted([check.id, ...check.coveredChecks])) {
      if (canonical.has(id))
        throw new Error(`Ambiguous canonical check: ${id}`);
      canonical.set(id, check);
    }
  }
  const ordered: PlannedValidationCheck[] = [];
  const seen = new Set<string>(),
    visiting = new Set<string>();
  const visit = (check: PlannedValidationCheck) => {
    if (seen.has(check.id)) return;
    if (visiting.has(check.id))
      throw new Error(`Cyclic prerequisite: ${check.id}`);
    visiting.add(check.id);
    for (const id of sorted(check.prerequisites)) {
      const prerequisite = canonical.get(id);
      if (!prerequisite) throw new Error(`Missing prerequisite: ${id}`);
      if (prerequisite !== check) visit(prerequisite);
    }
    visiting.delete(check.id);
    seen.add(check.id);
    ordered.push(check);
  };
  for (const check of [...plan.checks].sort((a, b) => a.id.localeCompare(b.id)))
    visit(check);
  const mechanical = new Set(execution.mechanicalChecks);
  for (const id of mechanical)
    if (!plan.checks.some((check) => check.id === id))
      throw new Error(`Unknown mechanical check: ${id}`);
  for (const check of ordered.filter((check) => mechanical.has(check.id)))
    for (const id of check.prerequisites)
      if (!mechanical.has(canonical.get(id)!.id))
        throw new Error(
          `Nonmechanical prerequisite precedes preparation: ${id}`,
        );
  const profiles = new Set(execution.profiles.map((profile) => profile.id));
  if (profiles.has(guardProfile))
    throw new Error("Reserved selection guard profile");
  const obligation = (id: string, provider: string): ObligationPolicy => ({
    id,
    activation: { kind: "always" },
    freshness: "exact_candidate",
    providers: [provider],
    acceptedPayloadSpecs: ["checks.passed/1"],
    allowedResolutionKinds: ["satisfied_evidence"],
    humanWaiverAllowed: false,
    minimumAttestationLevel: "self",
    ciDelegationPolicyIds: [],
    waivableCodes: [],
    nonWaivableCodes: [...GATE_STRUCTURAL_FINDING_CODES],
    remediation: {
      default: [
        {
          id: "repair-selected-validation",
          kind: "manual_action",
          summary:
            "Repair the selected validation failure and prepare a fresh canonical candidate.",
        },
      ],
    },
  });
  const checks = ordered.map((check) => ({
    checkId: check.id,
    providerId: `athena.scoped.${stableId(check.id)}`,
    obligationId: `validation.scoped.${stableId(check.id)}`,
  }));
  const providers: ProviderRegistration[] = [
    {
      id: guardId,
      findingCodes: [],
      check: {
        command: ["node", "scripts/harness-validation-selection-guard.mjs"],
        timeoutMs: 30000,
        scope: {
          version: "scoped-check/1",
          files: ["scripts/harness-validation-selection-guard.mjs"],
          memberships: [],
          tests: [],
          cwd: ".",
          profile: guardProfile,
          environment: ["HEAD", "TREE", "BASE", "MERGE_BASE"].map((name) => ({
            name: `ATHENA_SELECTION_${name}`,
            kind: "flag" as const,
          })),
        },
      },
    },
  ];
  for (const [index, check] of ordered.entries()) {
    const profile = execution.profileByCheck[check.id];
    if (!profile || !profiles.has(profile))
      throw new Error(`Missing execution profile: ${check.id}`);
    const command = validationCheckCommand(check, {
      packageScripts: execution.packageScripts?.[check.cwd],
    });
    if (!command.length) throw new Error(`Empty command: ${check.id}`);
    const directScript =
      ["bun", "node", "python3"].includes(command[0]) &&
      /\.(?:mjs|cjs|js|ts|py)$/.test(command[1] ?? "")
        ? [posix.normalize(posix.join(check.cwd, command[1]))]
        : [];
    const files = sorted([
      ...check.inputs,
      ...check.absentInputs,
      ...directScript,
    ]);
    const directories = sorted(
      [...files, ...check.membership]
        .map((file) => posix.dirname(file))
        .filter((dir) => dir !== "."),
    );
    // Keep directory membership conservative without hashing every nested prefix twice.
    const memberships = directories
      .filter(
        (dir) =>
          !directories.some(
            (parent) => parent !== dir && dir.startsWith(`${parent}/`),
          ),
      )
      .map((dir) => `${dir}/`);
    providers.push({
      id: checks[index].providerId,
      findingCodes: [],
      check: {
        command: command as [string, ...string[]],
        timeoutMs: 3600000,
        scope: {
          version: "scoped-check/1",
          files,
          memberships,
          tests: sorted(check.membership),
          cwd: check.cwd,
          profile,
          environment: [
            ...(execution.environment ?? []),
            ...(execution.environmentByCheck?.[check.id] ?? []),
          ],
        },
      },
    });
  }
  const repairIds = new Set([
    "athena-dependency-parity",
    "athena-generated-artifacts",
  ]);
  const config = defineHarnessConfig({
    ...base,
    preparationWiringPaths: sorted([
      ...(base.preparationWiringPaths ?? []),
      "scripts/harness-validation-capture.ts",
      "scripts/harness-validation-command.ts",
      "scripts/harness-validation-impact.ts",
      "scripts/harness-validation-load.ts",
      "scripts/harness-validation-plan.ts",
      "scripts/harness-validation-policy.ts",
      "scripts/harness-validation-runtime.ts",
      "scripts/fixtures/affected-validation/frontend-qualified-profiles.json",
      "scripts/harness-validation-snapshot.ts",
      "scripts/harness-validation-selection-guard.mjs",
      "scripts/harness-validation-dependencies.py",
      ".graphify-validation-requirements.lock",
    ]),
    preparationCommands: (base.preparationCommands ?? []).filter(
      (command) =>
        !repairIds.has(command.id) && command.id !== "athena-mechanical",
    ),
    scopedExecution: {
      version: "scoped-execution/1",
      profiles: [
        {
          id: guardProfile,
          gitContext: "full",
          dependencyInputs: [],
          mutableOutputs: [],
          credentialIdentities: {},
        },
        ...execution.profiles,
      ],
      mechanicalProviders: [
        guardId,
        ...checks
          .filter((check) => mechanical.has(check.checkId))
          .map((check) => check.providerId),
      ],
      repairCommands: (base.preparationCommands ?? [])
        .filter((command) => repairIds.has(command.id))
        .map((command) => ({
          ...command,
          command: [
            "env",
            "-u",
            "ATHENA_GRAPHIFY_PYTHON",
            ...command.command,
          ] as [string, ...string[]],
        })),
    },
    providers: [
      ...providers,
      ...base.providers.filter(
        (provider) => provider.id !== "athena.validation",
      ),
    ],
    obligations: [
      obligation("validation.selection-current", guardId),
      ...checks.map((check) =>
        obligation(check.obligationId, check.providerId),
      ),
      ...base.obligations.filter((entry) => entry.id !== "validation.passed"),
    ],
  });
  return { config, checks };
}
