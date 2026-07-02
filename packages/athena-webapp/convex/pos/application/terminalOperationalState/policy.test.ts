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

  it("keeps unresolved synced inventory conflicts in the inventory review lane", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        syncEvidence: {
          ...emptySyncEvidence(),
          conflictedCount: 2,
          unresolvedConflictCount: 2,
          reviewSummary: {
            groups: [
              {
                actionability: "manual_review",
                conflictType: "inventory",
                count: 2,
                latestCreatedAt: 1_999_000,
                latestSequence: 26,
                owner: "manual_review",
              },
            ],
            meta: {
              cap: 50,
              hasMore: false,
              sampledCount: 2,
              targetResolutionIncomplete: false,
            },
          },
        },
      }),
    );

    expect(state.attentionReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          count: 2,
          summary: "2 inventory review items need attention.",
          type: "synced_sale_inventory_review",
        }),
      ]),
    );
    expect(state.attentionReasons[0]?.actionTarget).toBeUndefined();
    expect(state.attentionReasons.map((reason) => reason.type)).not.toContain(
      "cloud_conflict",
    );
    expect(state.recoveryEvidence.manualReview).toEqual([
      {
        reason: "2 inventory review items need attention.",
        source: "cloud_sync",
        type: "synced_sale_inventory_review",
      },
    ]);
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

  it("replays uploaded register-open review items from matching collected terminal evidence", () => {
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
              type: "register.opened",
              uploaded: true,
              uploadSequence: 12,
            },
            {
              createdAt: now - 500,
              localEventId: "event-review-2",
              sequence: 13,
              status: "needs_review",
              type: "register.opened",
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
                type: "register.opened",
                uploaded: true,
                uploadSequence: 12,
              },
              {
                createdAt: now - 500,
                localEventId: "event-review-2",
                sequence: 13,
                status: "needs_review",
                type: "register.opened",
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
        expectedBlockerType: "local_review_replay",
      },
      commandType: "retry_sync",
      expectedEvidence: {
        syncStatus: "idle",
      },
    });
  });

  it("keeps collecting verified evidence when the latest runtime reports only a count", () => {
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
              type: "register.opened",
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
    expect(state.recoveryPreview.terminalActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandContext: expect.objectContaining({
            expectedBlockerType: "local_review_clear_all",
          }),
          commandType: "clear_local_review_items",
        }),
      ]),
    );
  });

  it("does not replay stale collected local review evidence after the runtime count clears", () => {
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
              sequence: 776,
              status: "needs_review",
              type: "register.opened",
              uploaded: true,
              uploadSequence: 1,
            },
            {
              createdAt: now - 500,
              localEventId: "event-review-2",
              sequence: 780,
              status: "needs_review",
              type: "transaction.completed",
              uploaded: true,
              uploadSequence: 2,
            },
          ],
          status: "completed",
          verificationStatus: "verified",
        },
        runtimeStatus: buildRuntimeStatus({
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 1,
            pendingEventCount: 0,
            reviewEventCount: 0,
            reviewEvents: [],
            status: "idle",
            uploadableEventCount: 0,
          },
        }),
      }),
    );

    expect(state.recoveryEvidence.terminalActions).toEqual([]);
  });

  it("replays current runtime local review evidence when collected evidence is stale", () => {
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
                type: "register.opened",
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
        expectedBlockerType: "local_review_replay",
      },
      commandType: "retry_sync",
      expectedEvidence: {
        syncStatus: "idle",
      },
    });
  });

  it("does not replay uploaded business-fact review items", () => {
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
      commandType: "collect_local_review",
      expectedEvidence: { localReviewDetailsCollected: true },
    });
  });

  it("replays uploaded local review backlogs without clearing an over-cap batch", () => {
    const reviewEvents = Array.from({ length: 100 }, (_, index) => ({
      createdAt: now - index,
      localEventId: `event-review-${index + 1}`,
      sequence: index + 1,
      status: "needs_review" as const,
      type: "register.opened",
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
        expectedBlockerType: "local_review_replay",
      },
      commandType: "retry_sync",
      expectedEvidence: {
        syncStatus: "idle",
      },
    });
  });

  it("adds bounded clear-all cleanup to the preview without changing primary recovery", () => {
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
                type: "register.opened",
                uploaded: true,
                uploadSequence: 12,
              },
              {
                createdAt: now - 500,
                localEventId: "event-review-2",
                sequence: 13,
                status: "needs_review",
                type: "register.opened",
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
        expectedBlockerType: "local_review_replay",
      },
      commandType: "retry_sync",
    });
    expect(state.recoveryPreview.terminalActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandContext: expect.objectContaining({
            expectedBlockerType: "local_review_clear_all",
            localReviewClearAll: true,
            localReviewClearLimit: 2,
            localReviewEventIds: ["event-review-1", "event-review-2"],
          }),
          commandType: "clear_local_review_items",
          expectedEvidence: {
            localReviewClearedEventIds: ["event-review-1", "event-review-2"],
            localReviewEventCount: 0,
          },
        }),
      ]),
    );
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

  it("keeps open-work cloud review counts separate from manual-review counts", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        syncEvidence: {
          ...emptySyncEvidence(),
          conflictedCount: 50,
          latestEvent: {
            eventType: "register_closed",
            localEventId: "local-conflicted",
            localRegisterSessionId: "local-register-1",
            occurredAt: 1_999_000,
            sequence: 44,
            status: "rejected",
            submittedAt: 1_999_000,
          },
          reviewSummary: {
            groups: [
              {
                actionability: "open_work_review",
                conflictType: "permission",
                count: 28,
                latestCreatedAt: 1_999_000,
                latestSequence: 44,
                owner: "operations_open_work",
                reviewTarget: {
                  type: "open_work",
                  workItemId: "work-item-1" as Id<"operationalWorkItem">,
                  workItemType: "synced_sale_inventory_review",
                },
              },
              {
                actionability: "manual_review",
                conflictType: "permission",
                count: 22,
                latestCreatedAt: 1_998_000,
                latestSequence: 43,
                owner: "manual_review",
              },
            ],
            meta: {
              cap: 50,
              hasMore: false,
              sampledCount: 50,
              targetResolutionIncomplete: false,
            },
          },
          unresolvedConflictCount: 50,
        },
      }),
    );

    expect(state.attentionReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionTarget: {
            label: "Review open work",
            type: "open_work",
          },
          count: 28,
          summary: "28 cloud sync conflicts need review.",
          type: "cloud_conflict",
        }),
        expect.objectContaining({
          count: 22,
          summary:
            "22 cloud sync conflicts require manager review before support can repair this terminal.",
          type: "cloud_conflict",
        }),
      ]),
    );
    expect(
      state.attentionReasons.find((reason) => reason.count === 22)?.actionTarget,
    ).toBeUndefined();
    expect(state.recoveryEvidence.manualReview).toEqual([
      {
        reason:
          "22 cloud sync conflicts require manager review before support can repair this terminal.",
        source: "cloud_sync",
        type: "cloud_conflict",
      },
    ]);
  });

  it("collapses unsafe cloud repair candidates into one fallback manual review blocker", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        cloudRepair: {
          preconditionHash: "hash",
          safeConflictIds: [],
          skippedConflictIds: [
            "unsafe-conflict-1" as Id<"posLocalSyncConflict">,
            "unsafe-conflict-2" as Id<"posLocalSyncConflict">,
            "unsafe-conflict-3" as Id<"posLocalSyncConflict">,
          ],
        },
      }),
    );

    expect(state.recoveryEvidence.manualReview).toEqual([
      {
        reason:
          "3 cloud sync conflicts require manager review before support can repair this terminal.",
        source: "cloud_repair",
        type: "unsafe_cloud_conflict",
      },
    ]);
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

  it("keeps capped sync review evidence from presenting as healthy", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        syncEvidence: {
          ...emptySyncEvidence(),
          reviewSummary: {
            groups: [],
            meta: {
              cap: 20,
              hasMore: true,
              sampledCount: 0,
              targetResolutionIncomplete: true,
            },
          },
        },
      }),
    );

    expect(state.attentionReasons).toContainEqual(
      expect.objectContaining({
        source: "cloud_sync",
        type: "cloud_conflict",
      }),
    );
    expect(state.terminalHealth).toBe("needs_attention");
    expect(state.operationalExplanation.summaryMeta.targetResolutionIncomplete).toBe(
      true,
    );
  });

  it("routes register-session sync review groups to cash controls", () => {
    const registerSessionId = "register-session-review" as Id<"registerSession">;
    const state = buildTerminalOperationalState(
      baseInput({
        syncEvidence: {
          ...emptySyncEvidence(),
          reviewSummary: {
            groups: [
              {
                actionTarget: {
                  registerSessionId,
                  type: "register_session",
                },
                actionability: "cash_controls_review",
                conflictType: "permission",
                count: 1,
                latestCreatedAt: 1_999_000,
                latestSequence: 14,
                owner: "cash_controls",
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
        },
      }),
    );

    expect(state.attentionReasons).toContainEqual(
      expect.objectContaining({
        actionTarget: {
          registerSessionId,
          type: "cash_control_register_session",
        },
        source: "cloud_sync",
        type: "cloud_conflict",
      }),
    );
    expect(state.operationalExplanation.primaryOwner).toBe("cash_controls");
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
      headline: "Manager review needed",
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

  it("drops stale local runtime attention reasons that no longer match runtime evidence", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        attentionReasons: [
          {
            count: 1,
            source: "local_runtime",
            summary: "1 local review item is still on this terminal.",
            type: "local_review",
          },
        ],
        runtimeStatus: buildRuntimeStatus({
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 0,
            status: "idle",
            uploadableEventCount: 0,
          },
        }),
      }),
    );

    expect(state.runtimeEvidence.effectiveStatus?.sync.reviewEventCount).toBe(0);
    expect(state.attentionReasons.map((reason) => reason.type)).not.toContain(
      "local_review",
    );
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
