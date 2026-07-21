import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type {
  OperationDefinition,
  OperationScopeConstraints,
} from "./types";

export async function resolveOperationScope(
  ctx: MutationCtx,
  args: Record<string, unknown>,
  definition: OperationDefinition,
): Promise<OperationScopeConstraints> {
  if (definition.scope.kind === "none") return {};
  if (definition.scope.resolve) return definition.scope.resolve(ctx, args);
  if (definition.scope.kind === "store") {
    return {
      storeId: args[definition.scope.storeIdArg!] as Id<"store">,
    };
  }
  return {
    organizationId: args[
      definition.scope.organizationIdArg!
    ] as Id<"organization">,
  };
}
