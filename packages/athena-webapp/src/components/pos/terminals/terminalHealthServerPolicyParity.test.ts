import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { buildTerminalOperationalState } from "../../../../convex/pos/application/terminalOperationalState/policy";
import type { TerminalOperationalPolicyInput } from "../../../../convex/pos/application/terminalOperationalState/types";

import { buildTerminalOperationalExplanationPresentation } from "./terminalHealthPresentation";

/**
 * Parity coverage for the Terminal Health read boundary.
 *
 * Each scenario feeds one set of terminal facts to the server aggregate
 * (`buildTerminalOperationalState`) and renders the resulting operational
 * explanation through the frontend presentation layer. The rendered lane,
 * label, and next step are asserted so roster and detail surfaces cannot drift
 * from server policy for the same facts.
 */

const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;

// Frontend freshness helpers compare against the wall clock, so fixtures must
// use clock-relative observation times to characterize behavior fairly.
const now = Date.now();
const FRESH_OBSERVED_AT = now - 30_000;
const STALE_OBSERVED_AT = now - 90 * 60_000;

type Scenario = {
  expected: {
    detail: string;
    headline: string;
    label: string;
    lane: string;
    ownerLabel: string;
    saleImpactLabel: string;
    severity: string;
    supportActionLabel: string;
  };
  name: string;
  input: TerminalOperationalPolicyInput;
};

const MISSING_AGGREGATE = {
  detail: "Athena has not received a health summary for this terminal.",
  headline: "Health status unavailable",
  label: "Health unavailable",
  lane: "unknown",
  nextStep: "Refresh terminal health or wait for the next check-in.",
  ownerLabel: "No owner",
  saleImpactLabel: "Sale impact unknown",
  severity: "warning",
  supportActionLabel: "No support action",
};

const scenarios: Scenario[] = [
  {
    expected: {
      detail: "No terminal health blockers are reported.",
      headline: "Healthy idle",
      label: "Healthy",
      lane: "healthy_idle",
      ownerLabel: "No owner",
      saleImpactLabel: "Sale impact unknown",
      severity: "info",
      supportActionLabel: "No support action",
    },
    name: "healthy",
    input: baseInput(),
  },
  {
    expected: {
      detail: "A drawer is open for this terminal.",
      headline: "Drawer open",
      label: "Drawer open",
      lane: "drawer_open",
      ownerLabel: "No owner",
      saleImpactLabel: "Sale impact unknown",
      severity: "info",
      supportActionLabel: "No support action",
    },
    name: "drawer-open",
    input: baseInput({
      runtimeStatus: buildRuntimeStatus({
        activeRegisterSession: {
          localRegisterSessionId: "local-register-1",
          observedAt: FRESH_OBSERVED_AT,
          openedAt: now - 20 * 60_000,
          status: "open",
        },
      }),
    }),
  },
  {
    expected: {
      detail: "Terminal runtime evidence is stale or unavailable.",
      headline: "Waiting for check-in",
      label: "Waiting for check-in",
      lane: "stale_runtime",
      ownerLabel: "Terminal",
      saleImpactLabel: "Sale impact unknown",
      severity: "warning",
      supportActionLabel: "Wait for check-in",
    },
    name: "stale",
    input: baseInput({
      runtimeAgeMs: 90 * 60_000,
      runtimeFresh: false,
      runtimeStatus: buildRuntimeStatus({
        receivedAt: STALE_OBSERVED_AT,
        reportedAt: STALE_OBSERVED_AT,
      }),
    }),
  },
  {
    expected: {
      detail: "Manual review must finish before support repairs this terminal.",
      headline: "Manager review needed",
      label: "Manager review needed",
      lane: "needs_manual_review",
      ownerLabel: "Manager",
      saleImpactLabel: "Sales can continue",
      severity: "critical",
      supportActionLabel: "Manual review",
    },
    name: "needs-review",
    input: baseInput({
      attentionReasons: [
        {
          actionTarget: { type: "open_work" },
          count: 3,
          source: "cloud_sync",
          summary: "3 synced sale events need review.",
          type: "cloud_held",
        },
      ],
      runtimeStatus: buildRuntimeStatus({
        activeRegisterSession: {
          localRegisterSessionId: "local-register-1",
          observedAt: FRESH_OBSERVED_AT,
          openedAt: now - 20 * 60_000,
          status: "open",
        },
        saleAuthority: {
          observedAt: FRESH_OBSERVED_AT,
          status: "ready",
          transactionMode: "products_and_services",
        },
      }),
    }),
  },
  {
    expected: {
      detail:
        "Support can run the safe cloud repair for the listed sync evidence.",
      headline: "Cloud repair available",
      label: "Cloud repair",
      lane: "needs_cloud_repair",
      ownerLabel: "Support",
      saleImpactLabel: "Sales not ready",
      severity: "warning",
      supportActionLabel: "Safe cloud repair",
    },
    name: "recovery",
    input: baseInput({
      cloudRepair: {
        hasMoreCandidates: false,
        obsoleteConflictIds: [],
        preconditionHash: "terminal-cloud-repair:safe",
        safeConflictIds: ["conflict-safe-1" as Id<"posLocalSyncConflict">],
        skippedConflictIds: [],
      },
    }),
  },
];

describe("terminal health server policy parity", () => {
  for (const scenario of scenarios) {
    it(`renders the server operational state for ${scenario.name}`, () => {
      const state = buildTerminalOperationalState(scenario.input);
      const summary = buildSummary(scenario.input, state);
      const presentation =
        buildTerminalOperationalExplanationPresentation(summary);

      expect(renderable(presentation)).toEqual(
        expect.objectContaining(scenario.expected),
      );
      expect(presentation.source).toBe("server_aggregate");
      expect(presentation.lane).toBe(state.operationalExplanation.lane);
      expect(presentation.saleImpact).toBe(
        state.operationalExplanation.saleImpact,
      );
      expect(presentation.primaryOwner).toBe(
        state.operationalExplanation.primaryOwner,
      );
    });

    it(`does not reconstruct ${scenario.name} state when the aggregate is missing`, () => {
      const state = buildTerminalOperationalState(scenario.input);
      const presentation = buildTerminalOperationalExplanationPresentation({
        ...buildSummary(scenario.input, state),
        operationalExplanation: null,
      });

      expect(renderable(presentation)).toEqual(MISSING_AGGREGATE);
      expect(presentation.source).toBe("missing_aggregate");
      expect(presentation.evidenceReferences).toEqual([]);
    });
  }
});

function renderable(
  presentation: ReturnType<
    typeof buildTerminalOperationalExplanationPresentation
  >,
) {
  return {
    detail: presentation.detail,
    headline: presentation.headline,
    label: presentation.label,
    lane: presentation.lane,
    nextStep: presentation.nextStep,
    ownerLabel: presentation.ownerLabel,
    saleImpactLabel: presentation.saleImpactLabel,
    severity: presentation.severity,
    supportActionLabel: presentation.supportActionLabel,
  };
}

function buildSummary(
  input: TerminalOperationalPolicyInput,
  state: ReturnType<typeof buildTerminalOperationalState>,
) {
  const effectiveRuntimeStatus = state.runtimeEvidence.effectiveStatus;
  return {
    attentionReasons: state.attentionReasons,
    health: state.terminalHealth,
    operationalExplanation: state.operationalExplanation,
    recoveryPreview: state.recoveryPreview,
    runtimeStatus: effectiveRuntimeStatus
      ? ({
          ...effectiveRuntimeStatus,
        } as never)
      : null,
    syncEvidence: input.syncEvidence,
    terminal: { status: input.terminalStatus },
  } as Parameters<typeof buildTerminalOperationalExplanationPresentation>[0];
}

function baseInput(
  overrides: Partial<TerminalOperationalPolicyInput> = {},
): TerminalOperationalPolicyInput {
  return {
    appUpdate: {
      evidenceFresh: false,
      status: "unknown",
    },
    cloudRepair: {
      hasMoreCandidates: false,
      obsoleteConflictIds: [],
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
    syncEvidence: emptySyncEvidence(),
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
    _creationTime: FRESH_OBSERVED_AT,
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
    receivedAt: FRESH_OBSERVED_AT,
    reportedAt: FRESH_OBSERVED_AT,
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
      observedAt: FRESH_OBSERVED_AT,
      status: "healthy",
    },
    ...overrides,
  };
}
