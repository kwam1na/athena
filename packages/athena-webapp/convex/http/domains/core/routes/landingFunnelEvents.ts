import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { internal } from "../../../../_generated/api";
import type { ActionCtx } from "../../../../_generated/server";
import {
  landingFunnelHourlyLimit,
  walkthroughAllowedOrigins,
} from "../../../../marketing/walkthroughConfig";
import { readBoundedBody } from "./boundedBody";

const events = new Set(["page_view", "walkthrough_cta", "demo_cta", "form_start"]);
const devices = new Set(["mobile", "desktop", "tablet", "unknown"]);
const sources = new Set(["direct", "search", "social", "referral", "unknown"]);
const landingFunnelEventRoutes: HonoWithConvex<ActionCtx> = new Hono();
landingFunnelEventRoutes.post("/", async (c) => {
  let origins: string[];
  try {
    origins = walkthroughAllowedOrigins();
    landingFunnelHourlyLimit();
  } catch {
    console.error("landing_funnel_ingress_configuration_invalid");
    return c.json({ accepted: true }, 202);
  }
  if (!origins.includes(c.req.header("origin") ?? "") || !/^application\/json(?:\s*;|$)/i.test(c.req.header("content-type") ?? "")) return c.json({ error: { code: "request_rejected" } }, 403);
  const contentLengthHeader = c.req.header("content-length");
  const contentLength = contentLengthHeader === undefined ? undefined : Number(contentLengthHeader);
  if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 1_024)) return c.json({ error: { code: "request_rejected" } }, 413);
  const bytes = await readBoundedBody(c.req.raw, 1_024);
  if (!bytes) return c.json({ error: { code: "request_rejected" } }, 413);
  let body: Record<string, unknown>;
  try { const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes)); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); body = parsed as Record<string, unknown>; } catch { return c.json({ error: { code: "request_rejected" } }, 400); }
  const event = typeof body.event === "string" && events.has(body.event) ? body.event as "page_view" | "walkthrough_cta" | "demo_cta" | "form_start" : null;
  const device = typeof body.device === "string" && devices.has(body.device) ? body.device as "mobile" | "desktop" | "tablet" | "unknown" : "unknown";
  const source = typeof body.source === "string" && sources.has(body.source) ? body.source as "direct" | "search" | "social" | "referral" | "unknown" : "unknown";
  if (!event || Object.keys(body).some((key) => !["event", "device", "source"].includes(key))) return c.json({ error: { code: "request_rejected" } }, 400);
  try {
    await c.env.runMutation(internal.marketing.landingFunnelEvents.appendPublic, { event, device, source, occurredAt: Date.now() });
  } catch {
    console.error("landing_funnel_append_failed");
  }
  return c.json({ accepted: true }, 202);
});
export { landingFunnelEventRoutes };
