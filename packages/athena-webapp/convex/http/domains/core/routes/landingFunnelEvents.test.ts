import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { landingFunnelEventRoutes } from "./landingFunnelEvents";

afterEach(() => {
  delete process.env.WALKTHROUGH_ALLOWED_ORIGINS;
});

/**
 * Admission runs its own internal mutation ahead of the handler, so "did the
 * route append an event" is a question about the funnel mutation specifically.
 * The append call is the only one carrying a milestone.
 */
const appendCalls = (runMutation: ReturnType<typeof vi.fn>) =>
  runMutation.mock.calls.filter(
    (call) => (call[1] as { event?: string })?.event,
  );

describe("landing funnel ingress", () => {
  it("exposes only the four anonymous browser milestones", () => {
    const source = readFileSync("convex/http/domains/core/routes/landingFunnelEvents.ts", "utf8");
    expect(source).toContain('"page_view", "walkthrough_cta", "demo_cta", "form_start"');
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
    expect(appendCalls(runMutation)).toHaveLength(0);
  });

  it("admits nothing when the marketing origin is not allowlisted", async () => {
    process.env.WALKTHROUGH_ALLOWED_ORIGINS = "https://athena.example";
    const runMutation = vi.fn();

    const response = await landingFunnelEventRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ event: "page_view" }),
      },
      { runMutation } as never,
    );

    expect(response.status).toBe(403);
    // The declared verifier runs ahead of the admission mutation, so a foreign
    // origin leaves no admission row behind it.
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("appends an allowlisted milestone", async () => {
    process.env.WALKTHROUGH_ALLOWED_ORIGINS = "https://athena.example";
    const runMutation = vi.fn().mockResolvedValue({});

    const response = await landingFunnelEventRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: "https://athena.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ event: "page_view" }),
      },
      { runMutation } as never,
    );

    expect(response.status).toBe(202);
    expect(appendCalls(runMutation)).toHaveLength(1);
    expect(appendCalls(runMutation)[0][1]).toMatchObject({
      event: "page_view",
      device: "unknown",
      source: "unknown",
    });
  });
});
