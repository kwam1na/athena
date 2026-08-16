/// <reference types="vite/client" />

/**
 * The signed body must survive the middleware and reach the rail intact.
 *
 * This is a regression test for a defect the isolated verifier tests could not
 * see. `whatsapp.ts` verifies the HMAC in a `.use("*")` middleware that reads
 * the body with `c.req.text()`. The rail then reads `c.req.raw.body` DIRECTLY —
 * not through Hono's `HonoRequest#bodyCache` — and a Fetch body stream is
 * readable exactly once. So the rail saw an empty body, re-ran the same
 * declared verifier against it, and denied every genuine callback with a 403.
 *
 * Nothing caught it because the verifier was only ever tested in isolation, on
 * a `rawBody` string handed straight to it. The bug lived in the seam between
 * the middleware and the rail, so only a request driven through the real
 * exported router can pin it.
 *
 * The MTN MoMo callback middleware had the identical shape.
 */

import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";

import { internal } from "../../../../_generated/api";
import { WHATSAPP_APP_SECRET_ENV } from "../../../../operationAdmission/ingressVerification";

import { whatsappMessagingRoutes } from "./whatsapp";

const ADMIT_WRITE = getFunctionName(
  internal.platform.admissionEntrypoints.admitOperation,
);

const APP_SECRET = "whatsapp-app-secret";

async function signMetaBody(rawBody: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  return `sha256=${Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

/**
 * Env double that records whether the rail reached its admission entry point.
 *
 * That call is the observable that matters here. The rail reads and verifies
 * the body BEFORE admitting, so it is reached only when the middleware handed
 * back a readable request carrying the signed bytes. If the body was consumed
 * and not reconstructed, the rail either denies on a signature mismatch or
 * trips its `bodyUsed` guard — either way it never gets this far.
 *
 * The admission itself is canned rather than real: this test is about the
 * body handoff, and a real admission would drag in a database context that
 * would fail for reasons unrelated to the seam under test.
 */
function convexEnv() {
  const admissionCalls: unknown[] = [];
  const dispatch = async (ref: any, args: any) => {
    if (getFunctionName(ref) === ADMIT_WRITE) {
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

async function post(body: string, signature: string) {
  const { admissionCalls, env } = convexEnv();
  const request = new Request("https://api.test/", {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/json",
      "x-hub-signature-256": signature,
    }),
    body,
  });
  const response = await whatsappMessagingRoutes.fetch(request, env as never);
  return { admissionCalls, response };
}

describe("whatsapp webhook body handoff", () => {
  it("hands the signed bytes through the middleware to the rail", async () => {
    vi.stubEnv(WHATSAPP_APP_SECRET_ENV, APP_SECRET);
    const rawBody = JSON.stringify({
      entry: [],
      object: "whatsapp_business_account",
    });
    const { admissionCalls, response } = await post(
      rawBody,
      await signMetaBody(rawBody, APP_SECRET),
    );

    // Reaching admission at all is the assertion: the rail verifies the body
    // first, so this is only reachable when the signed bytes survived the
    // middleware. Before the fix the rail saw an empty body and denied (403),
    // and with the `bodyUsed` guard it now throws instead (500) — neither
    // reaches here.
    expect(admissionCalls).toHaveLength(1);
    expect([403, 500]).not.toContain(response.status);
    vi.unstubAllEnvs();
  });

  it("still rejects a body whose signature does not cover it", async () => {
    vi.stubEnv(WHATSAPP_APP_SECRET_ENV, APP_SECRET);
    const rawBody = JSON.stringify({ entry: [] });
    const signature = await signMetaBody(rawBody, APP_SECRET);
    const { admissionCalls, response } = await post(`${rawBody} `, signature);

    expect(response.status).toBe(401);
    // Rejected in front of the rail: no admission row for a bad signature.
    expect(admissionCalls).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it("reports an unconfigured app secret as 503, not as a bad signature", async () => {
    vi.stubEnv(WHATSAPP_APP_SECRET_ENV, "");
    const rawBody = JSON.stringify({ entry: [] });
    const { admissionCalls, response } = await post(rawBody, "sha256=deadbeef");

    expect(response.status).toBe(503);
    expect(admissionCalls).toHaveLength(0);
    vi.unstubAllEnvs();
  });
});
