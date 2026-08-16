import type { Context, Next } from "hono";

import {
  readBoundedRequestBody,
  requestWithBody,
} from "../../../../operationAdmission/ingressBody";

/**
 * Route-specific body bounds, tighter than the rail's default.
 *
 * The rail now bounds EVERY admitted `http` write body before admission (see
 * `operationAdmission/ingressBody.ts`), so this middleware is no longer what
 * stands between an unauthenticated route and an endless stream. It remains
 * for the two public marketing routes, which want a much smaller cap than the
 * global default — 1 KiB for funnel events, and an env-configured limit for
 * walkthrough requests — and which answer 413 in their own response shape.
 *
 * The streaming implementation is shared with the rail rather than duplicated,
 * so there is one bounded-read behaviour to reason about.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const result = await readBoundedRequestBody(request, maxBytes);
  return result.kind === "too_large" ? null : result.bytes;
}

/**
 * Bounds the request body before the admission wrapper reads it.
 *
 * `resolveMaxBytes` may throw when the route's configuration is invalid; the
 * request is then passed through untouched so the handler can answer with its
 * own configuration response rather than being pre-empted here.
 */
export function boundRequestBody(resolveMaxBytes: () => number) {
  return async (c: Context, next: Next) => {
    let maxBytes: number;
    try {
      maxBytes = resolveMaxBytes();
    } catch {
      return next();
    }

    const bytes = await readBoundedBody(c.req.raw, maxBytes);
    if (bytes === null) {
      return c.json({ error: { code: "request_rejected" } }, 413);
    }

    // Hand the rail a request carrying exactly the bytes we accepted: the
    // original stream is spent, and re-reading it would fail.
    c.req.raw = requestWithBody(c.req.raw, bytes);

    return next();
  };
}
