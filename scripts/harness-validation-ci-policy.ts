import {
  defineHarnessConfig,
  type HarnessConfig,
} from "../.agent-skills/current/runtime/kernel.mjs";
import type { ValidationChange } from "./harness-validation-plan.ts";
import type { HealthScope } from "./harness-validation-health.ts";

/** CI attests only its native validation obligations. It cannot satisfy the
 * separately named delivery gate or change that gate's frozen identity policy. */
export function createCiValidationConfiguration(
  projected: HarnessConfig,
  forceFresh: boolean,
): HarnessConfig {
  if (!projected.scopedExecution)
    throw new Error("Native scoped configuration required for CI");
  const providers = projected.providers.filter(
    (provider) => provider.check?.scope !== undefined,
  );
  const ids = new Set(providers.map((provider) => provider.id));
  const obligations = projected.obligations.filter((obligation) =>
    obligation.providers.some((id) => ids.has(id)),
  );
  if (
    !providers.length ||
    obligations.some(
      (obligation) =>
        !obligation.id.startsWith("validation.") ||
        obligation.providers.some((id) => !ids.has(id)),
    )
  )
    throw new Error(
      "CI configuration must contain only explicit native validation obligations",
    );
  const neutral = [{ prefix: "artifacts/validation-ci/", suffix: ".json" }];
  return defineHarnessConfig({
    ...projected,
    gateId: "athena.validation-ci",
    identityVersions: ["athena-validation-ci/v1"],
    computingIdentityVersion: "athena-validation-ci/v1",
    reviewNeutral: neutral,
    recordNeutral: neutral,
    deliveryRecordPath: "artifacts/validation-ci/delivery-record.json",
    scopedExecution: { ...projected.scopedExecution, repairCommands: [] },
    providers: providers.map((provider) => ({
      ...provider,
      check: {
        ...provider.check!,
        scope: {
          ...provider.check!.scope!,
          environment: [
            ...provider.check!.scope!.environment,
            ...(provider.id === "athena.selection-guard"
              ? [
                  {
                    name: "ATHENA_VALIDATION_HEALTH_REVISION",
                    kind: "flag" as const,
                  },
                ]
              : []),
            ...(forceFresh
              ? [
                  {
                    name: "ATHENA_VALIDATION_INVOCATION",
                    kind: "flag" as const,
                  },
                ]
              : []),
          ],
        },
      },
    })),
    obligations,
  });
}

/** Root delivery artifacts do not imply application source changes. Other root
 * changes retain repository-wide health requirements; renames bind both paths. */
export function healthCandidateScopes(
  changes: readonly ValidationChange[],
): HealthScope[] {
  const packages = new Set<string>(),
    artifacts = new Set<string>();
  for (const change of changes)
    for (const file of [
      change.path,
      ...(change.oldPath ? [change.oldPath] : []),
    ]) {
      const pkg = /^packages\/([^/]+)\//.exec(file);
      if (pkg) packages.add(`packages/${pkg[1]}`);
      else if (
        ["docs/reports/", "docs/solutions/", "telemetry/delivery-runs/"].some(
          (prefix) => file.startsWith(prefix),
        )
      )
        artifacts.add(file);
      else return [{ kind: "repo" }];
    }
  return [
    ...[...packages].sort().map((packageRoot) => ({
      kind: "package" as const,
      package: packageRoot,
    })),
    ...(artifacts.size
      ? [{ kind: "paths" as const, package: ".", paths: [...artifacts].sort() }]
      : []),
  ];
}

export function validationCheckHealthScope(profile: string): HealthScope {
  const packageRoot = /^(packages\/[a-z0-9][a-z0-9._-]*):[^\s]+$/.exec(
    profile,
  )?.[1];
  return packageRoot
    ? { kind: "package", package: packageRoot }
    : { kind: "repo" };
}
