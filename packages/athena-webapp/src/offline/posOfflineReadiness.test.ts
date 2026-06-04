import { describe, expect, it } from "vitest";

import { buildPosOfflineReadinessSummary } from "./posOfflineReadiness";

describe("buildPosOfflineReadinessSummary", () => {
  it("keeps each offline readiness domain distinct", () => {
    const summary = buildPosOfflineReadinessSummary({
      appShell: { ready: true },
      availabilitySnapshot: { ready: true, ageMs: 10 * 60_000 },
      registerCatalog: { ready: true, ageMs: 20 * 60_000 },
      serviceCatalog: { ready: true, ageMs: 30 * 60_000 },
      staffAuthority: { ready: true },
      terminalSeed: { ready: true },
    });

    expect(summary.status).toBe("ready");
    expect(summary.readyCount).toBe(6);
    expect(summary.signals.map((signal) => signal.domain)).toEqual([
      "app_shell",
      "terminal_seed",
      "staff_authority",
      "register_catalog",
      "service_catalog",
      "availability_snapshot",
    ]);
    expect(summary.description).toContain("diagnostic view");
  });

  it("reports stale snapshots as diagnostic attention without authorizing sales", () => {
    const summary = buildPosOfflineReadinessSummary({
      appShell: { ready: true },
      availabilitySnapshot: { ready: true, ageMs: 49 * 60 * 60_000 },
      registerCatalog: { ready: true, ageMs: 5 * 60_000 },
      serviceCatalog: { ready: true, ageMs: 5 * 60_000 },
      staffAuthority: { ready: true },
      terminalSeed: { ready: true },
    });

    expect(summary.status).toBe("needs_attention");
    expect(summary.description).toBe(
      "One or more offline readiness signals need attention. This view is diagnostic only.",
    );
    expect(
      summary.signals.find(
        (signal) => signal.domain === "availability_snapshot",
      ),
    ).toMatchObject({
      description: "Availability snapshot is 2 days old.",
      status: "needs_attention",
    });
  });

  it("keeps app shell readiness unknown when it has not integrated yet", () => {
    const summary = buildPosOfflineReadinessSummary({
      terminalSeed: { ready: true },
    });

    expect(summary.status).toBe("unknown");
    expect(summary.readyCount).toBe(1);
    expect(summary.signals[0]).toMatchObject({
      domain: "app_shell",
      status: "unknown",
    });
  });
});
