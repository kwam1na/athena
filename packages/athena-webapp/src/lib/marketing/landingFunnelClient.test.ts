import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitLandingFunnelEvent,
  resetLandingFunnelDedupeForTests,
} from "./landingFunnelClient";

describe("landing funnel client", () => {
  beforeEach(resetLandingFunnelDedupeForTests);

  it("emits each approved event once with coarse non-identifying context", () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    expect(emitLandingFunnelEvent("page_view", { apiGatewayUrl: "https://api.example", fetchImpl })).toBe(true);
    expect(emitLandingFunnelEvent("page_view", { apiGatewayUrl: "https://api.example", fetchImpl })).toBe(false);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.example/marketing/funnel-events");
    expect(JSON.parse(init.body)).toEqual({
      event: "page_view",
      device: expect.stringMatching(/^(mobile|tablet|desktop|unknown)$/),
      source: "unknown",
    });
    expect(init.body).not.toMatch(/email|phone|business|submission/i);
  });

  it("emits the demo CTA milestone through the same anonymous pipeline", () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    expect(emitLandingFunnelEvent("demo_cta", { apiGatewayUrl: "https://api.example", fetchImpl })).toBe(true);
    expect(emitLandingFunnelEvent("demo_cta", { apiGatewayUrl: "https://api.example", fetchImpl })).toBe(false);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body).event).toBe("demo_cta");
  });

  it("does not make a request without an owned gateway", () => {
    const fetchImpl = vi.fn();
    expect(emitLandingFunnelEvent("form_start", { apiGatewayUrl: "", fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
