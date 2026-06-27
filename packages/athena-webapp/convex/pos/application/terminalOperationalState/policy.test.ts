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
        skippedConflictIds: [],
      },
      syncEvidence: {
        ...emptySyncEvidence(),
        heldCount: 1,
        latestEvent: {
          eventType: "sale_completed",
          localEventId: "local-held",
          localRegisterSessionId: "local-register-1",
          occurredAt: 1_999_000,
          sequence: 12,
          status: "held",
          submittedAt: 1_999_000,
        },
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

  it("derives attention reasons inside the aggregate policy", () => {
    const state = buildTerminalOperationalState(
      baseInput({
        syncEvidence: {
          ...emptySyncEvidence(),
          conflictedCount: 1,
          latestEvent: {
            eventType: "sale_completed",
            localEventId: "local-conflicted",
            localRegisterSessionId: "local-register-1",
            occurredAt: 1_999_000,
            sequence: 7,
            status: "conflicted",
            submittedAt: 1_999_000,
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
