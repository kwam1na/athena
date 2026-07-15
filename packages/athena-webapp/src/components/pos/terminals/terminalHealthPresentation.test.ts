import { describe, expect, it, vi } from "vitest";

import {
  buildTerminalOperationalExplanationPresentation,
  buildTerminalRecoveryPresentation,
  classifyTerminalHealth,
  formatAge,
  formatTerminalTimestamp,
  getPrimaryTerminalAttentionReason,
  getTerminalAttentionReasons,
  getSnapshotAgeSummary,
} from "./terminalHealthPresentation";

describe("terminal health presentation", () => {
  it("prefers server operational explanations and makes sale-ready review backlog explicit", () => {
    const presentation = buildTerminalOperationalExplanationPresentation({
      health: "needs_attention",
      operationalExplanation: {
        blockingDomain: "sync_review",
        detail:
          "A bounded sync review backlog is still open. Store conflict-raw-001 contains payment payload data.",
        evidenceReferences: [
          {
            count: 12,
            source: "cloud_sync",
            summary: "Review backlog sample for Store conflict-raw-001",
            type: "synced_sale_inventory_review",
          },
        ],
        headline: "Back office review needed",
        lane: "sale_ready_with_review_backlog",
        nextStep: "Review the open work queue before support repairs anything.",
        primaryOwner: "operations",
        saleImpact: "can_transact_now",
        secondaryActions: [
          {
            label: "Safe cloud repair available",
            primaryOwner: "support",
            supportAction: "safe_cloud_repair",
          },
        ],
        severity: "warning",
        summaryMeta: {
          hasSecondarySafeRepair: true,
          reviewBacklogCount: 12,
          targetResolutionIncomplete: false,
        },
        supportAction: "manual_review",
      },
      recovery: {
        readiness: {
          status: "able_to_transact_now",
          summary:
            "Able to transact now. Drawer, cashier, and sale authority are active.",
        },
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    const renderedCopy = JSON.stringify(presentation);

    expect(presentation).toEqual(
      expect.objectContaining({
        detail: "Sales can continue.",
        headline: "Review needed",
        label: "Review needed",
        lane: "sale_ready_with_review_backlog",
        nextStep: "Review the open work queue before support repairs anything.",
        ownerLabel: "Operations",
        saleImpactLabel: "Sales can continue",
        supportActionLabel: "Manual review",
      }),
    );
    expect(presentation.evidenceReferences).toEqual([
      expect.objectContaining({
        count: 12,
        label: "Review evidence",
        source: "cloud_sync",
        type: "synced_sale_inventory_review",
      }),
    ]);
    expect(renderedCopy).not.toMatch(/conflict-raw-001|payment payload/i);
  });

  it("recognizes healthy server lanes and critical severity from the public contract", () => {
    const healthy = buildTerminalOperationalExplanationPresentation({
      health: "online",
      operationalExplanation: {
        blockingDomain: "none",
        detail: "Fresh runtime evidence reports sale authority.",
        evidenceReferences: [],
        headline: "Ready for sales",
        lane: "able_to_transact_now",
        nextStep: "No support action needed.",
        primaryOwner: "none",
        saleImpact: "can_transact_now",
        secondaryActions: [],
        severity: "info",
        summaryMeta: {
          hasSecondarySafeRepair: false,
          reviewBacklogCount: 0,
          targetResolutionIncomplete: false,
        },
        supportAction: "none",
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });
    const manualReview = buildTerminalOperationalExplanationPresentation({
      health: "needs_attention",
      operationalExplanation: {
        blockingDomain: "manual_review",
        detail:
          "Manual review must finish before support repairs this terminal.",
        evidenceReferences: [
          {
            source: "cloud_repair",
            summary:
              "A cloud sync conflict needs manual review before support can repair this terminal.",
            type: "unsafe_cloud_conflict",
          },
        ],
        headline: "Manager review needed",
        lane: "needs_manual_review",
        nextStep:
          "Use the linked review workspace before running support repair.",
        primaryOwner: "manager",
        saleImpact: "not_ready",
        secondaryActions: [],
        severity: "critical",
        summaryMeta: {
          hasSecondarySafeRepair: false,
          reviewBacklogCount: 1,
          targetResolutionIncomplete: false,
        },
        supportAction: "manual_review",
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(healthy).toEqual(
      expect.objectContaining({
        label: "Ready",
        lane: "able_to_transact_now",
        saleImpactLabel: "Sales can continue",
        supportActionLabel: "No support action",
      }),
    );
    expect(manualReview).toEqual(
      expect.objectContaining({
        label: "Manager review needed",
        lane: "needs_manual_review",
        saleImpactLabel: "Sales not ready",
        supportActionLabel: "Manual review",
        toneClassName: "border-danger/25 bg-danger/10 text-danger",
      }),
    );
  });

  it("falls back to legacy evidence for sale-ready review backlog", () => {
    const presentation = buildTerminalOperationalExplanationPresentation({
      health: "needs_attention",
      recovery: {
        readiness: {
          status: "able_to_transact_now",
          summary:
            "Able to transact now. Drawer, cashier, and sale authority are active.",
        },
      },
      runtimeStatus: {
        receivedAt: Date.now(),
        localStore: { available: true, terminalSeedReady: true },
        staffAuthority: { status: "ready" },
        sync: {
          failedEventCount: 0,
          pendingEventCount: 0,
          reviewEventCount: 3,
          status: "needs_review",
          uploadableEventCount: 0,
        },
      },
      syncEvidence: { unresolvedConflictCount: 2 },
      terminal: { status: "active" },
    });

    expect(presentation).toEqual(
      expect.objectContaining({
        detail: "Sales can continue.",
        headline: "Review needed",
        label: "Review needed",
        lane: "sale_ready_with_review_backlog",
        nextStep:
          "Review the open work or cash-control backlog. Do not block new sales from this terminal.",
        ownerLabel: "Operations",
        saleImpactLabel: "Sales can continue",
      }),
    );
    expect(presentation.evidenceReferences).toEqual([
      expect.objectContaining({
        count: 5,
        label: "Review backlog",
      }),
    ]);
  });

  it("derives app-update state from fresh runtime evidence without creating support blockers", () => {
    const ready = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        appUpdate: {
          evidenceFresh: true,
          pendingBuildId: "build-next",
          status: "update_ready",
        },
        readiness: "healthy_idle",
        runtimeFresh: true,
      },
      runtimeStatus: {
        appUpdate: {
          observedAt: Date.now(),
          pendingBuildId: "build-next",
          status: "update_ready",
        },
      },
      syncEvidence: {},
      terminal: { _id: "terminal-1", status: "active" },
    });

    expect(ready.appUpdate).toEqual(
      expect.objectContaining({
        action: expect.objectContaining({
          commandType: "update_app",
          status: "available",
        }),
        label: "New version available",
        status: "update_ready",
      }),
    );
    expect(ready.groups.terminalRequired).toEqual([]);
    expect(ready.readiness.status).toBe("healthy_idle");

    const blocked = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        appUpdate: {
          evidenceFresh: true,
          status: "blocked",
          summary: "Refresh is blocked by active checkout work.",
        },
        readiness: "healthy_idle",
        runtimeFresh: true,
      },
      runtimeStatus: {
        appUpdate: {
          blockerSummary: "payment_screen_pending",
          observedAt: Date.now(),
          status: "blocked",
        },
      },
      syncEvidence: {},
      terminal: { _id: "terminal-1", status: "active" },
    });

    expect(blocked.appUpdate).toEqual(
      expect.objectContaining({
        action: expect.objectContaining({ commandType: "update_app" }),
        description: "Refresh is blocked by active checkout work.",
        label: "Update blocked",
        status: "blocked",
      }),
    );
    expect(blocked.groups.terminalRequired).toEqual([]);
  });

  it("keeps Update app available for active current, stale, and unknown evidence", () => {
    for (const [status, label] of [
      ["current", "App current"],
      ["stale", "Update status stale"],
      ["unknown", "Update status unknown"],
    ] as const) {
      const presentation = buildTerminalRecoveryPresentation({
        recoveryPreview: {
          appUpdate: {
            evidenceFresh: status !== "stale",
            status,
          },
          readiness: "healthy_idle",
        },
        runtimeStatus: null,
        syncEvidence: {},
        terminal: { _id: "terminal-1", status: "active" },
      });

      expect(presentation.appUpdate).toEqual(
        expect.objectContaining({
          action: expect.objectContaining({
            commandType: "update_app",
            status: "available",
          }),
          label,
          status,
        }),
      );
    }
  });

  it("keeps Update app available when a new app update appears after a verified command", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        appUpdate: {
          evidenceFresh: true,
          pendingBuildId: "build-next",
          status: "update_ready_unstaged",
        },
        commandStatus: {
          commandType: "update_app",
          label: "Update app",
          status: "completed",
          verificationStatus: "verified",
        },
        readiness: "healthy_idle",
      },
      runtimeStatus: {
        appUpdate: {
          observedAt: Date.now(),
          pendingBuildId: "build-next",
          status: "update_ready_unstaged",
        },
      },
      syncEvidence: {},
      terminal: { _id: "terminal-1", status: "active" },
    });

    expect(presentation.appUpdate).toEqual(
      expect.objectContaining({
        action: expect.objectContaining({
          commandType: "update_app",
          status: "available",
        }),
        label: "Update available",
        status: "update_ready_unstaged",
      }),
    );
  });

  it("describes why an app update is detected but not staged", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        appUpdate: {
          evidenceFresh: true,
          pendingBuildId: "build-next",
          stagingAssetCount: 17,
          stagingFailedAssetCount: 1,
          stagingReason: "asset-staging-failed",
          stagingRejectedAssetCount: 0,
          stagingStatus: "unstaged",
          status: "update_ready_unstaged",
        },
        readiness: "healthy_idle",
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { _id: "terminal-1", status: "active" },
    });

    expect(presentation.appUpdate.description).toBe(
      "An app update was detected, but the POS app shell could not cache every required asset. 1 of 17 asset needs attention.",
    );
  });

  it("treats unstaged cache evidence as a warning when the app update is ready", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        appUpdate: {
          evidenceFresh: true,
          pendingBuildId: "build-next",
          stagingAssetCount: 17,
          stagingFailedAssetCount: 1,
          stagingReason: "asset-staging-failed",
          stagingRejectedAssetCount: 0,
          stagingStatus: "unstaged",
          status: "update_ready",
        },
        readiness: "healthy_idle",
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { _id: "terminal-1", status: "active" },
    });

    expect(presentation.appUpdate).toEqual(
      expect.objectContaining({
        action: expect.objectContaining({
          commandType: "update_app",
          status: "available",
        }),
        description:
          "An app update is ready, but the POS app shell could not cache every required asset for offline use. 1 of 17 asset needs attention.",
        label: "New version available",
        status: "update_ready",
      }),
    );
  });

  it("disables Update app for duplicate active commands and inactive terminals", () => {
    const duplicate = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        appUpdate: {
          evidenceFresh: true,
          status: "unknown",
        },
        commandStatus: {
          commandType: "update_app",
          label: "Update app",
          status: "pending",
          verificationStatus: "waiting_for_acknowledgement",
        },
        readiness: "healthy_idle",
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { _id: "terminal-1", status: "active" },
    });

    expect(duplicate.appUpdate.action).toEqual(
      expect.objectContaining({
        commandType: "update_app",
        status: "pending",
      }),
    );
    expect(duplicate.safeActions).not.toContainEqual(
      expect.objectContaining({ commandType: "update_app" }),
    );

    const inactive = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        appUpdate: {
          evidenceFresh: false,
          status: "unknown",
        },
        readiness: "healthy_idle",
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { _id: "terminal-1", status: "revoked" },
    });

    expect(inactive.appUpdate.action).toBeUndefined();
  });

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
          evidence: {
            activeRegisterSession: true,
            freshRuntimeRequiredForAbleToTransactNow: true,
          },
          readiness: {
            status: "drawer_open",
          },
        },
        runtimeStatus: null,
        syncEvidence: {},
        terminal: { status: "active" },
      }).readiness,
    ).toEqual(
      expect.objectContaining({
        description: "Drawer is open. Sign in before selling.",
        label: "Drawer open",
      }),
    );

    expect(
      buildTerminalRecoveryPresentation({
        recovery: {
          readiness: {
            status: "able_to_transact_now",
            summary:
              "Able to transact now. Drawer, cashier, and sale authority are active.",
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
              expectedPreconditionHash: "terminal-cloud-repair:hash",
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
              commandContext: {
                expectedBlockerType: "terminal_integrity",
              },
              commandType: "repair_terminal_seed",
              expectedEvidence: {
                terminalIntegrityStatus: "healthy",
              },
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

  it("builds safe recovery actions from raw preview metadata", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recovery: {
        cloudRepair: {
          preconditionHash: "terminal-cloud-repair:abc",
          safeConflictIds: ["conflict-1"],
          skippedConflictIds: [],
        },
        manualReview: [
          {
            reason: "sale_completed payment allocation requires manager review",
            source: "cloud_sync",
            type: "cloud_held",
          },
          {
            reason:
              "Cloud conflict xs76r9cjk0qw5nnwcera3jd1tn88jhpj needs manual review before repair.",
            source: "cloud_repair",
            type: "unsafe_cloud_conflict",
          },
        ],
        readiness: "needs_terminal_action",
        terminalActions: [
          {
            commandContext: {
              expectedBlockerType: "authorization_failed",
              reason: "Terminal integrity requires repair.",
            },
            commandType: "repair_terminal_seed",
            expectedEvidence: {
              terminalIntegrityStatus: "healthy",
            },
            reason: "Terminal integrity requires local repair.",
          },
          {
            commandContext: {
              cloudRegisterSessionId: "cloud-session-1",
              expectedBlockerType: "cloud_closed",
              localRegisterSessionId: "local-session-1",
              reason: "Drawer authority requires terminal-local repair.",
            },
            commandType: "clear_stale_drawer_authority",
            expectedEvidence: {
              drawerAuthorityStatus: "healthy",
              localRegisterSessionId: "local-session-1",
            },
            reason: "Drawer authority requires terminal-local repair.",
          },
        ],
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.readiness.label).toBe("Needs terminal action");
    expect(presentation.groups.cloudRepair[0]?.action).toEqual(
      expect.objectContaining({
        expectedPreconditionHash: "terminal-cloud-repair:abc",
        kind: "cloud_repair",
      }),
    );
    expect(
      presentation.groups.terminalRequired.map((blocker) => blocker.action),
    ).toEqual([
      expect.objectContaining({
        commandType: "repair_terminal_seed",
        expectedEvidence: { terminalIntegrityStatus: "healthy" },
        kind: "terminal_command",
      }),
      expect.objectContaining({
        commandContext: expect.objectContaining({
          cloudRegisterSessionId: "cloud-session-1",
          localRegisterSessionId: "local-session-1",
        }),
        commandType: "clear_stale_drawer_authority",
        kind: "terminal_command",
      }),
    ]);
    expect(presentation.groups.manualReview[0]?.summary).toBe(
      "Manual review required. Use the linked operations or cash-control review before support repairs this terminal.",
    );
    expect(presentation.groups.manualReview[1]?.summary).toBe(
      "A cloud sync conflict needs manual review before support can repair this terminal.",
    );
    expect(presentation.safeActions.map((action) => action.kind)).toEqual([
      "cloud_repair",
      "terminal_command",
      "terminal_command",
    ]);
  });

  it("keeps legacy inventory review work out of terminal recovery", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        manualReview: [
          {
            reason: "Inventory review work",
            source: "cloud_sync",
            type: "synced_sale_inventory_review",
          },
        ],
        readiness: "needs_manual_review",
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.groups.manualReview).toEqual([]);
    expect(presentation.safeActions).toEqual([]);
  });

  it("uses the Convex recoveryPreview field for terminal command actions", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        readiness: "needs_manual_review",
        terminalActions: [
          {
            commandContext: {
              cloudRegisterSessionId: "cloud-session-1",
              expectedBlockerType: "cloud_closed",
              localRegisterSessionId: "local-session-1",
              reason: "Drawer authority requires terminal-local repair.",
            },
            commandType: "clear_stale_drawer_authority",
            expectedEvidence: {
              drawerAuthorityStatus: "healthy",
              localRegisterSessionId: "local-session-1",
            },
            reason: "Drawer authority requires terminal-local repair.",
          },
        ],
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.readiness.label).toBe("Needs manual review");
    expect(presentation.groups.terminalRequired[0]?.action).toEqual(
      expect.objectContaining({
        commandContext: expect.objectContaining({
          cloudRegisterSessionId: "cloud-session-1",
          localRegisterSessionId: "local-session-1",
        }),
        commandType: "clear_stale_drawer_authority",
        expectedEvidence: {
          drawerAuthorityStatus: "healthy",
          localRegisterSessionId: "local-session-1",
        },
        kind: "terminal_command",
      }),
    );
    expect(presentation.safeActions).toHaveLength(1);
  });

  it("lets structured preview data win over legacy blockers in the same preview", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        blockers: [
          {
            category: "manual_review",
            id: "raw-fallback-review",
            summary: "Raw fallback review should not override the preview.",
            title: "Raw fallback review",
          },
        ],
        commandStatus: {
          commandType: "collect_local_review",
          label: "Collect local review items",
          status: "pending",
          verificationStatus: "waiting_for_acknowledgement",
        },
        readiness: "needs_terminal_action",
        terminalActions: [
          {
            commandContext: {
              expectedBlockerType: "local_review",
              reason:
                "Local review items need terminal-local evidence collection.",
            },
            commandType: "collect_local_review",
            expectedEvidence: {
              localReviewDetailsCollected: true,
            },
            reason:
              "Local review items need terminal-local evidence collection.",
          },
        ],
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.readiness.label).toBe("Needs terminal action");
    expect(presentation.groups.manualReview).toEqual([]);
    expect(presentation.groups.terminalRequired).toEqual([
      expect.objectContaining({
        action: expect.objectContaining({
          commandType: "collect_local_review",
          status: "pending",
        }),
        summary: "Local review collection is queued for this checkout station.",
        title: "Local review collection",
      }),
    ]);
    expect(presentation.safeActions).toEqual([]);
    expect(presentation.commandStatus).toEqual(
      expect.objectContaining({
        label: "Collect local review items",
        status: "Pending",
        verificationStatus: "Waiting For Acknowledgement",
      }),
    );
  });

  it("keeps legacy blockers when preview only adds command lifecycle metadata", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        blockers: [
          {
            category: "manual_review",
            id: "raw-fallback-review",
            summary: "Payment allocation requires manager review.",
            title: "Manual review required",
          },
        ],
        commandStatus: {
          commandType: "retry_sync",
          label: "Sync retry",
          status: "pending",
          verificationStatus: "waiting_for_acknowledgement",
        },
        evidence: {
          activeRegisterSession: true,
          freshRuntimeRequiredForAbleToTransactNow: true,
        },
        readiness: "needs_manual_review",
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.readiness.label).toBe("Needs manual review");
    expect(presentation.groups.manualReview).toEqual([
      expect.objectContaining({
        id: "raw-fallback-review",
        summary: "Payment allocation requires manager review.",
        title: "Manual review required",
      }),
    ]);
    expect(presentation.commandStatus).toEqual(
      expect.objectContaining({
        label: "Sync retry",
        status: "Pending",
        verificationStatus: "Waiting For Acknowledgement",
      }),
    );
  });

  it("keeps legacy blockers when structured blocker fields are empty", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recoveryPreview: {
        blockers: [
          {
            category: "manual_review",
            id: "raw-empty-structured-review",
            summary: "A manager needs to review this terminal.",
            title: "Manual review required",
          },
        ],
        cloudRepair: {
          preconditionHash: "terminal-cloud-repair:empty",
          safeConflictIds: [],
          skippedConflictIds: [],
        },
        manualReview: [],
        readiness: "needs_manual_review",
        terminalActions: [],
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.groups.manualReview).toEqual([
      expect.objectContaining({
        id: "raw-empty-structured-review",
        summary: "A manager needs to review this terminal.",
      }),
    ]);
    expect(presentation.groups.cloudRepair).toEqual([]);
    expect(presentation.groups.terminalRequired).toEqual([]);
  });

  it("suppresses duplicate recovery actions while command lifecycle is active", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recovery: {
        commandStatus: {
          label: "Terminal command queued.",
          status: "pending",
          verificationStatus: "waiting_for_acknowledgement",
        },
        terminalActions: [
          {
            commandContext: {
              expectedBlockerType: "authorization_failed",
            },
            commandType: "repair_terminal_seed",
            expectedEvidence: {
              terminalIntegrityStatus: "healthy",
            },
            reason: "Terminal integrity requires local repair.",
          },
        ],
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.safeActions).toEqual([]);
    expect(presentation.groups.terminalRequired[0]?.action).toEqual(
      expect.objectContaining({
        status: "pending",
      }),
    );
  });

  it("presents local review backlog recovery as terminal-local evidence collection", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recovery: {
        commandStatus: {
          commandType: "clear_stale_drawer_authority",
          label: "Drawer authority repair",
          status: "completed",
          verificationStatus: "verified",
        },
        terminalActions: [
          {
            commandContext: {
              expectedBlockerType: "local_review",
              reason:
                "Local review items need terminal-local evidence collection.",
            },
            commandType: "collect_local_review",
            expectedEvidence: {
              localReviewDetailsCollected: true,
            },
            reason:
              "Local review items need terminal-local evidence collection.",
          },
        ],
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.groups.terminalRequired[0]).toEqual(
      expect.objectContaining({
        detail: "Expected after check-in: Local review details collected.",
        summary: "Local review items need terminal-local evidence collection.",
        title: "Local review collection",
      }),
    );
    expect(presentation.safeActions[0]).toEqual(
      expect.objectContaining({
        commandType: "collect_local_review",
        label: "Collect local review items",
      }),
    );
  });

  it("keeps local review collection available when latest runtime still reports review items", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recovery: {
        commandStatus: {
          commandType: "collect_local_review",
          label: "Collect local review items",
          status: "completed",
          verificationStatus: "verified",
        },
        terminalActions: [
          {
            commandContext: {
              expectedBlockerType: "local_review",
              reason:
                "Local review items need terminal-local evidence collection.",
            },
            commandType: "collect_local_review",
            expectedEvidence: {
              localReviewDetailsCollected: true,
            },
            reason:
              "Local review items need terminal-local evidence collection.",
          },
        ],
      },
      runtimeStatus: {
        receivedAt: Date.now(),
        sync: {
          failedEventCount: 0,
          localOnlyEventCount: 0,
          pendingEventCount: 0,
          reviewEventCount: 84,
          reviewEvents: [],
          status: "needs_review",
          uploadableEventCount: 0,
        },
      },
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.groups.terminalRequired[0]).toEqual(
      expect.objectContaining({
        action: expect.objectContaining({
          commandType: "collect_local_review",
          status: "available",
        }),
        summary: "Local review items need terminal-local evidence collection.",
        title: "Local review collection",
      }),
    );
    expect(presentation.safeActions[0]).toEqual(
      expect.objectContaining({
        commandType: "collect_local_review",
        status: "available",
      }),
    );
  });

  it("presents local review cleanup as a safe terminal action", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recovery: {
        terminalActions: [
          {
            commandContext: {
              expectedBlockerType: "local_review",
              localReviewEventIds: ["event-review-1"],
              reason:
                "Uploaded local review items can be cleared from this terminal.",
            },
            commandType: "clear_local_review_items",
            expectedEvidence: {
              localReviewEventCount: 0,
            },
            reason:
              "Uploaded local review items can be cleared from this terminal.",
          },
        ],
      },
      runtimeStatus: {
        receivedAt: Date.now(),
        sync: {
          failedEventCount: 0,
          localOnlyEventCount: 0,
          pendingEventCount: 0,
          reviewEventCount: 1,
          reviewEvents: [
            {
              createdAt: Date.now() - 1_000,
              localEventId: "event-review-1",
              sequence: 12,
              status: "needs_review",
              type: "transaction.completed",
              uploaded: true,
              uploadSequence: 12,
            },
          ],
          status: "needs_review",
          uploadableEventCount: 0,
        },
      },
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.groups.terminalRequired[0]).toEqual(
      expect.objectContaining({
        action: expect.objectContaining({
          commandType: "clear_local_review_items",
          label: "Clear local review items",
          status: "available",
        }),
        detail: "Expected after check-in: 0 local review items remaining.",
        summary:
          "Uploaded local review items can be cleared from this terminal.",
        title: "Local review cleanup",
      }),
    );
    expect(presentation.safeActions[0]).toEqual(
      expect.objectContaining({
        commandType: "clear_local_review_items",
        label: "Clear local review items",
      }),
    );
  });

  it("keeps clear-all local review cleanup out of safe actions", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recovery: {
        terminalActions: [
          {
            commandContext: {
              expectedBlockerType: "local_review_clear_all",
              localReviewClearAll: true,
              localReviewClearLimit: 2,
              reason: "Dangerous cleanup for local review items.",
            },
            commandType: "clear_local_review_items",
            expectedEvidence: {
              localReviewEventCount: 0,
            },
            reason:
              "Dangerous cleanup can clear all local review items from this terminal.",
          },
        ],
      },
      runtimeStatus: {
        receivedAt: Date.now(),
        sync: {
          failedEventCount: 0,
          localOnlyEventCount: 0,
          pendingEventCount: 0,
          reviewEventCount: 2,
          reviewEvents: [
            {
              createdAt: Date.now() - 1_000,
              localEventId: "event-review-1",
              sequence: 12,
              status: "needs_review",
              type: "register.opened",
              uploaded: true,
              uploadSequence: 12,
            },
          ],
          status: "needs_review",
          uploadableEventCount: 0,
        },
      },
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.safeActions).toEqual([]);
    expect(presentation.groups.terminalRequired).toEqual([]);
  });

  it("allows recovery actions after the latest command expires", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recovery: {
        commandStatus: {
          label: "Terminal command queued.",
          status: "expired",
          verificationStatus: "waiting_for_acknowledgement",
        },
        terminalActions: [
          {
            commandContext: {
              expectedBlockerType: "authorization_failed",
            },
            commandType: "repair_terminal_seed",
            expectedEvidence: {
              terminalIntegrityStatus: "healthy",
            },
            reason: "Terminal integrity requires local repair.",
          },
        ],
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.safeActions.map((action) => action.status)).toEqual([
      "expired",
    ]);
    expect(presentation.groups.terminalRequired[0]?.action).toEqual(
      expect.objectContaining({
        status: "expired",
      }),
    );
  });

  it("hides terminal command blockers after recovery is verified", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recovery: {
        commandStatus: {
          commandType: "clear_stale_drawer_authority",
          label: "Drawer authority repair",
          status: "completed",
          verificationStatus: "verified",
        },
        terminalActions: [
          {
            commandContext: {
              cloudRegisterSessionId: "cloud-session-1",
              expectedBlockerType: "cloud_closed",
              localRegisterSessionId: "local-session-1",
            },
            commandType: "clear_stale_drawer_authority",
            expectedEvidence: {
              drawerAuthorityStatus: "healthy",
              localRegisterSessionId: "local-session-1",
            },
            reason: "Drawer authority requires terminal-local repair.",
          },
        ],
      },
      runtimeStatus: null,
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.groups.terminalRequired).toEqual([]);
    expect(presentation.safeActions).toEqual([]);
    expect(presentation.verification.summary).toBe(
      "Recovery was verified by the latest terminal check-in.",
    );
  });

  it("does not preserve stale terminal-action readiness when visible blockers are clear", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recovery: {
        readiness: "needs_terminal_action",
        terminalActions: [],
      },
      runtimeStatus: {
        receivedAt: Date.now(),
        localStore: { available: true, terminalSeedReady: true },
        staffAuthority: { status: "ready" },
        sync: {
          failedEventCount: 0,
          pendingEventCount: 0,
          reviewEventCount: 0,
          status: "idle",
          uploadableEventCount: 0,
        },
      },
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.groups.terminalRequired).toEqual([]);
    expect(presentation.readiness.label).toBe("Healthy idle");
    expect(presentation.safeActions).toEqual([]);
  });

  it("keeps staff authority expiry out of support recovery blockers", () => {
    const presentation = buildTerminalRecoveryPresentation({
      recovery: {
        readiness: "needs_terminal_action",
        terminalActions: [],
      },
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
      syncEvidence: {},
      terminal: { status: "active" },
    });

    expect(presentation.groups.terminalRequired).toEqual([]);
    expect(presentation.readiness.label).toBe("Healthy idle");
    expect(presentation.safeActions).toEqual([]);
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
      ]),
    );
    expect(presentation.groups.manualReview[0]?.summary).toBe(
      "Manual review required. Use the linked operations or cash-control review before support repairs this terminal.",
    );
    expect(presentation.safeActions.map((action) => action.kind)).toEqual([]);
    expect(renderedCopy).not.toMatch(
      /register_opened|already open|authorization_failed|sync secret/i,
    );
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

  it("does not classify inventory-only sync evidence as terminal review", () => {
    expect(
      classifyTerminalHealth({
        health: "offline",
        runtimeStatus: {
          receivedAt: Date.now() - 4 * 60 * 60_000,
          sync: {
            failedEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 0,
            status: "idle",
            uploadableEventCount: 0,
          },
        },
        syncEvidence: {
          conflictedCount: 1,
          reviewSummary: {
            groups: [{ conflictType: "inventory", count: 1 }],
          },
          unresolvedConflictCount: 1,
          unresolvedConflicts: [
            {
              _id: "inventory-conflict-1",
              conflictType: "inventory",
              createdAt: Date.now(),
              localEventId: "inventory-event-1",
              localRegisterSessionId: "local-register-1",
              sequence: 26,
              summary:
                "Inventory needs manager review for a synced offline sale.",
            },
          ],
        },
        terminal: { status: "active" },
      }).label,
    ).toBe("Offline");
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
            summary:
              "Terminal setup data is not ready on this checkout station.",
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
        description:
          "Terminal setup data is not ready on this checkout station.",
        label: "Setup needed",
      }),
    );
  });

  it("does not keep setup-needed classification after recovery clears terminal blockers", () => {
    expect(
      classifyTerminalHealth({
        attentionReasons: [
          {
            source: "terminal_runtime",
            summary:
              "Terminal setup data is not ready on this checkout station.",
            type: "terminal_seed_missing",
          },
        ],
        health: "needs_attention",
        recovery: {
          commandStatus: {
            commandType: "repair_terminal_seed",
            label: "Terminal setup repair",
            status: "completed",
            verificationStatus: "verified",
          },
          readiness: "needs_terminal_action",
          terminalActions: [
            {
              commandContext: {
                expectedBlockerType: "terminal_seed",
              },
              commandType: "repair_terminal_seed",
              expectedEvidence: {
                terminalIntegrityStatus: "healthy",
              },
              reason: "Terminal setup data needs repair.",
            },
          ],
        },
        runtimeStatus: {
          receivedAt: Date.now(),
          localStore: { available: true, terminalSeedReady: true },
          staffAuthority: { status: "ready" },
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
        label: "Healthy",
      }),
    );
  });

  it("does not classify a terminal as healthy when support recovery has a repair blocker", () => {
    expect(
      classifyTerminalHealth({
        health: "online",
        recovery: {
          commandStatus: {
            commandType: "clear_stale_drawer_authority",
            label: "Drawer authority repair",
            status: "precondition_failed",
            verificationStatus: "verification_failed",
          },
          readiness: "needs_terminal_action",
          terminalActions: [
            {
              commandContext: {
                expectedBlockerType: "terminal_seed",
              },
              commandType: "repair_terminal_seed",
              expectedEvidence: {
                terminalIntegrityStatus: "healthy",
              },
              reason: "Terminal setup data needs repair.",
            },
          ],
        },
        runtimeStatus: {
          receivedAt: Date.now(),
          localStore: { available: true, terminalSeedReady: true },
          staffAuthority: { status: "ready" },
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
        label: "Needs terminal action",
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

  it("presents storage pressure as an actionable warning without changing authority", () => {
    expect(
      classifyTerminalHealth({
        health: "online",
        runtimeStatus: {
          localStore: {
            available: true,
            persistence: "denied",
            pressure: "warning",
            terminalSeedReady: true,
          },
          receivedAt: Date.now(),
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 0,
            status: "synced",
            uploadableEventCount: 0,
          },
        },
        syncEvidence: { unresolvedConflictCount: 0 },
        terminal: { status: "active" },
      }),
    ).toEqual(
      expect.objectContaining({
        label: "Storage needs attention",
      }),
    );
  });

  it.each([
    ["maintenance", "active", "Maintenance in progress"],
    ["migration", "running", "Maintenance in progress"],
    ["maintenance", "blocked", "Storage support needed"],
    ["migration", "failed", "Storage support needed"],
  ] as const)(
    "presents %s %s with an operational action",
    (field, value, label) => {
      expect(
        classifyTerminalHealth({
          health: "online",
          runtimeStatus: {
            localStore: {
              available: true,
              [field]: value,
              terminalSeedReady: true,
            },
            receivedAt: Date.now(),
            sync: {
              failedEventCount: 0,
              localOnlyEventCount: 0,
              pendingEventCount: 0,
              reviewEventCount: 0,
              status: "synced",
              uploadableEventCount: 0,
            },
          },
          syncEvidence: { unresolvedConflictCount: 0 },
          terminal: { status: "active" },
        }),
      ).toEqual(expect.objectContaining({ label }));
    },
  );

  it("does not present stale storage evidence as current", () => {
    expect(
      classifyTerminalHealth({
        health: "online",
        runtimeStatus: {
          localStore: {
            available: true,
            healthFreshness: "stale",
            pressure: "normal",
            terminalSeedReady: true,
          },
          receivedAt: Date.now(),
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 0,
            status: "synced",
            uploadableEventCount: 0,
          },
        },
        syncEvidence: { unresolvedConflictCount: 0 },
        terminal: { status: "active" },
      }),
    ).toEqual(
      expect.objectContaining({
        label: "Storage status unavailable",
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
  ])(
    "classifies $reason.type attention reasons",
    ({ expectedLabel, reason }) => {
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
    },
  );

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
