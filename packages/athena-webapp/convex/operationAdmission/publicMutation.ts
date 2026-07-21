import type { MutationCtx } from "../_generated/server";
import {
  createNormalUserOperationAdapter,
  resolveOperationAdmission,
} from "./adapters";
import { validateOperationDefinition } from "./definitions";
import type {
  OperationAdmissionContext,
  OperationDefinition,
  OperationMutationCtx,
} from "./types";

type DomainHandler<Args extends Record<string, unknown>, Result> = (
  ctx: OperationMutationCtx,
  args: Args,
) => Promise<Result>;

type AdmissionResolver<Args extends Record<string, unknown>> = (
  ctx: MutationCtx,
  args: Args,
  definition: OperationDefinition,
) => Promise<OperationAdmissionContext>;

export function admitPublicMutation<
  Args extends Record<string, unknown>,
  Result,
>(
  definition: OperationDefinition,
  handler: DomainHandler<Args, Result>,
  options: {
    resolveAdmission?: AdmissionResolver<Args>;
  } = {},
) {
  return async (ctx: MutationCtx, args: Args): Promise<Result> => {
    const definitionErrors = validateOperationDefinition(definition);
    if (definitionErrors.length > 0) {
      throw new Error(
        `Invalid operation admission definition: ${definitionErrors.join("; ")}`,
      );
    }

    const operationAdmission = await (options.resolveAdmission ??
      ((resolverCtx, resolverArgs, resolverDefinition) =>
        resolveOperationAdmission(resolverCtx, resolverArgs, resolverDefinition, {
          normalAdapter: createNormalUserOperationAdapter(),
        })))(ctx, args, definition);

    return handler(
      Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, {
        operationAdmission,
      }) as OperationMutationCtx,
      args,
    );
  };
}
