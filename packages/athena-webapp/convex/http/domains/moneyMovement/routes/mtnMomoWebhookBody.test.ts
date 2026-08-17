/// <reference types="vite/client" />

/**
 * The MTN MoMo callback's body must survive the middleware and reach the rail.
 *
 * The sibling regression to `whatsappWebhookBody.test.ts`, and the same defect:
 * this route verifies a shared secret in a `.use("*")` middleware that reads
 * the body, while the rail reads `c.req.raw.body` DIRECTLY — not through Hono's
 * `HonoRequest#bodyCache`. A Fetch body stream is readable exactly once, so
 * without a reconstruction the rail would see an empty body, re-run the same
 * declared verifier, and deny every genuine callback.
 *
 * The verifier here is a shared secret rather than an HMAC, so an empty body
 * would not by itself fail verification — which makes this the MORE dangerous
 * of the two, because the failure would surface downstream as an unparseable
 * notification rather than as a clean denial. The assertion is therefore on the
 * bytes the handler receives, not merely on the status.
 */

import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";

import { internal } from "../../../../_generated/api";
import {
  MTN_MOMO_CALLBACK_SECRET_ENV,
  MTN_MOMO_CALLBACK_SECRET_HEADER,
} from "../../../../operationAdmission/ingressVerification";

import { mtnMomoRoutes } from "./mtnMomo";

const ADMIT_WRITE = getFunctionName(
  internal.platform.admissionEntrypoints.admitOperation,
);

const SECRET = "mtn-callback-secret";

/**
 * Records the admission call. The rail verifies the body before admitting, so
 * reaching this at all means the bytes survived the middleware. The admission
 * is canned — this test is about the handoff, not about a real database
 * context.
 */
function convexEnv() {
  const admissionCalls: Record<string, unknown>[] = [];
  const dispatch = async (ref: unknown, args: Record<string, unknown>) => {
    if (getFunctionName(ref as never) === ADMIT_WRITE) {
      admissionCalls.push(args);
      return {
        actor: { kind: "public" },
        constraints: {},
        decision: { adapter: "public", outcome: "admitted" },
        operationId: args.operationId,
        provenance: {},
      };
    }
    return null;
  };
  return {
    admissionCalls,
    env: { runMutation: dispatch, runQuery: dispatch, runAction: dispatch },
  };
}

async function post(
  body: string,
  options: { secret?: string; header?: boolean } = {},
) {
  const { admissionCalls, env } = convexEnv();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.secret && options.header !== false) {
    headers.set(MTN_MOMO_CALLBACK_SECRET_HEADER, options.secret);
  }
  const response = await mtnMomoRoutes.fetch(
    new Request("https://api.test/collections", {
      method: "POST",
      headers,
      body,
    }),
    env as never,
  );
  return { admissionCalls, response };
}

describe("mtn momo callback body handoff", () => {
  it("hands the callback bytes through the middleware to the rail", async () => {
    vi.stubEnv(MTN_MOMO_CALLBACK_SECRET_ENV, SECRET);
    const rawBody = JSON.stringify({
      externalId: "order-1",
      status: "SUCCESSFUL",
    });

    const { admissionCalls, response } = await post(rawBody, {
      secret: SECRET,
    });

    // Reaching admission means the body survived: the rail verifies before it
    // admits. A drained body would deny (403) or trip the `bodyUsed` guard.
    expect(admissionCalls).toHaveLength(1);
    expect([403, 500]).not.toContain(response.status);
    vi.unstubAllEnvs();
  });

  it("rejects a wrong secret in front of the rail", async () => {
    vi.stubEnv(MTN_MOMO_CALLBACK_SECRET_ENV, SECRET);
    const { admissionCalls, response } = await post("{}", {
      secret: "not-the-secret",
    });

    expect(response.status).toBe(401);
    // Rejected before admission: no admission row for a bad callback.
    expect(admissionCalls).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it("reports an unconfigured secret as 503, distinct from a wrong one", async () => {
    vi.stubEnv(MTN_MOMO_CALLBACK_SECRET_ENV, "");
    const { admissionCalls, response } = await post("{}", { secret: SECRET });

    expect(response.status).toBe(503);
    expect(admissionCalls).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it("refuses an oversize callback before reading it all", async () => {
    vi.stubEnv(MTN_MOMO_CALLBACK_SECRET_ENV, SECRET);
    // These endpoints are unauthenticated at the point the body is read, so the
    // bound has to be in the middleware, not only in the rail behind it.
    const { admissionCalls, response } = await post("x".repeat(2_000_000), {
      secret: SECRET,
    });

    expect(response.status).toBe(413);
    expect(admissionCalls).toHaveLength(0);
    vi.unstubAllEnvs();
  });
});
