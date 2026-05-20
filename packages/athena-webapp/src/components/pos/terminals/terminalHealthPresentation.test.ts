import { describe, expect, it, vi } from "vitest";

import {
  classifyTerminalHealth,
  formatAge,
  formatTerminalTimestamp,
  getSnapshotAgeSummary,
} from "./terminalHealthPresentation";

describe("terminal health presentation", () => {
  it("classifies missing check-ins, stale check-ins, pending sync, and review work", () => {
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));

    expect(
      classifyTerminalHealth({
        runtimeStatus: null,
        syncEvidence: { unresolvedConflictCount: 0 },
        terminal: { status: "active" },
      }).label,
    ).toBe("No check-in");

    expect(
      classifyTerminalHealth({
        health: "offline",
        runtimeStatus: {
          receivedAt: Date.now() - 20 * 60_000,
          sync: {
            failedEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 0,
            status: "idle",
            uploadableEventCount: 0,
          },
        },
        syncEvidence: { unresolvedConflictCount: 0 },
        terminal: { status: "active" },
      }).label,
    ).toBe("Offline");

    expect(
      classifyTerminalHealth({
        runtimeStatus: {
          receivedAt: Date.now() - 46 * 60_000,
          sync: {
            failedEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 0,
            status: "idle",
            uploadableEventCount: 0,
          },
        },
        syncEvidence: { unresolvedConflictCount: 0 },
        terminal: { status: "active" },
      }).label,
    ).toBe("Stale");

    expect(
      classifyTerminalHealth({
        runtimeStatus: {
          receivedAt: Date.now(),
          sync: {
            failedEventCount: 0,
            pendingEventCount: 3,
            reviewEventCount: 0,
            status: "pending",
            uploadableEventCount: 2,
          },
        },
        syncEvidence: { unresolvedConflictCount: 0 },
        terminal: { status: "active" },
      }).label,
    ).toBe("Pending sync");

    expect(
      classifyTerminalHealth({
        runtimeStatus: {
          receivedAt: Date.now(),
          sync: {
            failedEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 1,
            status: "needs_review",
            uploadableEventCount: 0,
          },
        },
        syncEvidence: { unresolvedConflictCount: 1 },
        terminal: { status: "active" },
      }).label,
    ).toBe("Needs review");

    vi.useRealTimers();
  });

  it("formats timestamps and snapshot ages in operator-readable labels", () => {
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));

    expect(formatTerminalTimestamp(Date.now() - 5 * 60_000)).toContain(
      "5 minutes ago",
    );
    expect(formatAge(90_000)).toBe("2 minutes old");
    expect(
      getSnapshotAgeSummary({
        availabilityAgeMs: 90_000,
        catalogAgeMs: 12 * 60_000,
      }),
    ).toBe("Availability 2 minutes old / Catalog 12 minutes old");

    vi.useRealTimers();
  });
});
