/**
 * `daily_operations.v1` — the first real Athena agent profile (V26-1267).
 *
 * A profile adds no kernel behaviour. It selects published package versions,
 * the scope it runs in, the budgets it may spend, the prompt and egress policy
 * it answers under, the presentation adapter the reusable host renders, and a
 * small set of representative smoke tasks. Everything semantic lives in the
 * domain packages this file imports; nothing here reaches a database.
 *
 * The profile ships `unpublished`. Its capabilities are `enabled` (they pass
 * the conformance gate), but no operator turn can reach them until the
 * profile switch is flipped on through the same enablement overlay that backs
 * the kill switch.
 */
import { budgetVector } from "../../../shared/agentHarness/execution";
import { defineAgentProfile, definePresentationAdapter } from "../../../shared/agentHarness/profile";
import type { AgentCapabilityManifest } from "../../../shared/agentHarness/manifest";
import type { AgentReadPortIndex } from "../../../shared/agentHarness/readPort";
import { AUTOMATION_MANIFEST, AUTOMATION_READ_PORTS } from "../../automation/agentCapabilities/evidence";
import { CASH_READ_PORTS, REGISTER_SESSIONS_MANIFEST } from "../../cashControls/agentCapabilities/registers";
import { ACTIVITY_MANIFEST, ACTIVITY_READ_PORTS } from "../../operations/agentCapabilities/activity";
import { STORE_DAY_MANIFEST, STORE_DAY_READ_PORTS } from "../../operations/agentCapabilities/storeDay";
import { WORK_MANIFESTS, WORK_READ_PORTS } from "../../operations/agentCapabilities/work";
import { REPORTS_MANIFESTS, REPORTS_READ_PORTS } from "../../reports/agentCapabilities/sales";
import { INVENTORY_MANIFESTS, INVENTORY_READ_PORTS } from "../../stockOps/agentCapabilities/inventory";

export const DAILY_OPERATIONS_PROFILE_ID = "daily_operations";
export const DAILY_OPERATIONS_PROFILE_VERSION = "1";

/** Every manifest the profile publishes: the eleven capability-matrix rows. */
export const DAILY_OPERATIONS_MANIFESTS: readonly AgentCapabilityManifest[] = [
  STORE_DAY_MANIFEST,
  ...WORK_MANIFESTS,
  ACTIVITY_MANIFEST,
  ...REPORTS_MANIFESTS,
  REGISTER_SESSIONS_MANIFEST,
  AUTOMATION_MANIFEST,
  ...INVENTORY_MANIFESTS,
];

export const DAILY_OPERATIONS_READ_PORTS: AgentReadPortIndex = {
  contractVersion: 1,
  ports: [
    ...STORE_DAY_READ_PORTS.ports,
    ...WORK_READ_PORTS.ports,
    ...ACTIVITY_READ_PORTS.ports,
    ...REPORTS_READ_PORTS.ports,
    ...CASH_READ_PORTS.ports,
    ...AUTOMATION_READ_PORTS.ports,
    ...INVENTORY_READ_PORTS.ports,
  ],
};

/**
 * The host shows the store and the operating date before any question is sent,
 * and snapshots the operating date into every turn. The thread key is
 * `daily_operations + store`: changing store composes a different key, so the
 * old thread detaches and a new store-scoped thread is offered. Changing the
 * date keeps the same thread, never mutates an active turn, and requires the
 * operator to confirm before the next turn.
 */
export const DAILY_OPERATIONS_PRESENTATION = definePresentationAdapter({
  contractVersion: 1,
  profileId: DAILY_OPERATIONS_PROFILE_ID,
  contextBinding: {
    scopeKind: "store",
    keys: ["storeRef", "operatingDate"],
    snapshotKeys: ["operatingDate"],
  },
  contextLabel: (context) => `${context.storeName ?? context.storeRef ?? "This store"} · ${context.operatingDate ?? ""}`.trim(),
  entry: { label: "Ask Athena", location: "operations.dailyOperations.header" },
  mountMode: "docked_panel",
  starterIntents: [
    {
      id: "close_readiness",
      label: "What is holding up the close?",
      prompt: "What is blocking the end-of-day close for this store day, and which lane is each item in?",
      requiresPackages: ["operations"],
    },
    {
      id: "open_drawers",
      label: "Which drawers are still open?",
      prompt: "Which register sessions are still open for this operating day, and how long have they been open?",
      requiresPackages: ["cash"],
    },
    {
      id: "stock_pressure",
      label: "What is running low?",
      prompt: "Which stock positions are low or out, and which of them have replenishment cover already?",
      requiresPackages: ["inventory"],
    },
    {
      id: "automation_today",
      label: "What did automation do today?",
      prompt: "What did Athena's Daily Operations automation do on this operating day, and under which policy?",
      requiresPackages: ["automation"],
    },
  ],
  /**
   * Citations resolve to the in-app route that owns the record. Only internal
   * routes are interactive in v1; an unknown source kind resolves to nothing
   * rather than guessing a destination.
   */
  resolveSourceDestination: (sourceRef) => {
    switch (sourceRef.kind) {
      case "store_day_record":
        return {
          kind: "internal_route",
          route: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
          label: "Opening handoff",
        };
      case "close_record":
        return {
          kind: "internal_route",
          route: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
          label: "EOD review",
        };
      case "work_item":
        return {
          kind: "internal_route",
          route: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
          label: "Open work",
        };
      case "approval_request":
        return {
          kind: "internal_route",
          route: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
          label: "Approvals",
        };
      case "register_session":
      case "closeout":
        return {
          kind: "internal_route",
          route: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls",
          label: "Cash controls",
        };
      case "timeline_event":
        return {
          kind: "internal_route",
          route: "/$orgUrlSlug/store/$storeUrlSlug/operations",
          label: "Daily operations",
        };
      case "automation_run":
      case "automation_policy":
        return {
          kind: "internal_route",
          route: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
          label: "Automation evidence",
        };
      case "report_revision":
      case "live_snapshot":
      case "summary_source":
        return {
          kind: "internal_route",
          route: "/$orgUrlSlug/store/$storeUrlSlug/reports",
          label: "Reports",
        };
      case "sku_snapshot":
      case "replenishment_recommendation":
        return {
          kind: "internal_route",
          route: "/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments",
          label: "Stock",
        };
      default:
        return null;
    }
  },
  threadKeyPolicy: {
    parts: ["profileId", "storeRef"],
    onContextChange: "confirm_before_next_turn",
    activeTurnPolicy: "block_second_submission",
  },
});

export const DAILY_OPERATIONS_PROFILE = defineAgentProfile({
  contractVersion: 1,
  profileId: DAILY_OPERATIONS_PROFILE_ID,
  profileVersion: DAILY_OPERATIONS_PROFILE_VERSION,
  /**
   * Published: the profile MAY be reached by operators. It is not on yet —
   * the durable enablement switch is default-off and shrink-only, so an
   * operator turn is admitted only once `bun run agent-harness:switch
   * --profile daily_operations --enable` writes the row on the deployment.
   * Publication is the code-side decision; enablement is the operational one.
   */
  lifecycle: "enabled",
  scope: { kind: "store" },
  packages: [
    { packageKey: "operations", packageVersion: "1.0.0" },
    { packageKey: "reports", packageVersion: "1.0.0" },
    { packageKey: "cash", packageVersion: "1.0.0" },
    { packageKey: "automation", packageVersion: "1.0.0" },
    { packageKey: "inventory", packageVersion: "1.0.0" },
  ],
  /**
   * Derived from the program-runtime ceilings (`AGENT_PROGRAM_RUNTIME_CEILINGS`
   * in `convex/agentHarness/programRuntime/types.ts`). The numbers are repeated
   * rather than imported because a profile may not reach kernel internals; the
   * profile conformance test asserts they stay inside those ceilings.
   */
  budgetPolicy: {
    runLimits: budgetVector({
      calls: 24,
      rows: 5_000,
      bytes: 2_097_152,
      costUnits: 2_000,
      elapsedMs: 60_000,
    }),
    maxAttempts: 3,
    maxInFlightCalls: 4,
  },
  promptPolicy: {
    intent:
      "Answer bounded, read-only questions about one store's operating day using only the Daily Operations capability packages, and say plainly what could not be read.",
    untrustedDataLabel: "retrieved_store_data",
    maxPromptBytes: 16_384,
    maxPromptTokens: 4_000,
  },
  egressPolicy: {
    // Sensitive is the ceiling: every sensitive projection in the package set
    // (financials, cash, manager review, policy detail, cost overlay) is
    // classified `sensitive`, and nothing reaches `restricted`.
    maxClass: "sensitive",
    // gpt-5-mini adopted 2026-08-24 after the CLI regression phases: same
    // 20/20 commit rate as nano with half the output tokens and ~40% faster
    // first delta; nano remains the fallback default in the adapter smoke.
    providers: [{ providerId: "openai", modelId: "gpt-5-mini", region: "us", maxClass: "sensitive" }],
  },
  runtimeAdapterKind: "convex_agent",
  narrativePolicy: "provisional_streaming",
  presentation: DAILY_OPERATIONS_PRESENTATION,
  evaluation: {
    scenarios: [
      {
        id: "cross_package_readiness",
        kind: "cross_package",
        prompt:
          "Is this store day ready to close? Cover the readiness lanes, open registers, the work queue, today's sales, what automation did, and any stock that needs ordering.",
        expects: [
          "operations.storeDay",
          "cash.registerSessions",
          "operations.attention",
          "reports.daySales",
          "automation.dailyOperations",
          "inventory.positions",
        ],
      },
      {
        id: "role_restricted_financials",
        kind: "role_restricted",
        prompt: "What did the store take today, and how does that compare with the rest of the week?",
        expects: [
          "full admin reads reports.daySales and reports.weekPerformance",
          "pos-only operator does not discover the reports package at all",
          "cash totals absent, never zero, for a pos-only operator",
        ],
      },
      {
        id: "partial_no_data_day",
        kind: "partial_or_no_data",
        prompt: "How did the store trade on a day it was closed?",
        expects: [
          "reports.daySales reports recordState absent",
          "completeness partial with an explicit unavailable source",
          "no fabricated totals",
        ],
      },
      {
        id: "citation_resolution",
        kind: "citation_resolution",
        prompt: "Which register had a variance today, and what proves it?",
        expects: ["cash.registerSessions citation resolves to a session and closeout version"],
      },
    ],
  },
});
