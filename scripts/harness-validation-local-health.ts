import { createHash } from "node:crypto";
import {
  defineHarnessConfig,
  GATE_STRUCTURAL_FINDING_CODES,
  type HarnessConfig,
  type ObligationPolicy,
} from "../.agent-skills/current/runtime/kernel.mjs";
import {
  evaluateValidationHealth,
  HEALTH_HISTORY_CHECK_ID,
  type HealthScope,
  type HealthSnapshot,
} from "./harness-validation-health.ts";
import {
  healthCandidateScopes,
  validationCheckHealthScope,
} from "./harness-validation-ci-policy.ts";
import { configureScopedValidation } from "./harness-validation-runtime.ts";
import type { NativeValidationSelection } from "./harness-validation-load.ts";
import type {
  PlannedValidationCheck,
  ValidationChange,
} from "./harness-validation-plan.ts";

export type LocalValidationMode = "comparison" | "full-health";
export type LocalHealthAuthority = {
  health: HealthSnapshot;
  /** Authenticated protected-main inventory, never candidate-authored input. */
  inventory: {
    schemaVersion: string;
    checks: Array<{ checkId: string; profile: string; scope: HealthScope }>;
  };
};
export type LocalValidationHealthContext = {
  schemaVersion: "athena-local-health-context/1";
  healthRevision: string;
  mode: LocalValidationMode;
  candidate: Pick<
    NativeValidationSelection["candidate"],
    "deliverable" | "base"
  >;
  trustedInventoryDigest: string;
  parentValidationDigest: string;
};
export class LocalValidationHealthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LocalValidationHealthError";
  }
}
export const LOCAL_HEALTH_PROVIDER = "athena.local-health";
export const LOCAL_HEALTH_OBLIGATION = "validation.health-current";
const guard = "athena.selection-guard";
const revisionFlag = "ATHENA_VALIDATION_HEALTH_REVISION";
const contextFlag = "ATHENA_LOCAL_HEALTH_CONTEXT";
const bindingFlags = new Set([revisionFlag, contextFlag]);
const fail = (code: string, message: string): never => {
  throw new LocalValidationHealthError(code, message);
};
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  ) ?? "null";
const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const byId = <T extends { id: string }>(values: readonly T[]) =>
  [...values].sort((a, b) => a.id.localeCompare(b.id));

/** Chooses execution, not admission; no fabricated repair proof is supplied. */
export function chooseLocalValidationMode(
  health: HealthSnapshot,
  changes: readonly ValidationChange[],
  requested: LocalValidationMode,
  now = Date.now(),
): LocalValidationMode {
  if (requested !== "comparison" && requested !== "full-health")
    return fail(
      "local_health_mode_invalid",
      "Unsupported local validation mode.",
    );
  const decision = evaluateValidationHealth({
    health,
    candidate: {
      candidateRef: "local-planning",
      profile: "local",
      scopes: healthCandidateScopes(changes),
    },
    now,
  });
  return requested === "full-health" ||
    health.historyComplete === false ||
    decision.status !== "eligible"
    ? "full-health"
    : "comparison";
}

function withoutHealth(config: HarnessConfig): HarnessConfig {
  return {
    ...config,
    providers: config.providers
      .filter((p) => p.id !== LOCAL_HEALTH_PROVIDER)
      .map((p) =>
        p.id === guard && p.check?.scope
          ? {
              ...p,
              check: {
                ...p.check,
                scope: {
                  ...p.check.scope,
                  environment: p.check.scope.environment.filter(
                    (entry) => !bindingFlags.has(entry.name),
                  ),
                },
              },
            }
          : p,
      ),
    obligations: config.obligations.filter(
      (o) => o.id !== LOCAL_HEALTH_OBLIGATION,
    ),
  };
}

function nativeProjection(config: HarnessConfig) {
  const providers = config.providers.filter((p) => p.check?.scope);
  const ids = new Set(providers.map((p) => p.id));
  return {
    providers: byId(providers),
    obligations: byId(
      config.obligations.filter(
        (o) =>
          o.id.startsWith("validation.") ||
          o.providers.some((id) => ids.has(id)),
      ),
    ),
    profiles: byId(config.scopedExecution?.profiles ?? []),
    mechanicalProviders: [
      ...(config.scopedExecution?.mechanicalProviders ?? []),
    ].sort(),
  };
}

function assertNativeProjection(
  config: HarnessConfig,
  selection: NativeValidationSelection,
) {
  const { scopedExecution: _scoped, ...unscoped } = config;
  const nativeIds = new Set(
    config.providers.filter((p) => p.check?.scope).map((p) => p.id),
  );
  const base = {
    ...unscoped,
    providers: config.providers.filter((p) => !nativeIds.has(p.id)),
    obligations: config.obligations.filter(
      (o) =>
        !o.id.startsWith("validation.") &&
        !o.providers.some((id) => nativeIds.has(id)),
    ),
  };
  const expected = configureScopedValidation(
    ".",
    base,
    selection.plan.mode,
    {},
    () => selection,
  ).config;
  if (digest(nativeProjection(config)) !== digest(nativeProjection(expected)))
    fail(
      "local_health_parent_mismatch",
      "Parent checks and mandatory obligations differ from the fresh canonical selection.",
    );
}

function covers(outer: HealthScope, inner: HealthScope): boolean {
  if (outer.kind === "repo") return true;
  if (inner.kind === "repo" || outer.package !== inner.package) return false;
  return (
    outer.kind === "package" ||
    (inner.kind === "paths" &&
      inner.paths.every((p) => outer.paths.includes(p)))
  );
}
/** This narrow mapping is valid only on freshly captured canonical selections.
 * coveredChecks alone is not equivalence: require the normalizer's complete
 * original-profile declaration plus its authored command and full membership.
 * A changed source contract emits no declaration; it keeps separate profiles.
 */
function characterizedFullUnitCovers(
  check: PlannedValidationCheck,
  entry: LocalHealthAuthority["inventory"]["checks"][number],
  selection: NativeValidationSelection,
): boolean {
  const root = "packages/athena-webapp";
  const declaration = check.ordinaryFullSuite;
  const scripts = selection.packageScripts[root];
  if (
    !declaration ||
    declaration.contract !== "athena-operator-full-unit/1" ||
    entry.profile !== `${root}:unit` ||
    check.profile !== `${root}:fallback-suite` ||
    check.cwd !== "." ||
    JSON.stringify(check.argv) !==
      JSON.stringify(["bun", "run", "--filter", "@athena/webapp", "test"]) ||
    scripts?.test !== "vitest run --maxWorkers=4" ||
    scripts.pretest !== undefined ||
    scripts.posttest !== undefined ||
    !Array.isArray(declaration.coveredProfiles) ||
    !declaration.coveredProfiles.length
  )
    return false;
  const rows = declaration.coveredProfiles;
  if (
    rows.some(
      (row) =>
        !row ||
        typeof row.checkId !== "string" ||
        !row.checkId ||
        ![`${root}:unit`, `${root}:fallback-suite`].includes(row.profile),
    ) ||
    new Set(rows.map((row) => row.checkId)).size !== rows.length ||
    rows.filter((row) => row.profile === `${root}:fallback-suite`).length !==
      1 ||
    canonical(rows.map((row) => row.checkId).sort()) !==
      canonical([...check.coveredChecks].sort()) ||
    !rows.some(
      (row) => row.checkId === entry.checkId && row.profile === entry.profile,
    )
  )
    return false;
  // Node's health boundary must not import Bun-only planning code. This is the
  // same pinned src/convex/shared test pattern and Vitest default exclusions.
  const membership = selection.inventory.filter((path) =>
    /^packages\/athena-webapp\/(src|convex|shared)\/.*[.]test[.](ts|tsx)$/.test(
      path,
    ),
  );
  return (
    membership.length > 0 &&
    !membership.some((path) => /\/(node_modules|[.]git)\//.test(path)) &&
    canonical([...new Set(membership)].sort()) ===
      canonical([...check.membership].sort())
  );
}

function candidateBinding(selection: NativeValidationSelection) {
  // Raw HEAD/tree and plan.changes include record-neutral transport. The native
  // selection guard binds those separately; never put them in command wiring.
  return structuredClone({
    deliverable: selection.candidate.deliverable,
    base: selection.candidate.base,
  });
}
function semanticChecks(selection: NativeValidationSelection) {
  return byId(selection.plan.checks).map(
    ({ reasons: _reasons, identity: _identity, ...check }) => check,
  );
}

function makeContext(
  config: HarnessConfig,
  selection: NativeValidationSelection,
  fullSelection: NativeValidationSelection,
  authority: LocalHealthAuthority,
  now: number,
): LocalValidationHealthContext {
  const mode = selection.plan.mode;
  if (mode !== "comparison" && mode !== "full-health")
    return fail(
      "local_health_mode_invalid",
      "Local health requires comparison or full-health selection.",
    );
  if (
    chooseLocalValidationMode(
      authority.health,
      selection.plan.changes,
      mode,
      now,
    ) !== mode
  )
    fail(
      "local_health_full_required",
      "Current health requires a complete full-health selection.",
    );
  if (
    !authority.health.revision.trim() ||
    !authority.inventory.schemaVersion.trim() ||
    !authority.inventory.checks.length
  )
    fail(
      "local_health_authority_invalid",
      "Authenticated health revision and nonempty protected inventory are required.",
    );
  assertNativeProjection(config, selection);
  const inventory = new Map(
    authority.inventory.checks.map((check) => [check.checkId, check]),
  );
  if (inventory.size !== authority.inventory.checks.length)
    fail(
      "local_health_authority_invalid",
      "Protected inventory contains duplicate checks.",
    );
  for (const finding of authority.health.findings) {
    if (finding.checkId === HEALTH_HISTORY_CHECK_ID) continue;
    const check = inventory.get(finding.checkId);
    if (!check || !covers(check.scope, finding.scope))
      fail(
        "local_health_unknown_check",
        `Protected inventory does not cover health finding ${finding.checkId}.`,
      );
  }
  if (mode === "full-health") {
    if (
      fullSelection.plan.mode !== "full-health" ||
      digest(candidateBinding(selection)) !==
        digest(candidateBinding(fullSelection)) ||
      digest(semanticChecks(selection)) !==
        digest(semanticChecks(fullSelection))
    )
      fail(
        "local_health_full_mismatch",
        "Parent selection differs from freshly recomputed complete full validation.",
      );
    for (const entry of inventory.values()) {
      const check = fullSelection.plan.checks.find(
        (item) =>
          item.id === entry.checkId ||
          item.coveredChecks.includes(entry.checkId),
      );
      if (
        !check ||
        !covers(validationCheckHealthScope(check.profile), entry.scope) ||
        (check.profile !== entry.profile &&
          !check.supersedes.some((item) => item.checkId === entry.checkId) &&
          !characterizedFullUnitCovers(check, entry, fullSelection))
      )
        fail(
          "local_health_full_coverage_missing",
          `Full validation does not cover protected check ${entry.checkId}.`,
        );
    }
  }
  return {
    schemaVersion: "athena-local-health-context/1",
    healthRevision: authority.health.revision,
    mode,
    candidate: candidateBinding(selection),
    trustedInventoryDigest: digest({
      ...authority.inventory,
      checks: [...inventory.values()].sort((a, b) =>
        a.checkId.localeCompare(b.checkId),
      ),
    }),
    parentValidationDigest: digest(nativeProjection(config)),
  };
}

function healthObligation(): ObligationPolicy {
  return {
    id: LOCAL_HEALTH_OBLIGATION,
    activation: { kind: "always" },
    freshness: "live",
    providers: [LOCAL_HEALTH_PROVIDER],
    acceptedPayloadSpecs: ["checks.passed/1"],
    allowedResolutionKinds: ["satisfied_live_fact"],
    humanWaiverAllowed: false,
    minimumAttestationLevel: "self",
    ciDelegationPolicyIds: [],
    waivableCodes: [],
    nonWaivableCodes: [...GATE_STRUCTURAL_FINDING_CODES],
    remediation: {
      default: [
        {
          id: "replan-local-health",
          kind: "manual_action",
          summary:
            "Read current health, prepare the resulting canonical selection, and rerun Athena validation.",
        },
      ],
    },
  };
}

/** The caller authenticates authority and freshly captures both selections.
 * This declares a context predicate; native admission independently ANDs every
 * mandatory check. It never states that repair passed or closes global health. */
export function bindLocalValidationHealth(
  config: HarnessConfig,
  selection: NativeValidationSelection,
  fullSelection: NativeValidationSelection,
  authority: LocalHealthAuthority,
  now = Date.now(),
) {
  if (
    config.providers.some((p) => p.id === LOCAL_HEALTH_PROVIDER) ||
    config.obligations.some((o) => o.id === LOCAL_HEALTH_OBLIGATION)
  )
    fail(
      "local_health_already_bound",
      "Local health must be bound once to the parent configuration.",
    );
  const context = makeContext(config, selection, fullSelection, authority, now);
  const environment = {
    [revisionFlag]: context.healthRevision,
    [contextFlag]: digest(context),
  };
  const bound = defineHarnessConfig({
    ...config,
    preparationWiringPaths: [
      ...new Set([
        ...(config.preparationWiringPaths ?? []),
        "scripts/harness-validation-local-runtime.ts",
        "scripts/harness-validation-local-authority.ts",
        "scripts/harness-validation-local-health.ts",
        "scripts/harness-validation-local-health-check.ts",
        "scripts/harness-validation-health.ts",
        "scripts/harness-validation-health-inventory.ts",
        "scripts/delivery-live-sensor.ts",
      ]),
    ].sort(),
    providers: [
      ...config.providers.map((p) =>
        p.id === guard && p.check?.scope
          ? {
              ...p,
              check: {
                ...p.check,
                scope: {
                  ...p.check.scope,
                  environment: [
                    ...p.check.scope.environment,
                    ...[revisionFlag, contextFlag].map((name) => ({
                      name,
                      kind: "flag" as const,
                    })),
                  ],
                },
              },
            }
          : p,
      ),
      {
        id: LOCAL_HEALTH_PROVIDER,
        findingCodes: [],
        command: [
          "bun",
          "scripts/delivery-live-sensor.ts",
          "validation-health",
          JSON.stringify(context),
        ],
      },
    ],
    obligations: [...config.obligations, healthObligation()],
  });
  return { config: bound, context, environment };
}

/** Fresh health must match the ORIGINAL context, including parent wiring. The
 * provider must not replace it with a freshly chosen full mode or revision. */
export function assertLocalValidationHealthCurrent(
  context: LocalValidationHealthContext,
  config: HarnessConfig,
  selection: NativeValidationSelection,
  fullSelection: NativeValidationSelection,
  authority: LocalHealthAuthority,
  now = Date.now(),
): void {
  if (context.healthRevision !== authority.health.revision)
    fail(
      "local_health_revision_changed",
      "Health changed since planning; replan and prepare before admission.",
    );
  const fresh = bindLocalValidationHealth(
    withoutHealth(config),
    selection,
    fullSelection,
    authority,
    now,
  );
  if (digest(context) !== digest(fresh.context))
    fail(
      "local_health_context_changed",
      "Candidate, protected inventory or parent validation context changed.",
    );
  if (
    config.providers.filter((p) => p.id === LOCAL_HEALTH_PROVIDER).length !==
      1 ||
    digest(nativeProjection(config)) !==
      digest(nativeProjection(fresh.config)) ||
    digest(config.providers.find((p) => p.id === LOCAL_HEALTH_PROVIDER)) !==
      digest(
        fresh.config.providers.find((p) => p.id === LOCAL_HEALTH_PROVIDER),
      ) ||
    config.obligations.at(-1)?.id !== LOCAL_HEALTH_OBLIGATION
  )
    fail(
      "local_health_binding_changed",
      "Live health obligation or native guard context binding is missing or changed.",
    );
}
