import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import {
  buildTerminalOperationalState,
  classifyTerminalHealth,
  classifySalesReadiness,
  classifySupportRecovery,
} from "./policy";
import type { TerminalOperationalPolicyInput } from "./types";

const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;
const now = 2_000_000;

describe("terminal operational state policy", () => {
  it("keeps sales readiness distinct from support recovery", () => {
    expect(
      classifySalesReadiness({
        activeRegisterSession: false,
        healthyIdle: true,
        saleAuthorityReady: false,
      }),
    ).toBe("healthy_idle");
    expect(
      classifySalesReadiness({
        activeRegisterSession: true,
        healthyIdle: true,
        saleAuthorityReady: false,
      }),
    ).toBe("drawer_open");
    expect(
      classifySalesReadiness({
        activeRegisterSession: true,
        healthyIdle: true,
        saleAuthorityReady: true,
      }),
    ).toBe("able_to_transact_now");
  });

  it("lets cloud register lifecycle block sale-ready projection without erasing drawer evidence", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        latestRegisterSession: buildRegisterSession({
          status: "closed",
        }),
        latestCloudRegisterSessionStatus: "closed",
        runtimeStatus: buildRuntimeStatus({
          activeRegisterSession: {
            localRegisterSessionId: "local-register-1",
            observedAt: 1_999_000,
            openedAt: 1_980_000,
            status: "open",
          },
          saleAuthority: {
            observedAt: 1_999_000,
            status: "ready",
            transactionMode: "products_and_services",
          },
        }),
      }),
    );

    expect(state.salesReadiness).toBe("drawer_open");
    expect(state.recoveryPreview.readiness).toBe("drawer_open");
    expect(state.recoveryPreview.evidence.activeRegisterSession).toBe(true);
    expect(state.diagnosticEvidence).toContainEqual(
      expect.objectContaining({
        source: "cloud_register_lifecycle",
      }),
    );
  });

  it("orders manual review before terminal actions and cloud repair", () => {
    const input = baseInput({
      cloudRepair: {
        preconditionHash: "hash",
        safeConflictIds: ["conflict-1" as Id<"posLocalSyncConflict">],
        skippedConflictIds: ["conflict-unsafe" as Id<"posLocalSyncConflict">],
      },
      syncEvidence: {
        ...emptySyncEvidence(),
        latestEvent: {
          eventType: "sale_completed",
          localEventId: "local-held",
          localRegisterSessionId: "local-register-1",
          occurredAt: 1_999_000,
          sequence: 12,
          status: "held",
          submittedAt: 1_999_000,
        },
        reviewSummary: {
          groups: [
            {
              actionability: "manual_review",
              conflictType: "payment",
              count: 1,
              latestCreatedAt: 1_999_000,
              latestSequence: 12,
              owner: "manual_review",
            },
          ],
          meta: {
            cap: 20,
            hasMore: false,
            sampledCount: 1,
            targetResolutionIncomplete: false,
          },
        },
        unresolvedConflictCount: 1,
        unresolvedConflicts: [
          {
            _id: "conflict-held" as Id<"posLocalSyncConflict">,
            conflictType: "payment",
            createdAt: 1_999_000,
            localEventId: "local-held",
            localRegisterSessionId: "local-register-1",
            sequence: 12,
            summary: "A synced event was rejected by the server.",
          },
        ],
      },
      runtimeStatus: buildRuntimeStatus({
        sync: {
          failedEventCount: 1,
          localOnlyEventCount: 0,
          pendingEventCount: 1,
          reviewEventCount: 0,
          status: "failed",
          uploadableEventCount: 1,
        },
      }),
    });

    expect(buildTerminalOperationalState(input).recoveryPreview.readiness).toBe(
      "needs_manual_review",
    );
  });

  it("explains sale-ready review backlog without implying cashier blocking", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        runtimeStatus: buildRuntimeStatus({
          activeRegisterSession: {
            localRegisterSessionId: "local-register-1",
            observedAt: 1_999_000,
            openedAt: 1_980_000,
            status: "open",
          },
          saleAuthority: {
            observedAt: 1_999_000,
            status: "ready",
            transactionMode: "products_and_services",
          },
        }),
        syncEvidence: {
          ...emptySyncEvidence(),
          conflictedCount: 1,
          unresolvedConflictCount: 1,
          unresolvedConflicts: [
            {
              _id: "conflict-1" as Id<"posLocalSyncConflict">,
              conflictType: "inventory",
              createdAt: 1_999_000,
              localEventId: "local-event-1",
              localRegisterSessionId: "local-register-1",
              reviewTarget: {
                type: "open_work",
                workItemId: "work-item-1" as Id<"operationalWorkItem">,
                workItemType: "synced_sale_inventory_review",
              },
              sequence: 26,
              summary: "Inventory needs manager review for a synced offline sale.",
            },
          ],
          reviewSummary: {
            groups: [
              {
                actionability: "open_work_review",
                conflictType: "inventory",
                count: 1,
                latestCreatedAt: 1_999_000,
                latestSequence: 26,
                owner: "operations_open_work",
                reviewTarget: {
                  type: "open_work",
                  workItemId: "work-item-1" as Id<"operationalWorkItem">,
                  workItemType: "synced_sale_inventory_review",
                },
              },
            ],
            meta: {
              cap: 20,
              hasMore: false,
              sampledCount: 1,
              targetResolutionIncomplete: false,
            },
          },
        },
      }),
    );

    expect(state.salesReadiness).toBe("able_to_transact_now");
    expect(state.operationalExplanation).toMatchObject({
      headline: "Review needed. Sales can continue.",
      lane: "sale_ready_with_review_backlog",
      primaryOwner: "operations",
      saleImpact: "can_transact_now",
      supportAction: "manual_review",
    });
    expect(state.recoveryPreview.readiness).toBe("able_to_transact_now");
  });

  it("treats local runtime review as terminal-local evidence collection instead of manual business review", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        runtimeStatus: buildRuntimeStatus({
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 1,
            reviewEventCount: 1,
            status: "needs_review",
            uploadableEventCount: 1,
          },
        }),
      }),
    );

    expect(state.recoveryEvidence.manualReview).toEqual([]);
    expect(state.recoveryPreview.readiness).toBe("needs_terminal_action");
    expect(state.operationalExplanation).toMatchObject({
      headline: "Local review collection needed",
      lane: "needs_terminal_action",
      primaryOwner: "terminal",
      supportAction: "terminal_command",
    });
    expect(state.recoveryPreview.terminalActions[0]).toMatchObject({
      commandType: "collect_local_review",
      expectedEvidence: { localReviewDetailsCollected: true },
    });
  });

  it("keeps local runtime collection available when verified collection did not clear latest runtime review", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        commandStatus: {
          commandId: "command-collect-review" as Id<"posTerminalRecoveryCommand">,
          commandType: "collect_local_review",
          label: "Collect local review items",
          status: "completed",
          verificationStatus: "verified",
        },
        runtimeStatus: buildRuntimeStatus({
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 1,
            reviewEventCount: 84,
            status: "needs_review",
            uploadableEventCount: 1,
          },
        }),
      }),
    );

    expect(state.recoveryEvidence.terminalActions[0]).toMatchObject({
      commandType: "collect_local_review",
      expectedEvidence: { localReviewDetailsCollected: true },
    });
    expect(state.recoveryPreview.terminalActions[0]).toMatchObject({
      commandType: "collect_local_review",
      expectedEvidence: { localReviewDetailsCollected: true },
    });
    expect(state.recoveryPreview.commandStatus).toMatchObject({
      commandType: "collect_local_review",
      verificationStatus: "verified",
    });
  });

  it("offers local review cleanup from matching collected terminal evidence", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        commandStatus: {
          commandId: "command-collect-review" as Id<"posTerminalRecoveryCommand">,
          commandType: "collect_local_review",
          label: "Collect local review items",
          localReviewEvents: [
            {
              createdAt: now - 1_000,
              localEventId: "event-review-1",
              sequence: 12,
              status: "needs_review",
              type: "transaction.completed",
              uploaded: true,
              uploadSequence: 12,
            },
            {
              createdAt: now - 500,
              localEventId: "event-review-2",
              sequence: 13,
              status: "needs_review",
              type: "register.closeout_started",
              uploaded: true,
              uploadSequence: 13,
            },
          ],
          status: "completed",
          verificationStatus: "verified",
        },
        runtimeStatus: buildRuntimeStatus({
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 2,
            reviewEvents: [
              {
                createdAt: now - 1_000,
                localEventId: "event-review-1",
                sequence: 12,
                status: "needs_review",
                type: "transaction.completed",
                uploaded: true,
                uploadSequence: 12,
              },
              {
                createdAt: now - 500,
                localEventId: "event-review-2",
                sequence: 13,
                status: "needs_review",
                type: "register.closeout_started",
                uploaded: true,
                uploadSequence: 13,
              },
            ],
            status: "needs_review",
            uploadableEventCount: 0,
          },
        }),
      }),
    );

    expect(state.recoveryEvidence.terminalActions[0]).toMatchObject({
      commandContext: {
        expectedBlockerType: "local_review",
        localReviewEventIds: ["event-review-1", "event-review-2"],
      },
      commandType: "clear_local_review_items",
      expectedEvidence: {
        localReviewClearedEventIds: ["event-review-1", "event-review-2"],
        localReviewEventCount: 0,
      },
    });
  });

  it("requires fresh runtime ids before clearing collected local review evidence", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        commandStatus: {
          commandId: "command-collect-review" as Id<"posTerminalRecoveryCommand">,
          commandType: "collect_local_review",
          label: "Collect local review items",
          localReviewEvents: [
            {
              createdAt: now - 1_000,
              localEventId: "event-review-1",
              sequence: 12,
              status: "needs_review",
              type: "transaction.completed",
              uploaded: true,
              uploadSequence: 12,
            },
          ],
          status: "completed",
          verificationStatus: "verified",
        },
        runtimeStatus: buildRuntimeStatus({
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 1,
            reviewEvents: [],
            status: "needs_review",
            uploadableEventCount: 0,
          },
        }),
      }),
    );

    expect(state.recoveryEvidence.terminalActions[0]).toMatchObject({
      commandType: "collect_local_review",
      expectedEvidence: { localReviewDetailsCollected: true },
    });
  });

  it("does not use stale collected local review evidence when runtime ids differ", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        commandStatus: {
          commandId: "command-collect-review" as Id<"posTerminalRecoveryCommand">,
          commandType: "collect_local_review",
          label: "Collect local review items",
          localReviewEvents: [
            {
              createdAt: now - 1_000,
              localEventId: "stale-review-1",
              sequence: 12,
              status: "needs_review",
              type: "transaction.completed",
              uploaded: true,
              uploadSequence: 12,
            },
          ],
          status: "completed",
          verificationStatus: "verified",
        },
        runtimeStatus: buildRuntimeStatus({
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 1,
            reviewEvents: [
              {
                createdAt: now - 500,
                localEventId: "current-review-1",
                sequence: 13,
                status: "needs_review",
                type: "register.closeout_started",
                uploaded: true,
                uploadSequence: 13,
              },
            ],
            status: "needs_review",
            uploadableEventCount: 0,
          },
        }),
      }),
    );

    expect(state.recoveryEvidence.terminalActions[0]).toMatchObject({
      commandContext: {
        localReviewEventIds: ["current-review-1"],
      },
      commandType: "clear_local_review_items",
      expectedEvidence: {
        localReviewClearedEventIds: ["current-review-1"],
        localReviewEventCount: 0,
      },
    });
  });

  it("offers local review cleanup when all local review items were uploaded and reported", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        runtimeStatus: buildRuntimeStatus({
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 2,
            reviewEvents: [
              {
                createdAt: now - 1_000,
                localEventId: "event-review-1",
                sequence: 12,
                status: "needs_review",
                type: "transaction.completed",
                uploaded: true,
                uploadSequence: 12,
              },
              {
                createdAt: now - 500,
                localEventId: "event-review-2",
                sequence: 13,
                status: "needs_review",
                type: "register.closeout_started",
                uploaded: true,
                uploadSequence: 13,
              },
            ],
            status: "needs_review",
            uploadableEventCount: 0,
          },
        }),
      }),
    );

    expect(state.recoveryEvidence.terminalActions[0]).toMatchObject({
      commandContext: {
        expectedBlockerType: "local_review",
        localReviewEventIds: ["event-review-1", "event-review-2"],
      },
      commandType: "clear_local_review_items",
      expectedEvidence: {
        localReviewClearedEventIds: ["event-review-1", "event-review-2"],
        localReviewEventCount: 0,
      },
    });
    expect(state.recoveryPreview.terminalActions[0]).toMatchObject({
      commandType: "clear_local_review_items",
    });
  });

  it("offers a 100-item local review cleanup batch for over-cap review backlogs", () => {
    const reviewEvents = Array.from({ length: 100 }, (_, index) => ({
      createdAt: now - index,
      localEventId: `event-review-${index + 1}`,
      sequence: index + 1,
      status: "needs_review" as const,
      type: "transaction.completed",
      uploaded: true,
      uploadSequence: index + 1,
    }));

    const state = buildTerminalOperationalState(
      baseInput({
        runtimeStatus: buildRuntimeStatus({
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 101,
            reviewEvents,
            status: "needs_review",
            uploadableEventCount: 0,
          },
        }),
      }),
    );

    expect(state.recoveryEvidence.terminalActions[0]).toMatchObject({
      commandContext: {
        localReviewEventIds: reviewEvents.map((event) => event.localEventId),
      },
      commandType: "clear_local_review_items",
      expectedEvidence: {
        localReviewClearedEventIds: reviewEvents.map(
          (event) => event.localEventId,
        ),
        localReviewEventCount: 1,
      },
    });
  });

  it("keeps collecting local review evidence when any reported local review item was not uploaded", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        runtimeStatus: buildRuntimeStatus({
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 1,
            reviewEvents: [
              {
                createdAt: now - 1_000,
                localEventId: "event-review-1",
                sequence: 12,
                status: "needs_review",
                type: "transaction.completed",
                uploadSequence: 12,
              },
            ],
            status: "needs_review",
            uploadableEventCount: 0,
          },
        }),
      }),
    );

    expect(state.recoveryEvidence.terminalActions[0]).toMatchObject({
      commandType: "collect_local_review",
      expectedEvidence: { localReviewDetailsCollected: true },
    });
  });

  it("keeps safe cloud repair secondary when manual review is primary", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        cloudRepair: {
          preconditionHash: "hash",
          safeConflictIds: ["safe-conflict" as Id<"posLocalSyncConflict">],
          skippedConflictIds: ["unsafe-conflict" as Id<"posLocalSyncConflict">],
        },
      }),
    );

    expect(state.recoveryPreview.readiness).toBe("needs_manual_review");
    expect(state.operationalExplanation).toMatchObject({
      lane: "needs_manual_review",
      supportAction: "manual_review",
    });
    expect(state.operationalExplanation.secondaryActions).toContainEqual({
      label: "Safe cloud repair available",
      primaryOwner: "support",
      supportAction: "safe_cloud_repair",
    });
  });

  it("explains stale runtime without creating a cloud repair lane", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        runtimeAgeMs: 16 * 60 * 1_000,
        runtimeFresh: false,
      }),
    );

    expect(state.terminalHealth).toBe("offline");
    expect(state.supportRecovery).toBeNull();
    expect(state.operationalExplanation).toMatchObject({
      headline: "Waiting for check-in",
      lane: "stale_runtime",
      supportAction: "wait_for_check_in",
    });
  });

  it("classifies safe cloud repair when no manual review or terminal action exists", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        cloudRepair: {
          preconditionHash: "hash",
          safeConflictIds: ["conflict-1" as Id<"posLocalSyncConflict">],
          skippedConflictIds: [],
        },
      }),
    );

    expect(
      classifySupportRecovery({
        cloudRepair: state.recoveryEvidence.cloudRepair,
        manualReview: state.recoveryEvidence.manualReview,
        terminalActions: state.recoveryEvidence.terminalActions,
      }),
    ).toEqual({
      reasonCount: 1,
      status: "needs_cloud_repair",
    });
    expect(state.recoveryPreview.readiness).toBe("needs_cloud_repair");
  });

  it("does not treat command acknowledgement as verification", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        commandStatus: {
          commandId: "command-1" as Id<"posTerminalRecoveryCommand">,
          commandType: "retry_sync",
          label: "Sync retry",
          latestAcknowledgement: "Retry completed locally.",
          status: "completed",
          verificationStatus: "runtime_verification_ready",
        },
      }),
    );

    expect(state.diagnosticEvidence).toContainEqual(
      expect.objectContaining({
        source: "recovery_command",
      }),
    );
  });

  it("classifies terminal health from aggregate inputs", () => {
    expect(
      classifyTerminalHealth({
        attentionReasons: [],
        runtimeAgeMs: 1_000,
        runtimeStatus: buildRuntimeStatus(),
        terminalStatus: "active",
      }),
    ).toBe("online");
    expect(
      classifyTerminalHealth({
        attentionReasons: [
          {
            source: "local_runtime",
            summary: "Local sync runtime is unavailable on this terminal.",
            type: "sync_unavailable",
          },
        ],
        runtimeAgeMs: 1_000,
        runtimeStatus: buildRuntimeStatus(),
        terminalStatus: "active",
      }),
    ).toBe("needs_attention");
    expect(
      classifyTerminalHealth({
        attentionReasons: [],
        runtimeAgeMs: null,
        runtimeStatus: null,
        terminalStatus: "active",
      }),
    ).toBe("unknown");
    expect(
      classifyTerminalHealth({
        attentionReasons: [],
        runtimeAgeMs: 10 * 60 * 1_000,
        runtimeStatus: buildRuntimeStatus(),
        terminalStatus: "active",
      }),
    ).toBe("stale");
    expect(
      classifyTerminalHealth({
        attentionReasons: [],
        runtimeAgeMs: 16 * 60 * 1_000,
        runtimeStatus: buildRuntimeStatus(),
        terminalStatus: "active",
      }),
    ).toBe("offline");
  });

  it("derives cloud attention from unresolved review summary instead of historical event status", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        syncEvidence: {
          ...emptySyncEvidence(),
          conflictedCount: 2,
          latestEvent: {
            eventType: "sale_completed",
            localEventId: "local-conflicted",
            localRegisterSessionId: "local-register-1",
            occurredAt: 1_999_000,
            sequence: 7,
            status: "conflicted",
            submittedAt: 1_999_000,
          },
          reviewSummary: {
            groups: [
              {
                actionability: "manual_review",
                conflictType: "payment",
                count: 1,
                latestCreatedAt: 1_999_000,
                latestSequence: 7,
                owner: "manual_review",
              },
            ],
            meta: {
              cap: 20,
              hasMore: false,
              sampledCount: 1,
              targetResolutionIncomplete: false,
            },
          },
        },
      }),
    );

    expect(state.attentionReasons).toContainEqual(
      expect.objectContaining({
        count: 1,
        latestEventSequence: 7,
        source: "cloud_sync",
        type: "cloud_conflict",
      }),
    );
    expect(state.terminalHealth).toBe("needs_attention");
  });

  it("does not treat closed historical sync event statuses as current review backlog", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        syncEvidence: {
          ...emptySyncEvidence(),
          conflictedCount: 3,
          heldCount: 1,
          latestEvent: {
            eventType: "sale_completed",
            localEventId: "local-resolved",
            localRegisterSessionId: "local-register-1",
            occurredAt: 1_999_000,
            sequence: 9,
            status: "conflicted",
            submittedAt: 1_999_000,
          },
          reviewSummary: {
            groups: [],
            meta: {
              cap: 20,
              hasMore: false,
              sampledCount: 0,
              targetResolutionIncomplete: false,
            },
          },
          unresolvedConflictCount: 0,
          unresolvedConflicts: [],
        },
      }),
    );

    expect(state.attentionReasons).toEqual([]);
    expect(state.recoveryEvidence.manualReview).toEqual([]);
    expect(state.terminalHealth).toBe("online");
  });

  it("explains current review backlog even when the terminal is not sale-ready", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        runtimeStatus: buildRuntimeStatus({
          activeRegisterSession: undefined,
          saleAuthority: undefined,
        }),
        syncEvidence: {
          ...emptySyncEvidence(),
          reviewSummary: {
            groups: [
              {
                actionability: "manual_review",
                conflictType: "permission",
                count: 1,
                latestCreatedAt: 1_999_000,
                latestSequence: 14,
                owner: "manual_review",
              },
            ],
            meta: {
              cap: 20,
              hasMore: false,
              sampledCount: 1,
              targetResolutionIncomplete: false,
            },
          },
          unresolvedConflictCount: 1,
          unresolvedConflicts: [
            {
              _id: "conflict-review" as Id<"posLocalSyncConflict">,
              conflictType: "permission",
              createdAt: 1_999_000,
              localEventId: "event-review",
              localRegisterSessionId: "local-register-1",
              sequence: 14,
              summary: "A synced register event needs permission review.",
            },
          ],
        },
      }),
    );

    expect(state.salesReadiness).toBe("healthy_idle");
    expect(state.operationalExplanation).toMatchObject({
      headline: "Review needed",
      lane: "needs_manual_review",
      saleImpact: "not_ready",
      supportAction: "manual_review",
    });
  });

  it("clears cleanly closed drawer authority inside the aggregate policy", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        drawerAuthorityRegisterSession: buildRegisterSession({
          _id: "register-closed" as Id<"registerSession">,
          closedAt: 1_999_000,
          status: "closed",
        }),
        runtimeStatus: buildRuntimeStatus({
          drawerAuthority: {
            cloudRegisterSessionId: "register-closed",
            localRegisterSessionId: "local-register-1",
            observedAt: 1_999_000,
            reason: "cloud_closed",
            status: "blocked",
          },
        }),
      }),
    );

    expect(state.runtimeEvidence.effectiveStatus?.drawerAuthority).toBeUndefined();
    expect(state.attentionReasons.map((reason) => reason.type)).not.toContain(
      "drawer_authority_blocked",
    );
    expect(state.recoveryPreview.terminalActions).toEqual([]);
  });
});

function baseInput(
  overrides: Partial<TerminalOperationalPolicyInput> = {},
): TerminalOperationalPolicyInput {
  return {
    appUpdate: {
      evidenceFresh: false,
      status: "unknown",
    },
    cloudRepair: {
      preconditionHash: "empty",
      safeConflictIds: [],
      skippedConflictIds: [],
    },
    commandStatus: null,
    latestRegisterSession: null,
    runtimeStatus: buildRuntimeStatus(),
    runtimeAgeMs: 1_000,
    runtimeFresh: true,
    storeId,
    syncEvidence: {
      latestEvent: null,
      latestReviewEvent: null,
      latestReviewEventsByStatus: {
        conflicted: null,
        held: null,
        rejected: null,
      },
      sampledEventCount: 0,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
      unresolvedConflictCount: 0,
      unresolvedConflicts: [],
    },
    terminalId,
    terminalStatus: "active",
    ...overrides,
  } satisfies TerminalOperationalPolicyInput;
}

function emptySyncEvidence(): TerminalOperationalPolicyInput["syncEvidence"] {
  return {
    latestEvent: null,
    latestReviewEvent: null,
    latestReviewEventsByStatus: {
      conflicted: null,
      held: null,
      rejected: null,
    },
    sampledEventCount: 0,
    acceptedCount: 0,
    projectedCount: 0,
    conflictedCount: 0,
    heldCount: 0,
    rejectedCount: 0,
    unresolvedConflictCount: 0,
    unresolvedConflicts: [],
  };
}

function buildRuntimeStatus(
  overrides: Partial<Doc<"posTerminalRuntimeStatus">> = {},
): Doc<"posTerminalRuntimeStatus"> {
  return {
    _id: "runtime-1" as Id<"posTerminalRuntimeStatus">,
    _creationTime: 1_998_000,
    appSessionRecovery: {
      status: "ready",
    },
    browserInfo: {
      online: true,
      userAgent: "Mozilla/5.0",
    },
    localStore: {
      available: true,
      terminalSeedReady: true,
    },
    receivedAt: 1_999_000,
    reportedAt: 1_999_000,
    snapshots: {},
    source: "sync-runtime",
    staffAuthority: {
      status: "ready",
    },
    storeId,
    sync: {
      failedEventCount: 0,
      localOnlyEventCount: 0,
      pendingEventCount: 0,
      reviewEventCount: 0,
      status: "idle",
      uploadableEventCount: 0,
    },
    terminalId,
    terminalIntegrity: {
      observedAt: 1_999_000,
      status: "healthy",
    },
    ...overrides,
  };
}

function buildRegisterSession(
  overrides: Partial<Doc<"registerSession">> = {},
): Doc<"registerSession"> {
  return {
    _id: "register-1" as Id<"registerSession">,
    _creationTime: 1_990_000,
    closeoutRecords: [],
    closedAt: undefined,
    expectedCash: 0,
    openedAt: 1_980_000,
    openingFloat: 0,
    status: "open",
    storeId,
    terminalId,
    ...overrides,
  };
}
