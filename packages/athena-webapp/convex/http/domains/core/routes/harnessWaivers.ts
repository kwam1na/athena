import { Hono } from "hono";
import type { HonoWithConvex } from "convex-helpers/server/hono";

import { internal } from "../../../../_generated/api";
import type { ActionCtx } from "../../../../_generated/server";
import type { Id } from "../../../../_generated/dataModel";
import { waiverPasskeyConfig } from "../../../../harnessWaiver/config";
import type { WaiverCandidate } from "../../../../harnessWaiver/passkeyPolicy";
import {
  consumeHarnessWaiverRouteOperationDefinition,
  createHarnessWaiverRequestRouteOperationDefinition,
} from "../../../../operationAdmission/domains/httpCore_definitions";
import { getHarnessWaiverApprovalRouteReadDefinition } from "../../../../operationAdmission/domains/httpCore_readDefinitions";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";

async function digest(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

export async function secureSecretMatches(token: string, expected: string) {
  const [actualDigest, expectedDigest] = await Promise.all([
    digest(token),
    digest(expected),
  ]);
  return actualDigest.every((value, index) => value === expectedDigest[index]);
}

async function authorized(header: string | undefined) {
  return secureSecretMatches(
    header?.replace(/^Bearer\s+/i, "") ?? "",
    waiverPasskeyConfig().brokerSecret,
  );
}

/**
 * The domain errors this route translates, and nothing else.
 *
 * Every `catch` below maps ONE recognized condition to the status the broker's
 * contract documents for it and rethrows everything else. A bare `catch` maps a
 * validator mismatch, a missing index or a thrown `TypeError` onto an expected
 * status, which tells the caller "this is normal, stop retrying" and tells
 * monitoring nothing is wrong — the exact failure the sibling fix in
 * `onlineOrder.ts` describes.
 *
 * These are matched on message because `harnessWaiver/*` throws plain `Error`s
 * with fixed strings and exports no predicate; the durable form is a typed
 * error at the throw site. The match is EXACT, never a substring, so a message
 * that drifts fails loudly as an unhandled fault rather than silently widening
 * what gets reported as an expected status.
 */
function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/**
 * A configuration miss: the broker secret, reviewer identity, RP id or origin
 * is unset (`harnessWaiver/config.ts`), or the reviewer passkey was never
 * enrolled. Genuinely "unavailable until an operator acts" — the 503 case.
 */
export function isWaiverConfigurationError(error: unknown): boolean {
  const message = errorMessage(error);
  if (message === undefined) return false;
  return (
    /^ATHENA_WAIVER_[A-Z_]+ is not configured\.$/.test(message) ||
    message === "The waiver reviewer passkey is not enrolled."
  );
}

/**
 * An approval that cannot be consumed: absent, unapproved, expired, already
 * consumed, or raised against a different candidate than the one presented.
 * All are genuine conflicts over the caller's own request — the 409 case.
 */
const WAIVER_APPROVAL_UNAVAILABLE_MESSAGES = new Set([
  "Passkey approval is unavailable.",
  "Approval request is unavailable.",
  "Approval request is consumed.",
  "Approval request is not approved.",
  "Approval request is expired.",
  "Passkey approval candidate does not match the expected candidate.",
]);

export function isWaiverApprovalUnavailable(error: unknown): boolean {
  const message = errorMessage(error);
  return message !== undefined && WAIVER_APPROVAL_UNAVAILABLE_MESSAGES.has(message);
}

export function parseWaiverCandidate(value: unknown): WaiverCandidate | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const result: WaiverCandidate = {
    repository: String(input.repository ?? ""),
    prNumber: Number(input.prNumber),
    headSha: String(input.headSha ?? ""),
    baseRef: String(input.baseRef ?? ""),
    baseSha: String(input.baseSha ?? ""),
    diffBaseSha: String(input.diffBaseSha ?? ""),
    deliverableTreeSha: String(input.deliverableTreeSha ?? ""),
    identityVersion: String(input.identityVersion ?? ""),
    waivedFindingCodes: Array.isArray(input.waivedFindingCodes)
      ? input.waivedFindingCodes.map(String)
      : [],
    reason: String(input.reason ?? "").trim(),
  };
  if (
    !result.repository ||
    !Number.isSafeInteger(result.prNumber) ||
    result.prNumber < 1 ||
    !result.headSha ||
    !result.baseRef ||
    !result.baseSha ||
    !result.diffBaseSha ||
    !result.deliverableTreeSha ||
    !result.identityVersion ||
    !result.reason ||
    result.waivedFindingCodes.length === 0 ||
    result.waivedFindingCodes.some(
      (code) => !["compound-solution", "landed-change-report"].includes(code),
    )
  ) return undefined;
  return result;
}

const harnessWaiverRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * Broker authorization stays in front of the rail.
 *
 * The same bearer secret is declared on each definition as an ingress verifier,
 * so the boundary is stated where the operation is declared. This middleware is
 * what keeps the broker's status contract exact — 401 for a wrong or missing
 * credential, 503 when the secret is not configured — and it runs before the
 * admission mutation, so a rejected call leaves no admission row.
 */
harnessWaiverRoutes.use("*", async (c, next) => {
  try {
    if (!(await authorized(c.req.header("authorization")))) {
      return c.json({ error: { code: "unauthorized" } }, 401);
    }
  } catch (error) {
    // Only an unconfigured broker secret is the documented 503. A digest
    // failure or any other fault inside `authorized` is a fault and surfaces
    // as one rather than posing as a dependency that will come back.
    if (isWaiverConfigurationError(error)) {
      return c.json({ error: { code: "temporarily_unavailable" } }, 503);
    }
    throw error;
  }
  await next();
});

harnessWaiverRoutes.post(
  "/requests",
  admitHttpRoute(
    createHarnessWaiverRequestRouteOperationDefinition,
    async (c, { ingress }) => {
      const parsed = parseWaiverCandidate(parseJson(ingress.rawBody));
      if (!parsed) return c.json({ error: { code: "invalid_candidate" } }, 400);
      try {
        const result = await c.env.runAction(
          internal.harnessWaiver.passkeys.createApprovalRequest,
          { candidate: parsed },
        );
        return c.json(result, 201);
      } catch (error) {
        // 503 means "unconfigured, an operator must act" — an unenrolled
        // reviewer passkey or a missing waiver variable. A failed approval
        // write or a WebAuthn library exception is not that, and reporting it
        // as 503 hid the outage behind a status the broker retries forever.
        if (isWaiverConfigurationError(error)) {
          console.error("harness_waiver_request_unconfigured", error);
          return c.json({ error: { code: "temporarily_unavailable" } }, 503);
        }
        throw error;
      }
    },
  ),
);

harnessWaiverRoutes.get(
  "/requests/:approvalId",
  admitHttpRead(getHarnessWaiverApprovalRouteReadDefinition, async (c) => {
    const approval = await c.env.runQuery(internal.harnessWaiver.storage.getApprovalById, {
      approvalId: c.req.param("approvalId") as Id<"harnessWaiverApproval">,
    }).catch(() => null);
    if (!approval) return c.json({ error: { code: "not_found" } }, 404);
    return c.json({
      approvalId: approval._id,
      status: approval.status,
      expiresAt: approval.expiresAt,
      approvedAt: approval.approvedAt,
    });
  }),
);

harnessWaiverRoutes.post(
  "/requests/:approvalId/consume",
  admitHttpRoute(
    consumeHarnessWaiverRouteOperationDefinition,
    async (c, { ingress }) => {
      const expectedCandidate = parseWaiverCandidate(parseJson(ingress.rawBody));
      if (!expectedCandidate) return c.json({ error: { code: "invalid_candidate" } }, 400);
      try {
        const receipt = await c.env.runMutation(internal.harnessWaiver.storage.consume, {
          approvalId: c.req.param("approvalId") as Id<"harnessWaiverApproval">,
          expectedCandidate,
          consumedAt: Date.now(),
        });
        return c.json(receipt);
      } catch (error) {
        // 409 is a conflict over THIS approval: unapproved, expired, already
        // consumed, or raised for a different candidate. Anything else is a
        // fault; the previous bare `catch` reported a broken mutation as a
        // clean client conflict and monitoring never saw it.
        if (isWaiverApprovalUnavailable(error)) {
          return c.json({ error: { code: "approval_unavailable" } }, 409);
        }
        throw error;
      }
    },
  ),
);

/**
 * A malformed body is a client error, so `null` here becomes the route's 400.
 * Only a parse failure means that: a `SyntaxError` is the sole error
 * `JSON.parse` raises over a string, and anything else escaping this call is a
 * fault that must not be laundered into "invalid_candidate".
 */
function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export { harnessWaiverRoutes };
