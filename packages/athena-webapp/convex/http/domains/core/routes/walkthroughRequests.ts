import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { internal } from "../../../../_generated/api";
import type { ActionCtx } from "../../../../_generated/server";
import {
  walkthroughAllowedOrigins,
  walkthroughDailyPerEmailLimit,
  walkthroughHourlyGlobalLimit,
  walkthroughMaxBodyBytes,
  walkthroughPrivacyContact,
} from "../../../../marketing/walkthroughConfig";
import { getWalkthroughHmacVerificationKeys } from "../../../../marketing/walkthroughHmac";

export function evaluateWalkthroughIngress(input: { origin?: string; contentType?: string; contentLength?: number; allowedOrigins: string[]; maxBytes: number }) {
  if (!input.origin || !input.allowedOrigins.includes(input.origin)) return { ok: false as const, status: 403 as const };
  if (!/^application\/json(?:\s*;|$)/i.test(input.contentType ?? "")) return { ok: false as const, status: 415 as const };
  if (input.contentLength !== undefined && (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0)) return { ok: false as const, status: 413 as const };
  if ((input.contentLength ?? 0) > input.maxBytes) return { ok: false as const, status: 413 as const };
  return { ok: true as const };
}
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function canonical(body: Record<string, unknown>) { return JSON.stringify({ name: text(body.name).replace(/\s+/g, " ").trim(), workEmail: text(body.workEmail).replace(/\s+/g, "").toLowerCase(), businessName: text(body.businessName).replace(/\s+/g, " ").trim(), phone: text(body.phone).replace(/\s+/g, " ").trim() || undefined, businessNeed: text(body.businessNeed).replace(/\s+/g, " ").trim() }); }
async function sha256(value: string) { const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); return `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`; }

const walkthroughRequestRoutes: HonoWithConvex<ActionCtx> = new Hono();
walkthroughRequestRoutes.post("/", async (c) => {
  let maxBytes: number;
  let allowedOrigins: string[];
  try {
    maxBytes = walkthroughMaxBodyBytes();
    allowedOrigins = walkthroughAllowedOrigins();
    walkthroughDailyPerEmailLimit();
    walkthroughHourlyGlobalLimit();
    getWalkthroughHmacVerificationKeys();
    walkthroughPrivacyContact();
  } catch {
    console.error("walkthrough_ingress_configuration_invalid");
    return c.json({ error: { code: "temporarily_unavailable" } }, 503);
  }
  const contentLengthHeader = c.req.header("content-length");
  const ingress = evaluateWalkthroughIngress({ origin: c.req.header("origin"), contentType: c.req.header("content-type"), contentLength: contentLengthHeader === undefined ? undefined : Number(contentLengthHeader), allowedOrigins, maxBytes });
  if (!ingress.ok) return c.json({ error: { code: "request_rejected" } }, ingress.status);
  const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
  if (bytes.byteLength > maxBytes) return c.json({ error: { code: "request_rejected" } }, 413);
  let body: Record<string, unknown>;
  try { const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes)); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); body = parsed as Record<string, unknown>; } catch { return c.json({ error: { code: "request_rejected" } }, 400); }
  if (text(body.website).trim()) return c.json({ accepted: true }, 202);
  try {
    const result = await c.env.runMutation(internal.marketing.walkthroughRequests.accept, { submissionKey: text(body.submissionKey), payloadDigest: await sha256(canonical(body)), name: text(body.name), workEmail: text(body.workEmail), businessName: text(body.businessName), phone: text(body.phone) || undefined, businessNeed: text(body.businessNeed), submittedAt: Date.now() });
    if (result.accepted) return c.json({ accepted: true }, 202);
    return c.json({ error: { code: result.reason === "retry" ? "retry_required" : "temporarily_unavailable" } }, 503);
  } catch { return c.json({ error: { code: "request_rejected" } }, 400); }
});
export { walkthroughRequestRoutes };
