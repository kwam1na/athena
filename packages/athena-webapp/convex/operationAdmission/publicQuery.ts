import type { QueryCtx } from "../_generated/server";
import {
  createSharedDemoReadOperationAdapter,
  resolveReadOperationAdmission,
} from "./readAdapters";
import { validateReadOperationDefinition } from "./readDefinitions";
import type {
  OperationAdmissionContext,
  OperationQueryCtx,
  OperationReadDefinition,
} from "./types";

type QueryArgs = Record<string, unknown>;
type PublicQueryHandler<Args extends QueryArgs, Result> = (
  ctx: OperationQueryCtx,
  args: Args,
) => Promise<Result>;
type ReadAdmissionResolver<Args extends QueryArgs> = (
  ctx: QueryCtx,
  args: Args,
  definition: OperationReadDefinition,
) => Promise<OperationAdmissionContext>;

export function admitPublicQuery<Args extends QueryArgs, Result>(
  definition: OperationReadDefinition,
  handler: PublicQueryHandler<Args, Result>,
  options: { resolveAdmission?: ReadAdmissionResolver<Args> } = {},
) {
  return async (ctx: QueryCtx, args: Args): Promise<Result> => {
    const errors = validateReadOperationDefinition(definition);
    if (errors.length > 0) {
      throw new Error(
        `Invalid operation read admission definition: ${errors.join(" ")}`,
      );
    }
    const operationAdmission = await (
      options.resolveAdmission ?? resolveReadOperationAdmission
    )(ctx, args, definition);
    return handler(Object.assign(ctx, { operationAdmission }), args);
  };
}

export function admitSharedDemoPublicQuery<Args extends QueryArgs, Result>(
  definition: OperationReadDefinition,
  handler: PublicQueryHandler<Args, Result>,
) {
  return admitPublicQuery(definition, handler, {
    resolveAdmission: (ctx, args, readDefinition) =>
      resolveReadOperationAdmission(ctx, args, readDefinition, {
        sharedDemoAdapter: createSharedDemoReadOperationAdapter(),
      }),
  });
}
