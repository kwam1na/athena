import type { Context } from "hono";
import type { FunctionReference } from "convex/server";

import type {
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";
import {
  DEFAULT_INGRESS_MAX_BODY_BYTES,
  readBoundedRequestBody,
  requestWithBody,
} from "./ingressBody";
import {
  asOperationAdmissionDenial,
  operationAdmissionDenialData,
  resolveAdmissionChain,
} from "./adapters";
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
  /**
   * Cap on an admitted HTTP write body, applied to EVERY `http` write before
   * admission. Defaults to `DEFAULT_INGRESS_MAX_BODY_BYTES`. A route needing a
   * tighter bound still layers its own middleware in front.
   */
  maxIngressBodyBytes?: number;
};

/**
 * Handler shapes.
 *
 * The wrappers are generic over the HANDLER rather than over its argument
 * type, so a handler that annotates its `args` keeps that exact type through
 * the wrapper while a handler that leaves `args` to the surrounding
 * `mutation({ args })` validator is contextually typed instead of being
 * clamped to `Record<string, unknown>`. `ctx` is always contextually typed to
 * the admitted context, which is what puts `ctx.operationAdmission` in scope.
 */
type DomainMutationHandler = (
  ctx: OperationMutationCtx,
  args: any,
) => Promise<any>;

type DomainQueryHandler = (
  ctx: OperationQueryCtx,
  args: any,
) => Promise<any>;

export type OperationActionCtx = ActionCtx & {
  operationAdmission: OperationAdmissionProjection;
};

type DomainActionHandler = (
  ctx: OperationActionCtx,
  args: any,
) => Promise<any>;

/**
 * The handler's declared argument type, or the open record when it declares
 * none (a test double, or a handler that ignores its arguments).
 */
type HandlerArgs<Handler extends (...args: never[]) => unknown> =
  Parameters<Handler> extends [unknown, infer Args]
    ? Args
    : Record<string, unknown>;

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

  function admitPublicMutation<Handler extends DomainMutationHandler>(
    definition: OperationDefinition,
    handler: Handler,
    options: {
      resolveAdmission?: (
        ctx: MutationCtx,
        args: HandlerArgs<Handler>,
        definition: OperationDefinition,
      ) => Promise<OperationAdmissionContext>;
    } = {},
  ) {
    type Args = HandlerArgs<Handler>;
    type Result = Awaited<ReturnType<Handler>>;
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

  function admitPublicQuery<Handler extends DomainQueryHandler>(
    definition: OperationReadDefinition,
    handler: Handler,
    options: {
      resolveAdmission?: (
        ctx: QueryCtx,
        args: HandlerArgs<Handler>,
        definition: OperationReadDefinition,
      ) => Promise<OperationAdmissionContext>;
    } = {},
  ) {
    type Args = HandlerArgs<Handler>;
    type Result = Awaited<ReturnType<Handler>>;
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
  function admitPublicAction<Handler extends DomainActionHandler>(
    definition: OperationDefinition,
    handler: Handler,
  ) {
    type Args = HandlerArgs<Handler>;
    type Result = Awaited<ReturnType<Handler>>;
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

  /**
   * Read the body exactly once and hand the same string to both the verifier
   * and the handler, so a signature covers precisely what the handler acts on
   * and the Request body is never consumed twice.
   *
   * The read is BOUNDED for every admitted write, not just the routes that
   * remembered to add middleware, and it is bounded before admission so an
   * oversize request leaves no admission row.
   */
  async function readIngress(
    c: Context,
    withBody: boolean,
  ): Promise<
    { kind: "ok"; ingress: OperationIngress } | { kind: "too_large" }
  > {
    if (!withBody) {
      return {
        kind: "ok",
        ingress: { rawBody: "", request: c.req.raw },
      };
    }

    const maxBytes = config.maxIngressBodyBytes ?? DEFAULT_INGRESS_MAX_BODY_BYTES;
    const bounded = await readBoundedRequestBody(c.req.raw, maxBytes);
    if (bounded.kind === "too_large") return { kind: "too_large" };

    const request = requestWithBody(c.req.raw, bounded.bytes);
    c.req.raw = request;
    const rawBody = new TextDecoder().decode(bounded.bytes);
    return { kind: "ok", ingress: { rawBody, request } };
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
  /**
   * The fixed HTTP contract for an admission refusal.
   *
   * Without this, a denial thrown inside the admission mutation escapes the
   * Hono handler and Convex renders it as a **500** — a refusal reported as a
   * server fault. That is wrong in three ways: clients retry 5xx, monitoring
   * pages on it, and the response body leaks the internal error text.
   *
   * `unauthenticated` (no adapter claimed the caller) is 401; an actual
   * refusal is 403. The distinction comes from typed data on the error, never
   * from its message. The body is fixed so a denial reveals nothing about why
   * — probing the difference between "wrong store" and "no such row" is the
   * exact thing the ownership denials are shaped to prevent.
   */
  function admissionDenialResponse(c: Context, error: unknown) {
    const denial = operationAdmissionDenialData(error);
    if (!denial) return undefined;
    return denial.outcome === "unauthenticated"
      ? c.json({ error: "Authentication required." }, 401)
      : c.json({ error: "Request rejected." }, 403);
  }

  function admitHttpRoute(definition: OperationDefinition, handler: HttpHandler) {
    return async (c: Context): Promise<Response> => {
      requireValidWriteDefinition(definition);
      const read = await readIngress(c, true);
      if (read.kind === "too_large") {
        // Same body shape as the 401/403 denials above: one `error` string.
        return c.json({ error: "Request body too large." }, 413);
      }
      const ingress = read.ingress;

      const verification = await verifyIngressOrDeny(c, definition, ingress);
      if (!verification.ok) {
        return c.json({ error: "Request rejected." }, 403);
      }

      const entrypoints = requireEntrypoints();
      let admission;
      try {
        admission = await (
          c.env as unknown as ActionCtx
        ).runMutation(entrypoints.admitOperation, {
          operationId: definition.operationId,
          operationArgs: {
            ...requestArgs(c),
            ...ingressClaimArgs(c),
          },
        });
      } catch (error) {
        const denial = admissionDenialResponse(c, error);
        if (denial) return denial;
        throw error;
      }

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
      // Reads carry no body: nothing to bound, and nothing to hand a verifier.
      const ingress = { rawBody: "", request: c.req.raw };

      const verification = await verifyIngressOrDeny(c, definition, ingress);
      if (!verification.ok) {
        return c.json({ error: "Request rejected." }, 403);
      }

      const entrypoints = requireEntrypoints();
      let admission;
      try {
        admission = await (
          c.env as unknown as ActionCtx
        ).runQuery(entrypoints.admitReadOperation, {
          operationId: definition.operationId,
          operationArgs: {
            ...requestArgs(c),
            ...ingressClaimArgs(c),
          },
        });
      } catch (error) {
        const denial = admissionDenialResponse(c, error);
        if (denial) return denial;
        throw error;
      }

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
    // Tag admission failures so HTTP ingress can tell "refused" from "broke"
    // on the far side of the runMutation boundary without reading messages.
    let admission: OperationAdmissionContext;
    try {
      admission = await resolveWriteAdmission(
        ctx,
        args.operationArgs,
        definition,
      );
    } catch (error) {
      // A rail-raised denial is re-thrown as typed data HTTP ingress can map;
      // anything else is a genuine fault and must keep surfacing as a 500.
      throw asOperationAdmissionDenial(error) ?? error;
    }
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
    let admission: OperationAdmissionContext;
    try {
      admission = await resolveReadAdmission(
        ctx,
        args.operationArgs,
        definition,
      );
    } catch (error) {
      throw asOperationAdmissionDenial(error) ?? error;
    }
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
/**
 * Admission arguments from the request, PATH LAST.
 *
 * A path parameter is part of the route the router already matched; a query
 * string is free-form caller input. Spreading query last let `?storeId=…`
 * override the `:storeId` the route matched, so a definition scoping itself
 * with `storeIdArg` could be clamped to a store the path never named. Path
 * wins.
 */
function requestArgs(c: Context): Record<string, unknown> {
  return { ...c.req.query(), ...c.req.param() };
}
