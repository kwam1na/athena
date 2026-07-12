import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { landingFunnelEventRoutes } from "./landingFunnelEvents";

afterEach(() => {
  delete process.env.WALKTHROUGH_ALLOWED_ORIGINS;
});

describe("landing funnel ingress", () => {
  it("exposes only the three anonymous browser milestones", () => {
    const source = readFileSync("convex/http/domains/core/routes/landingFunnelEvents.ts", "utf8");
    expect(source).toContain('"page_view", "walkthrough_cta", "form_start"');
    expect(source).not.toContain("durable_acceptance\"]");
    expect(source).not.toMatch(/storeId|organizationId|sessionId|email/);
  });

  it("bounds a streaming request even without Content-Length", async () => {
    process.env.WALKTHROUGH_ALLOWED_ORIGINS = "https://athena.example";
    const request = new Request("https://athena.example/", {
      method: "POST",
      headers: {
        origin: "https://athena.example",
        "content-type": "application/json",
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(700));
          controller.enqueue(new Uint8Array(700));
        },
      }),
      duplex: "half",
    } as RequestInit);
    const runMutation = vi.fn();

    const response = await landingFunnelEventRoutes.fetch(request, {
      runMutation,
    } as never);

    expect(response.status).toBe(413);
    expect(runMutation).not.toHaveBeenCalled();
  });
});
