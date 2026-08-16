import type { Context } from "hono";
import type { FunctionReference } from "convex/server";

import type {
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";
import { resolveAdmissionChain } from "./adapters";
import {
  OPERATION_ADMISSION_DEFINITIONS,
  validateOperationDefinition,
} from "./definitions";
import {
  OPERATION_READ_ADMISSION_DEFINITIONS,
  validateReadOperationDefinition,
} from "./readDefinitions";
import {
  verifyOperationIngress,
  type OperationIngressVerifierRegistry,
} from "./ingressVerification";
import { evaluateOperationTargetGuards } from "./resourceGuards";
import type {
  OperationAdapter,
  OperationAdmissionContext,
  OperationAdmissionProjection,
  OperationCapturePort,
  OperationDefinition,
  OperationIngress,
  OperationIngressClaim,
  OperationMutationCtx,
  OperationQueryCtx,
  OperationReadAdapter,
  OperationReadDefinition,
  OperationResourceGuards,
} from "./types";
import { OPERATION_INGRESS_CLAIM_ARG } from "./types";

export type AdmissionEntrypointArgs = {
  operationId: string;
  operationArgs: Record<string, unknown>;
};

export type AdmissionEntrypoints = {
  admitOperation: FunctionReference<
    "mutation",
    "internal",
    AdmissionEntrypointArgs,
    OperationAdmissionProjection
  >;
  admitReadOperation: FunctionReference<
    "query",
    "internal",
    AdmissionEntrypointArgs,
    OperationAdmissionProjection
  >;
};

export type AdmissionRailConfig = {
  /** Write-path adapter chain, in trust order. */
  adapters: readonly OperationAdapter[];
  /** Read-path adapter chain, in trust order. */
  readAdapters: readonly OperationReadAdapter[];
  resourceGuards?: OperationResourceGuards;
  capture?: OperationCapturePort;
  ingressVerifiers?: OperationIngressVerifierRegistry;
  /** Registered internal admission entry points (action/http kinds only). */
  entrypoints?: AdmissionEntrypoints;
  /** Extracts the storefront claim from an HTTP request. */
  extractIngressClaim?: (c: Context) => OperationIngressClaim | undefined;
};

type DomainMutationHandler<Args extends Record<string, unknown>, Result> = (
  ctx: OperationMutationCtx,
  args: Args,
) => Promise<Result>;

type DomainQueryHandler<Args extends Record<string, unknown>, Result> = (
  ctx: OperationQueryCtx,
  args: Args,
) => Promise<Result>;

export type OperationActionCtx = ActionCtx & {
  operationAdmission: OperationAdmissionProjection;
};

type DomainActionHandler<Args extends Record<string, unknown>, Result> = (
  ctx: OperationActionCtx,
  args: Args,
) => Promise<Result>;

export type AdmittedHttpContext = {
  admission: OperationAdmissionProjection;
  ingress: OperationIngress;
};

type HttpHandler = (
  c: Context,
  admitted: AdmittedHttpContext,
) => Promise<Response> | Response;

function cloneCtxWith<Ctx extends object, Extra extends object>(
  ctx: Ctx,
  extra: Extra,
): Ctx & Extra {
  return Object.assign(
    Object.create(Object.getPrototypeOf(ctx) ?? Object.prototype),
    ctx,
    extra,
  );
}

export function projectOperationAdmission(
  admission: OperationAdmissionContext,
): OperationAdmissionProjection {
  return {
    actor: admission.actor,
    constraints: admission.constraints,
    decision: admission.decision,
    operationId: admission.operation.operationId,
    provenance: admission.provenance,
  };
}

function requireValidWriteDefinition(definition: OperationDefinition) {
  const errors = validateOperationDefinition(definition);
  if (errors.length > 0) {
    throw new Error(
      `Invalid operation admission definition: ${errors.join("; ")}`,
    );
  }
}

function requireValidReadDefinition(definition: OperationReadDefinition) {
  const errors = validateReadOperationDefinition(definition);
  if (errors.length > 0) {
    throw new Error(
      `Invalid operation read admission definition: ${errors.join(" ")}`,
    );
  }
}

export function findOperationDefinition(operationId: string) {
  return OPERATION_ADMISSION_DEFINITIONS.find(
    (definition) => definition.operationId === operationId,
  );
}

export function findReadOperationDefinition(operationId: string) {
  return OPERATION_READ_ADMISSION_DEFINITIONS.find(
    (definition) => definition.operationId === operationId,
  );
}

/**
 * Builds every canonical ingress wrapper from injected policy.
 *
 * The rail core owns sequencing — validate, resolve identity, clamp scope,
 * guard target rows, capture, invoke — and nothing else. Adapters, resource
 * guards, the capture port, and ingress verifiers are all supplied by the
 * composition root (`convex/platform/operationAdmission.ts`), which is why no
 * file under `convex/operationAdmission/**` imports a policy module.
 */
export function createAdmissionRail(config: AdmissionRailConfig) {
  async function resolveWriteAdmission(
    ctx: MutationCtx,
    args: Record<string, unknown>,
    definition: OperationDefinition,
  ): Promise<OperationAdmissionContext> {
    const admission = await resolveAdmissionChain(
      ctx,
      args,
      definition,
      config.adapters,
    );
    await evaluateOperationTargetGuards(
      ctx,
      args,
      definition,
      admission.constraints,
      config.resourceGuards,
    );
    return admission;
  }

  function resolveReadAdmission(
    ctx: QueryCtx,
    args: Record<string, unknown>,
    definition: OperationReadDefinition,
  ): Promise<OperationAdmissionContext> {
    return resolveAdmissionChain(ctx, args, definition, config.readAdapters);
  }

  function admitPublicMutation<Args extends Record<string, unknown>, Result>(
    definition: OperationDefinition,
    handler: DomainMutationHandler<Args, Result>,
    options: {
      resolveAdmission?: (
        ctx: MutationCtx,
        args: Args,
        definition: OperationDefinition,
      ) => Promise<OperationAdmissionContext>;
    } = {},
  ) {
    return async (ctx: MutationCtx, args: Args): Promise<Result> => {
      requireValidWriteDefinition(definition);

      const operationAdmission = await (options.resolveAdmission
        ? options.resolveAdmission(ctx, args, definition)
        : resolveWriteAdmission(
            ctx,
            args as Record<string, unknown>,
            definition,
          ));

      // Demo visitors are the only actors observed here. The append shares
      // this transaction on purpose: if the handler throws, the observation
      // rolls back with it, so recorded actions are ones that happened.
      await config.capture?.(ctx, operationAdmission);

      return handler(
        cloneCtxWith(ctx, { operationAdmission }) as OperationMutationCtx,
        args as never,
      );
    };
  }

  function admitPublicQuery<Args extends Record<string, unknown>, Result>(
    definition: OperationReadDefinition,
    handler: DomainQueryHandler<Args, Result>,
    options: {
      resolveAdmission?: (
        ctx: QueryCtx,
        args: Args,
        definition: OperationReadDefinition,
      ) => Promise<OperationAdmissionContext>;
    } = {},
  ) {
    return async (ctx: QueryCtx, args: Args): Promise<Result> => {
      requireValidReadDefinition(definition);
      const operationAdmission = await (options.resolveAdmission
        ? options.resolveAdmission(ctx, args, definition)
        : resolveReadAdmission(
            ctx,
            args as Record<string, unknown>,
            definition,
          ));
      // Queries extend the caller's own context rather than a clone: read
      // handlers pass `ctx` straight through to helpers, and swapping the
      // object identity would change what those helpers observe.
      return handler(
        Object.assign(ctx, { operationAdmission }) as OperationQueryCtx,
        args as never,
      );
    };
  }

  /**
   * Admission for a Convex *action*.
   *
   * An action has no `db`, so admission runs in its own transaction through
   * the registered internal mutation. That transaction commits on its own: a
   * recorded action means "admitted and started", where a mutation's rows mean
   * "committed". Denials still stop the action, because a denied admission
   * throws out of the mutation.
   */
  function admitPublicAction<Args extends Record<string, unknown>, Result>(
    definition: OperationDefinition,
    handler: DomainActionHandler<Args, Result>,
  ) {
    return async (ctx: ActionCtx, args: Args): Promise<Result> => {
      requireValidWriteDefinition(definition);
      const entrypoints = requireEntrypoints();
      const operationAdmission = await ctx.runMutation(
        entrypoints.admitOperation,
        {
          operationId: definition.operationId,
          operationArgs: args as Record<string, unknown>,
        },
      );
      return handler(
        cloneCtxWith(ctx, { operationAdmission }) as OperationActionCtx,
        args as never,
      );
    };
  }

  function requireEntrypoints(): AdmissionEntrypoints {
    if (!config.entrypoints) {
      throw new Error(
        "Operation admission entry points are not registered on this rail.",
      );
    }
    return config.entrypoints;
  }

  async function readIngress(c: Context, withBody: boolean) {
    const request = c.req.raw;
    // Read the body exactly once and hand the same string to both the verifier
    // and the handler, so a signature covers precisely what the handler acts
    // on and the Request body is never consumed twice.
    const rawBody = withBody ? await c.req.text() : "";
    return { rawBody, request } satisfies OperationIngress;
  }

  async function verifyIngressOrDeny(
    c: Context,
    definition: OperationDefinition | OperationReadDefinition,
    ingress: OperationIngress,
  ) {
    const result = await verifyOperationIngress(
      definition,
      {
        headers: c.req.raw.headers,
        rawBody: ingress.rawBody,
        request: ingress.request,
      },
      config.ingressVerifiers,
    );
    return result;
  }

  function ingressClaimArgs(c: Context) {
    const claim = config.extractIngressClaim?.(c);
    return claim ? { [OPERATION_INGRESS_CLAIM_ARG]: claim } : {};
  }

  /**
   * Admission for a Hono write route.
   *
   * Ingress verification runs on the raw request BEFORE the admission
   * mutation, so a failed verification leaves no admission row and no capture.
   */
  function admitHttpRoute(definition: OperationDefinition, handler: HttpHandler) {
    return async (c: Context): Promise<Response> => {
      requireValidWriteDefinition(definition);
      const ingress = await readIngress(c, true);

      const verification = await verifyIngressOrDeny(c, definition, ingress);
      if (!verification.ok) {
        return c.json({ error: "Request rejected." }, 403);
      }

      const entrypoints = requireEntrypoints();
      const admission = await (
        c.env as unknown as ActionCtx
      ).runMutation(entrypoints.admitOperation, {
        operationId: definition.operationId,
        operationArgs: {
          ...requestArgs(c),
          ...ingressClaimArgs(c),
        },
      });

      return handler(c, { admission, ingress });
    };
  }

  /**
   * Admission for a Hono read route: an internal query, no write, no capture.
   */
  function admitHttpRead(
    definition: OperationReadDefinition,
    handler: HttpHandler,
  ) {
    return async (c: Context): Promise<Response> => {
      requireValidReadDefinition(definition);
      const ingress = { rawBody: "", request: c.req.raw };

      const verification = await verifyIngressOrDeny(c, definition, ingress);
      if (!verification.ok) {
        return c.json({ error: "Request rejected." }, 403);
      }

      const entrypoints = requireEntrypoints();
      const admission = await (
        c.env as unknown as ActionCtx
      ).runQuery(entrypoints.admitReadOperation, {
        operationId: definition.operationId,
        operationArgs: {
          ...requestArgs(c),
          ...ingressClaimArgs(c),
        },
      });

      return handler(c, { admission, ingress });
    };
  }

  /** Handler behind the registered internal admission mutation. */
  async function admitOperationWithCtx(
    ctx: MutationCtx,
    args: AdmissionEntrypointArgs,
  ): Promise<OperationAdmissionProjection> {
    const definition = findOperationDefinition(args.operationId);
    if (!definition) {
      throw new Error(
        `Unknown operation admission definition: ${args.operationId}`,
      );
    }
    requireValidWriteDefinition(definition);
    const admission = await resolveWriteAdmission(
      ctx,
      args.operationArgs,
      definition,
    );
    await config.capture?.(ctx, admission);
    return projectOperationAdmission(admission);
  }

  /** Handler behind the registered internal admission query (no capture). */
  async function admitReadOperationWithCtx(
    ctx: QueryCtx,
    args: AdmissionEntrypointArgs,
  ): Promise<OperationAdmissionProjection> {
    const definition = findReadOperationDefinition(args.operationId);
    if (!definition) {
      throw new Error(
        `Unknown operation read admission definition: ${args.operationId}`,
      );
    }
    requireValidReadDefinition(definition);
    const admission = await resolveReadAdmission(
      ctx,
      args.operationArgs,
      definition,
    );
    return projectOperationAdmission(admission);
  }

  return {
    admitHttpRead,
    admitHttpRoute,
    admitOperationWithCtx,
    admitPublicAction,
    admitPublicMutation,
    admitPublicQuery,
    admitReadOperationWithCtx,
    resolveReadAdmission,
    resolveWriteAdmission,
  };
}

export type AdmissionRail = ReturnType<typeof createAdmissionRail>;

/**
 * Path/query parameters are the only request-derived values the rail forwards
 * to scope resolvers. Identity never comes from here — it comes from the
 * ingress claim and the admitted actor.
 */
function requestArgs(c: Context): Record<string, unknown> {
  return { ...c.req.param(), ...c.req.query() };
}
