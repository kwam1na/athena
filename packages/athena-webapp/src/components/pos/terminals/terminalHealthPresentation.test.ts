import { describe, expect, it, vi } from "vitest";

import {
  buildTerminalRecoveryPresentation,
  classifyTerminalHealth,
  formatAge,
  formatTerminalTimestamp,
  getPrimaryTerminalAttentionReason,
  getTerminalAttentionReasons,
  getSnapshotAgeSummary,
} from "./terminalHealthPresentation";

describe("terminal health presentation", () => {
  it("builds recovery readiness from the backend preview and keeps healthy idle distinct from able to transact", () => {
    expect(
      buildTerminalRecoveryPresentation({
        recovery: {
          readiness: {
            status: "healthy_idle",
            summary: "Healthy idle. Open a drawer and sign in before selling.",
          },
        },
        runtimeStatus: null,
        syncEvidence: {},
        terminal: { status: "active" },
      }).readiness,
    ).toEqual(
      expect.objectContaining({
        description: "Healthy idle. Open a drawer and sign in before selling.",
        label: "Healthy idle",
      }),
    );

    expect(
      buildTerminalRecoveryPresentation({
        recovery: {
          readiness: {
            status: "able_to_transact_now",
            summary: "Able to transact now. Drawer, cashier, and sale authority are active.",
          },
        },
        runtimeStatus: null,
        syncEvidence: {},
        terminal: { status: "active" },
      }).readiness,
    ).toEqual(
      expect.objectContaining({
        description:
          "Able to transact now. Drawer, cashier, and sale authority are active.",
        label: "Able to transact now",
      }),
    );
  });

  it("groups recovery blockers and exposes buttons only for safe cloud or terminal command actions", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recovery: {
        blockers: [
          {
            action: {
              kind: "cloud_repair",
              label: "Resolve duplicate drawer attempts",
              status: "available",
            },
            category: "cloud_repair",
            id: "cloud-1",
            summary:
              "Duplicate drawer-open attempts can be resolved. No sales, payments, or inventory will be changed.",
            title: "Duplicate drawer-open attempts",
          },
          {
            action: {
              kind: "terminal_command",
              label: "Send terminal repair command",
              status: "available",
            },
            category: "terminal_required",
            id: "terminal-1",
            summary:
              "Terminal action required. This checkout station needs to run the repair before Athena can verify it.",
            title: "Terminal repair required",
          },
          {
            action: {
              kind: "manual_review",
              label: "Do not render this as a repair button",
              status: "available",
            },
            category: "manual_review",
            id: "manual-1",
            summary:
              "Payment or inventory review is required before support takes action.",
            title: "Manual review required",
          },
        ],
        readiness: { status: "needs_manual_review" },
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.groups.cloudRepair).toHaveLength(1);
    expect(presentation.groups.terminalRequired).toHaveLength(1);
    expect(presentation.groups.manualReview).toHaveLength(1);
    expect(presentation.safeActions.map((action) => action.label)).toEqual([
      "Resolve duplicate drawer attempts",
      "Send terminal repair command",
    ]);
  });

  it("normalizes duplicate register-open and authorization backend wording in derived recovery copy", () => {
    const presentation = buildTerminalRecoveryPresentation({
      attentionReasons: [
        {
          source: "cloud_sync",
          summary:
            "duplicate register_opened event failed: A register session is already open for this terminal.",
          type: "cloud_conflict",
        },
        {
          source: "terminal_runtime",
          summary: "authorization_failed: stale terminal sync secret rejected",
          type: "terminal_authorization_failed",
        },
        {
          source: "cloud_sync",
          summary: "sale_completed payment allocation requires manager review",
          type: "cloud_conflict",
        },
      ],
      health: "needs_attention",
      runtimeStatus: {
        receivedAt: Date.now(),
        localStore: { available: true, terminalSeedReady: true },
        staffAuthority: { status: "expired" },
        sync: {
          failedEventCount: 0,
          pendingEventCount: 0,
          reviewEventCount: 0,
          status: "idle",
          uploadableEventCount: 0,
        },
      },
      syncEvidence: { unresolvedConflictCount: 2 },
      terminal: { status: "active" },
    });

    const renderedCopy = JSON.stringify(presentation);

    expect(presentation.groups.cloudRepair[0]?.summary).toBe(
      "Duplicate drawer-open attempts can be resolved. No sales, payments, or inventory will be changed.",
    );
    expect(presentation.groups.terminalRequired).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary:
            "Terminal authorization needs refresh. This checkout station must reconnect before Athena can verify it.",
        }),
        expect.objectContaining({
          summary:
            "Staff authority expired. Sign in again at this checkout station before selling.",
        }),
      ]),
    );
    expect(presentation.groups.manualReview[0]?.summary).toBe(
      "Manual review required. Use the linked operations or cash-control review before support repairs this terminal.",
    );
    expect(presentation.safeActions.map((action) => action.kind)).toEqual([
      "cloud_repair",
      "terminal_command",
    ]);
    expect(renderedCopy).not.toMatch(/register_opened|already open|authorization_failed|sync secret/i);
  });

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
        attentionReasons: [
          {
            count: 1,
            source: "local_runtime",
            summary: "1 local review item is still on this terminal.",
            type: "local_review",
          },
        ],
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

    expect(
      classifyTerminalHealth({
        attentionReasons: [
          {
            count: 1,
            source: "local_runtime",
            summary: "1 local review item is still on this terminal.",
            type: "local_review",
          },
        ],
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
        syncEvidence: { unresolvedConflictCount: 0 },
        terminal: { status: "active" },
      }).description,
    ).toBe("1 local review item is still on this terminal.");

    vi.useRealTimers();
  });

  it("returns backend attention reasons without synthesizing fallback reasons", () => {
    expect(
      getPrimaryTerminalAttentionReason({
        attentionReasons: [
          {
            source: "cloud_sync",
            summary: "1 cloud sync conflict needs review.",
            type: "cloud_conflict",
          },
        ],
        runtimeStatus: null,
        syncEvidence: {},
        terminal: { status: "active" },
      })?.summary,
    ).toBe("1 cloud sync conflict needs review.");

    expect(
      getTerminalAttentionReasons({
        runtimeStatus: {
          sync: {
            failedEventCount: 0,
            nextPendingUploadSequence: 23,
            pendingEventCount: 0,
            reviewEventCount: 1,
            status: "needs_review",
            uploadableEventCount: 0,
          },
        },
        syncEvidence: { conflictedCount: 0, heldCount: 0, rejectedCount: 0 },
        terminal: { status: "active" },
      }),
    ).toEqual([]);
  });

  it("classifies backend-only attention reasons", () => {
    expect(
      classifyTerminalHealth({
        attentionReasons: [
          {
            source: "terminal_runtime",
            summary: "Terminal setup data is not ready on this checkout station.",
            type: "terminal_seed_missing",
          },
        ],
        health: "needs_attention",
        runtimeStatus: {
          receivedAt: Date.now(),
          localStore: { available: true, terminalSeedReady: false },
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
      }),
    ).toEqual(
      expect.objectContaining({
        description: "Terminal setup data is not ready on this checkout station.",
        label: "Setup needed",
      }),
    );
  });

  it("keeps app-session-unverified local continuation out of manager review classification", () => {
    expect(
      classifyTerminalHealth({
        health: "online",
        runtimeStatus: {
          appSessionRecovery: { status: "waiting_for_network" },
          receivedAt: Date.now(),
          localStore: { available: true, terminalSeedReady: true },
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 3,
            pendingEventCount: 3,
            reviewEventCount: 0,
            status: "pending",
            uploadableEventCount: 0,
          },
        },
        syncEvidence: { unresolvedConflictCount: 0 },
        terminal: { status: "active" },
      }),
    ).toEqual(
      expect.objectContaining({
        description:
          "App session unverified; local sales stay on this terminal until cloud validation returns.",
        label: "Local continuation",
      }),
    );
  });

  it("honors backend attention reasons when runtime status is missing", () => {
    expect(
      classifyTerminalHealth({
        attentionReasons: [
          {
            count: 1,
            source: "cloud_sync",
            summary: "1 cloud sync conflict needs review.",
            type: "cloud_conflict",
          },
        ],
        health: "needs_attention",
        runtimeStatus: null,
        syncEvidence: { unresolvedConflictCount: 1 },
        terminal: { status: "active" },
      }),
    ).toEqual(
      expect.objectContaining({
        description: "1 cloud sync conflict needs review.",
        label: "Needs review",
      }),
    );
  });

  it.each([
    {
      expectedLabel: "Needs review",
      reason: {
        source: "local_runtime" as const,
        summary: "1 local review item is still on this terminal.",
        type: "local_review" as const,
      },
    },
    {
      expectedLabel: "Sync failed",
      reason: {
        source: "local_runtime" as const,
        summary: "1 local sync item has failed on this terminal.",
        type: "sync_failed" as const,
      },
    },
    {
      expectedLabel: "Sync unavailable",
      reason: {
        source: "local_runtime" as const,
        summary: "Local sync runtime is unavailable on this terminal.",
        type: "sync_unavailable" as const,
      },
    },
    {
      expectedLabel: "Local store issue",
      reason: {
        source: "terminal_runtime" as const,
        summary: "Local terminal storage is not available.",
        type: "local_store_unavailable" as const,
      },
    },
    {
      expectedLabel: "Setup needed",
      reason: {
        source: "terminal_runtime" as const,
        summary: "Terminal setup data is not ready on this checkout station.",
        type: "terminal_seed_missing" as const,
      },
    },
    {
      expectedLabel: "Setup needed",
      reason: {
        source: "terminal_runtime" as const,
        summary: "Terminal authorization was rejected.",
        type: "terminal_authorization_failed" as const,
      },
    },
    {
      expectedLabel: "Drawer repair needed",
      reason: {
        source: "terminal_runtime" as const,
        summary: "Drawer authority is blocked locally.",
        type: "drawer_authority_blocked" as const,
      },
    },
    {
      expectedLabel: "Needs review",
      reason: {
        source: "cloud_sync" as const,
        summary: "1 cloud sync conflict needs review.",
        type: "cloud_conflict" as const,
      },
    },
    {
      expectedLabel: "Needs review",
      reason: {
        source: "cloud_sync" as const,
        summary: "1 synced item is held before projection.",
        type: "cloud_held" as const,
      },
    },
    {
      expectedLabel: "Needs review",
      reason: {
        source: "cloud_sync" as const,
        summary: "1 synced item was rejected by the server.",
        type: "cloud_rejected" as const,
      },
    },
  ])("classifies $reason.type attention reasons", ({ expectedLabel, reason }) => {
    expect(
      classifyTerminalHealth({
        attentionReasons: [reason],
        health: "needs_attention",
        runtimeStatus: {
          receivedAt: Date.now(),
          localStore: { available: true, terminalSeedReady: true },
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
      }),
    ).toEqual(
      expect.objectContaining({
        description: reason.summary,
        label: expectedLabel,
      }),
    );
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
        serviceCatalogAgeMs: 3 * 60_000,
      }),
    ).toBe(
      "Availability 2 minutes old / Catalog 12 minutes old / Service catalog 3 minutes old",
    );

    vi.useRealTimers();
  });
});
