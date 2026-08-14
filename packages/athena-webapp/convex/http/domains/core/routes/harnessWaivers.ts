import { Hono } from "hono";
import type { HonoWithConvex } from "convex-helpers/server/hono";

import { internal } from "../../../../_generated/api";
import type { ActionCtx } from "../../../../_generated/server";
import type { Id } from "../../../../_generated/dataModel";
import { waiverPasskeyConfig } from "../../../../harnessWaiver/config";
import type { WaiverCandidate } from "../../../../harnessWaiver/passkeyPolicy";

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

harnessWaiverRoutes.use("*", async (c, next) => {
  try {
    if (!(await authorized(c.req.header("authorization")))) {
      return c.json({ error: { code: "unauthorized" } }, 401);
    }
  } catch {
    return c.json({ error: { code: "temporarily_unavailable" } }, 503);
  }
  await next();
});

harnessWaiverRoutes.post("/requests", async (c) => {
  const parsed = parseWaiverCandidate(await c.req.json().catch(() => null));
  if (!parsed) return c.json({ error: { code: "invalid_candidate" } }, 400);
  try {
    const result = await c.env.runAction(
      internal.harnessWaiver.passkeys.createApprovalRequest,
      { candidate: parsed },
    );
    return c.json(result, 201);
  } catch (error) {
    console.error("harness_waiver_request_failed", error);
    return c.json({ error: { code: "temporarily_unavailable" } }, 503);
  }
});

harnessWaiverRoutes.get("/requests/:approvalId", async (c) => {
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
});

harnessWaiverRoutes.post("/requests/:approvalId/consume", async (c) => {
  const expectedCandidate = parseWaiverCandidate(await c.req.json().catch(() => null));
  if (!expectedCandidate) return c.json({ error: { code: "invalid_candidate" } }, 400);
  try {
    const receipt = await c.env.runMutation(internal.harnessWaiver.storage.consume, {
      approvalId: c.req.param("approvalId") as Id<"harnessWaiverApproval">,
      expectedCandidate,
      consumedAt: Date.now(),
    });
    return c.json(receipt);
  } catch {
    return c.json({ error: { code: "approval_unavailable" } }, 409);
  }
});

export { harnessWaiverRoutes };
