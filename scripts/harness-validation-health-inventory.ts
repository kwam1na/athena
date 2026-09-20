import type { ValidationPlan } from "./harness-validation-plan.ts";

export const VALIDATION_HEALTH_INVENTORY_PATH =
  ".agents/validation-health-inventory.json";
export type ValidationHealthInventory = {
  schemaVersion: "athena-validation-health-inventory/1";
  checks: Array<{
    checkId: string;
    profile: string;
    scope: { kind: "repo" } | { kind: "package"; package: string };
  }>;
};

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  )
    throw new Error("Invalid validation health inventory object");
  return value as Record<string, unknown>;
}

function token(value: unknown): string {
  if (typeof value !== "string" || !value || /\s/.test(value))
    throw new Error("Invalid validation health inventory identifier");
  return value;
}

function scopeFor(
  profile: string,
): ValidationHealthInventory["checks"][number]["scope"] {
  const packageRoot = /^(packages\/[a-z0-9][a-z0-9._-]*):[^\s]+$/.exec(
    profile,
  )?.[1];
  return packageRoot
    ? { kind: "package", package: packageRoot }
    : { kind: "repo" };
}

/** Data-only parser: no filesystem, policy loading, Bun, or executable metadata.
 * This names health checks; it cannot establish test membership or passing evidence. */
export function parseValidationHealthInventory(
  value: unknown,
): ValidationHealthInventory {
  const root = object(value, ["schemaVersion", "checks"]);
  if (
    root.schemaVersion !== "athena-validation-health-inventory/1" ||
    !Array.isArray(root.checks) ||
    !root.checks.length
  )
    throw new Error("Invalid validation health inventory schema or checks");
  let previous: string | undefined;
  const checks = root.checks.map((value) => {
    const row = object(value, ["checkId", "profile", "scope"]);
    const checkId = token(row.checkId),
      profile = token(row.profile);
    if (previous !== undefined && previous.localeCompare(checkId) >= 0)
      throw new Error(
        "Validation health inventory checks must be sorted and unique",
      );
    previous = checkId;
    const scope = scopeFor(profile);
    const declared = object(
      row.scope,
      scope.kind === "repo" ? ["kind"] : ["kind", "package"],
    );
    if (
      declared.kind !== scope.kind ||
      (scope.kind === "package" && declared.package !== scope.package)
    )
      throw new Error(
        "Validation health inventory scope disagrees with profile",
      );
    return { checkId, profile, scope };
  });
  return { schemaVersion: "athena-validation-health-inventory/1", checks };
}

/** Derive from canonical full-health selection after alias deduplication. */
export function generateValidationHealthInventory(
  plan: ValidationPlan,
): ValidationHealthInventory {
  if (plan.mode !== "full-health")
    throw new Error("Validation health inventory requires a full-health plan");
  return parseValidationHealthInventory({
    schemaVersion: "athena-validation-health-inventory/1",
    checks: plan.checks
      .map((check) => ({
        checkId: check.id,
        profile: check.profile,
        scope: scopeFor(check.profile),
      }))
      .sort((a, b) => a.checkId.localeCompare(b.checkId)),
  });
}
