import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("landing funnel ingress", () => {
  it("exposes only the three anonymous browser milestones", () => {
    const source = readFileSync("convex/http/domains/core/routes/landingFunnelEvents.ts", "utf8");
    expect(source).toContain('"page_view", "walkthrough_cta", "form_start"');
    expect(source).not.toContain("durable_acceptance\"]");
    expect(source).not.toMatch(/storeId|organizationId|sessionId|email/);
  });
});
