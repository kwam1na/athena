/**
 * What Daily Operations tells the reusable agent host about itself.
 *
 * The published `daily_operations` profile owns these values on the server, but
 * that module reaches Convex server code and cannot enter the browser bundle,
 * so the surface declares the same adapter here. `dailyOperationsAgentPresentation.test.ts`
 * is the drift guard: identity, entry, mount mode, context binding, labels,
 * thread-key policy, starter intents, and every source destination are asserted
 * against the published profile.
 *
 * The host contains no Daily Operations knowledge; everything surface-specific
 * is in this file.
 */
import { defineAthenaAgentPresentation } from "@/components/agent/AthenaAgentPresentationAdapter";

export const DAILY_OPERATIONS_AGENT_PRESENTATION = defineAthenaAgentPresentation({
  contractVersion: 1,
  profileId: "daily_operations",
  contextBinding: {
    scopeKind: "store",
    keys: ["storeRef", "operatingDate"],
    snapshotKeys: ["operatingDate"],
  },
  contextLabel: (context) =>
    `${context.storeName ?? context.storeRef ?? "This store"} · ${context.operatingDate ?? ""}`.trim(),
  entry: { label: "Ask Athena", location: "operations.dailyOperations.header" },
  mountMode: "docked_panel",
  starterIntents: [
    {
      id: "close_readiness",
      label: "What is holding up the close?",
      prompt:
        "What is blocking the end-of-day close for this store day, and which lane is each item in?",
      requiresPackages: ["operations"],
    },
    {
      id: "open_drawers",
      label: "Which drawers are still open?",
      prompt:
        "Which register sessions are still open for this operating day, and how long have they been open?",
      requiresPackages: ["cash"],
    },
    {
      id: "stock_pressure",
      label: "What is running low?",
      prompt:
        "Which stock positions are low or out, and which of them have replenishment cover already?",
      requiresPackages: ["inventory"],
    },
    {
      id: "automation_today",
      label: "What did automation do today?",
      prompt:
        "What did Athena's Daily Operations automation do on this operating day, and under which policy?",
      requiresPackages: ["automation"],
    },
  ],
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

/** The explicit way back to this surface from the full-screen layout. */
export const DAILY_OPERATIONS_AGENT_RETURN_LABEL = "Back to Daily Operations";
