import { describe, expect, it } from "vitest";

import { buildPosOfflineReadinessSummary } from "./posOfflineReadiness";

describe("buildPosOfflineReadinessSummary", () => {
  it("keeps each offline readiness domain distinct", () => {
    const summary = buildPosOfflineReadinessSummary({
      appSession: { ready: true },
      appShell: { ready: true },
      availabilitySnapshot: { ready: true, ageMs: 10 * 60_000 },
      registerCatalog: { ready: true, ageMs: 20 * 60_000 },
      serviceCatalog: { ready: true, ageMs: 30 * 60_000 },
      staffAuthority: { ready: true },
      terminalSeed: { ready: true },
    });

    expect(summary.status).toBe("ready");
    expect(summary.title).toBe("Register ready for offline checkout");
    expect(summary.readyCount).toBe(7);
    expect(summary.signals.map((signal) => signal.domain)).toEqual([
      "app_shell",
      "app_session",
      "terminal_seed",
      "staff_authority",
      "register_catalog",
      "service_catalog",
      "availability_snapshot",
    ]);
    expect(summary.description).toContain("needed for offline POS");
  });

  it("reports stale snapshots as diagnostic attention without authorizing sales", () => {
    const summary = buildPosOfflineReadinessSummary({
      appSession: { ready: true },
      appShell: { ready: true },
      availabilitySnapshot: { ready: true, ageMs: 49 * 60 * 60_000 },
      registerCatalog: { ready: true, ageMs: 5 * 60_000 },
      serviceCatalog: { ready: true, ageMs: 5 * 60_000 },
      staffAuthority: { ready: true },
      terminalSeed: { ready: true },
    });

    expect(summary.status).toBe("needs_attention");
    expect(summary.description).toBe(
      "One or more offline diagnostic signals need attention. This view is diagnostic only.",
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
      description: "App shell status has not reported to this page yet.",
      domain: "app_shell",
      status: "unknown",
    });
  });

  it("treats app-session-unverified continuation as support-safe diagnostics", () => {
    const summary = buildPosOfflineReadinessSummary({
      appSession: {
        status: "local_continuation",
      },
      appShell: { ready: true },
      availabilitySnapshot: { ready: true, ageMs: 10 * 60_000 },
      registerCatalog: { ready: true, ageMs: 20 * 60_000 },
      serviceCatalog: { ready: true, ageMs: 30 * 60_000 },
      staffAuthority: { ready: true },
      terminalSeed: { ready: true },
    });

    expect(summary.status).toBe("ready");
    expect(summary.description).toContain("local sale continuation");
    expect(
      summary.signals.find((signal) => signal.domain === "app_session"),
    ).toMatchObject({
      description:
        "App session is unverified while offline. Sales can continue locally and sync later for reconciliation.",
      status: "local_continuation",
    });
  });
});
