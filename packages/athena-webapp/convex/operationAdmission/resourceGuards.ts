import type { Id } from "../_generated/dataModel";
import type {
  OperationAdmissionCtx,
  OperationDefinition,
  OperationResourceGuards,
  OperationScopeConstraints,
  OperationTargetIds,
} from "./types";

function readIdArg(
  args: Record<string, unknown>,
  argName: string | undefined,
): string | undefined {
  if (!argName) return undefined;
  const value = args[argName];
  return typeof value === "string" ? value : undefined;
}

export async function resolveOperationTargetIds(
  ctx: OperationAdmissionCtx,
  args: Record<string, unknown>,
  definition: OperationDefinition,
  constraints: OperationScopeConstraints,
): Promise<OperationTargetIds | undefined> {
  const target = definition.target?.protectDemoFoundation;
  if (!target) return undefined;
  if (target === true) {
    return {
      organizationId: constraints.organizationId,
      storeId: constraints.storeId,
    };
  }
  if ("resolve" in target) {
    return target.resolve(ctx, args, constraints);
  }
  return {
    athenaUserId: readIdArg(args, target.athenaUserIdArg) as
      | Id<"athenaUser">
      | undefined,
    organizationId: readIdArg(args, target.organizationIdArg) as
      | Id<"organization">
      | undefined,
    storeId: readIdArg(args, target.storeIdArg) as Id<"store"> | undefined,
  };
}

export async function resolveOperationTargetExternalRefs(
  ctx: OperationAdmissionCtx,
  args: Record<string, unknown>,
  definition: OperationDefinition,
  constraints: OperationScopeConstraints,
): Promise<readonly string[] | undefined> {
  const target = definition.target?.protectDemoFoundationExternalRefs;
  if (!target) return undefined;
  if ("resolve" in target) {
    return target.resolve(ctx, args, constraints);
  }
  const value = args[target.arg];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

/**
 * Target guards run for EVERY admitted actor, after scope resolution and
 * before the domain handler. They protect demo fixture rows from normal full
 * admins as much as from demo visitors, so they cannot be expressed as actor
 * policy.
 */
export async function evaluateOperationTargetGuards(
  ctx: OperationAdmissionCtx,
  args: Record<string, unknown>,
  definition: OperationDefinition,
  constraints: OperationScopeConstraints,
  guards: OperationResourceGuards | undefined,
): Promise<void> {
  if (!definition.target || !guards) return;

  const targetIds = await resolveOperationTargetIds(
    ctx,
    args,
    definition,
    constraints,
  );
  if (targetIds) {
    await guards.protectDemoFoundation(targetIds);
  }

  const refs = await resolveOperationTargetExternalRefs(
    ctx,
    args,
    definition,
    constraints,
  );
  if (refs) {
    await guards.protectDemoFoundationExternalRefs(refs);
  }
}

export function validateOperationTarget(
  definition: OperationDefinition,
  declaredArgNames?: readonly string[],
): string[] {
  const errors: string[] = [];
  const target = definition.target;
  if (!target) return errors;

  const foundation = target.protectDemoFoundation;
  if (foundation !== undefined && foundation !== true) {
    if ("resolve" in foundation) {
      if (typeof foundation.resolve !== "function") {
        errors.push("target.protectDemoFoundation.resolve must be a function.");
      }
    } else {
      const bindings = [
        foundation.athenaUserIdArg,
        foundation.organizationIdArg,
        foundation.storeIdArg,
      ].filter((entry): entry is string => typeof entry === "string");
      if (bindings.length === 0) {
        errors.push(
          "target.protectDemoFoundation must bind at least one id argument.",
        );
      }
      if (declaredArgNames) {
        for (const binding of bindings) {
          if (!declaredArgNames.includes(binding)) {
            errors.push(
              `target.protectDemoFoundation binds unknown argument: ${binding}`,
            );
          }
        }
      }
    }
  }

  const refs = target.protectDemoFoundationExternalRefs;
  if (refs !== undefined) {
    if ("resolve" in refs) {
      if (typeof refs.resolve !== "function") {
        errors.push(
          "target.protectDemoFoundationExternalRefs.resolve must be a function.",
        );
      }
    } else if (!refs.arg.trim()) {
      errors.push(
        "target.protectDemoFoundationExternalRefs must bind an argument.",
      );
    } else if (declaredArgNames && !declaredArgNames.includes(refs.arg)) {
      errors.push(
        `target.protectDemoFoundationExternalRefs binds unknown argument: ${refs.arg}`,
      );
    }
  }

  return errors;
}
