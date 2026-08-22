/**
 * CONTRACT FIXTURE, not a published manifest.
 *
 * The plan's "Daily Operations v1 capability matrix" expressed row by row in
 * the v1 manifest contract. It exists so the contract test can prove every
 * column of the matrix (verbs, required filters, maxima and pages-per-run,
 * read intents, sensitive projections, freshness/completeness/citation rules)
 * is expressible without kernel changes. U8 authors the real manifests next to
 * the domain read code and may refine field names; this fixture is not
 * imported by any kernel module.
 */
import { budgetVector } from "./execution";
import { defineCapabilityManifest, type AgentCapabilityManifest } from "./manifest";

const PAGE_LIST_COST = budgetVector({
  calls: 1,
  rows: 100,
  bytes: 196_608,
  costUnits: 3,
  elapsedMs: 2_500,
});

const SNAPSHOT_COST = budgetVector({
  calls: 1,
  rows: 50,
  bytes: 131_072,
  costUnits: 2,
  elapsedMs: 2_000,
});

const operatingDateFilter = {
  kind: "operatingDate",
  required: true,
  meaning: "Operating date; the server derives the window through store time.",
} as const;

export const DAILY_OPERATIONS_MATRIX_FIXTURE: readonly AgentCapabilityManifest[] = [
  defineCapabilityManifest({
    contractVersion: 1,
    capabilityId: "cap_dailyops_store_day",
    namespace: { package: "operations", resource: "storeDay" },
    packageVersion: "1.0.0",
    purpose: "Store-day lifecycle, readiness, and close state for one operating date.",
    scope: { kind: "store" },
    lifecycle: "unpublished",
    operations: {
      get: {
        purpose: "One store-day snapshot.",
        filters: { operatingDate: operatingDateFilter },
        bounds: { kind: "snapshot" },
      },
    },
    result: {
      fields: {
        operatingDate: { kind: "operatingDate", meaning: "Operating date." },
        lifecycleStage: {
          kind: "enum",
          values: ["not_opened", "open", "closing", "closed"],
          meaning: "Lifecycle stage.",
        },
        openingRecordRef: { kind: "opaqueRef", refKind: "source", optional: true, meaning: "Accepted opening record." },
        closeRecordRef: { kind: "opaqueRef", refKind: "source", optional: true, meaning: "Accepted close record." },
        managerReviewEvidence: {
          kind: "text",
          meaning: "Manager review evidence.",
          projection: "managerReview",
          valueState: true,
        },
      },
    },
    projections: {
      managerReview: { requires: { tier: "full_admin" }, egressClass: "sensitive", meaning: "Manager review evidence." },
    },
    freshness: {
      classes: ["live", "accepted"],
      authority: "authoritative_record",
      rule: "Live for the current day; accepted close/open records authoritative for historical state.",
    },
    completeness: {
      rule: "Conjunction of lifecycle and close-source coverage.",
      sourceKeys: ["lifecycle", "closeRecords"],
    },
    citation: { rule: "Cite source record versions plus capture time.", sourceRefKinds: ["store_day_record", "close_record"] },
    evidence: { mode: "extractor", extractorKey: "operations.storeDay", extractorVersion: "1", claimShapes: ["lifecycleStage"] },
    cost: { worstCasePerCall: SNAPSHOT_COST },
    egressClass: "operational",
    examples: [{ title: "Today", verb: "get", args: { operatingDate: "2026-08-21" }, description: "Current operating day." }],
    binding: { readIntents: ["daily_operations.view", "daily_close.view"], portKey: "operations.storeDay", implementationVersion: "1" },
  }),
  defineCapabilityManifest({
    contractVersion: 1,
    capabilityId: "cap_dailyops_attention",
    namespace: { package: "operations", resource: "attention" },
    packageVersion: "1.0.0",
    purpose: "Attention items and lanes that need an operator.",
    scope: { kind: "store" },
    lifecycle: "unpublished",
    operations: {
      list: {
        purpose: "Page attention items for one operating date.",
        filters: {
          operatingDate: operatingDateFilter,
          status: { kind: "enum", required: false, values: ["open", "resolved"], meaning: "Item status." },
        },
        bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 2 },
      },
    },
    result: {
      fields: {
        itemRef: { kind: "opaqueRef", refKind: "resource", meaning: "Attention item ref." },
        lane: { kind: "string", meaning: "Contributing lane." },
        title: { kind: "string", meaning: "Item title." },
        managerReason: { kind: "text", meaning: "Manager-only reason.", projection: "managerReasons" },
      },
    },
    projections: {
      managerReasons: { requires: { tier: "manager" }, egressClass: "sensitive", meaning: "Manager-only reasons and evidence." },
    },
    freshness: { classes: ["live"], authority: "live_read", rule: "Live queue snapshot." },
    completeness: { rule: "Derived from every contributing lane and page, not one boolean.", sourceKeys: ["lanes", "pages"] },
    citation: { rule: "Cite work/approval opaque refs and capture time.", sourceRefKinds: ["work_item", "approval_request"] },
    evidence: { mode: "provenance_only", reason: "Queue membership is transient." },
    cost: { worstCasePerCall: PAGE_LIST_COST },
    egressClass: "operational",
    examples: [{ title: "Open items", verb: "list", args: { operatingDate: "2026-08-21" }, description: "First page." }],
    binding: { readIntents: ["daily_operations.view", "operations.workItems.view"], portKey: "operations.attention", implementationVersion: "1" },
  }),
  defineCapabilityManifest({
    contractVersion: 1,
    capabilityId: "cap_dailyops_approvals",
    namespace: { package: "operations", resource: "approvals" },
    packageVersion: "1.0.0",
    purpose: "Pending approval requests for the store day.",
    scope: { kind: "store" },
    lifecycle: "unpublished",
    operations: {
      list: {
        purpose: "Page pending approvals.",
        filters: {
          operatingDate: operatingDateFilter,
          state: { kind: "enum", required: true, values: ["pending"], meaning: "Only pending requests are listable in v1." },
        },
        bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 2 },
      },
    },
    result: {
      fields: {
        requestRef: { kind: "opaqueRef", refKind: "resource", meaning: "Approval request ref." },
        kind: { kind: "string", meaning: "Request kind." },
        stateVersion: { kind: "string", meaning: "Current state version." },
        approvalProof: { kind: "text", meaning: "Approval proof.", projection: "approvalProof" },
      },
    },
    projections: {
      approvalProof: { requires: { tier: "full_admin" }, egressClass: "sensitive", meaning: "Approval proof and reviewer details." },
    },
    freshness: { classes: ["live"], authority: "live_read", rule: "Live." },
    completeness: { rule: "Complete only when all pages are consumed.", sourceKeys: ["pages"] },
    citation: { rule: "Cite request refs and current state versions.", sourceRefKinds: ["approval_request"] },
    evidence: { mode: "provenance_only", reason: "Pending state changes quickly." },
    cost: { worstCasePerCall: PAGE_LIST_COST },
    egressClass: "operational",
    examples: [{ title: "Pending", verb: "list", args: { operatingDate: "2026-08-21", state: "pending" }, description: "Pending approvals." }],
    binding: { readIntents: ["daily_operations.view", "operations.workItems.view"], portKey: "operations.approvals", implementationVersion: "1" },
  }),
  defineCapabilityManifest({
    contractVersion: 1,
    capabilityId: "cap_dailyops_day_sales",
    namespace: { package: "reports", resource: "daySales" },
    packageVersion: "1.0.0",
    purpose: "Daily sales summary with top items and payment groups.",
    scope: { kind: "store" },
    lifecycle: "unpublished",
    operations: {
      get: {
        purpose: "One day summary.",
        filters: { operatingDate: operatingDateFilter },
        bounds: { kind: "snapshot", maxEmbeddedItems: 50 },
      },
    },
    result: {
      fields: {
        operatingDate: { kind: "operatingDate", meaning: "Operating date." },
        transactionCount: { kind: "integer", meaning: "Completed transactions." },
        revenue: { kind: "money", meaning: "Gross revenue.", projection: "financial", valueState: true },
        topItems: {
          kind: "array",
          maxItems: 50,
          meaning: "Top items by quantity.",
          items: {
            kind: "object",
            meaning: "Top item.",
            fields: {
              skuRef: { kind: "opaqueRef", refKind: "resource", meaning: "SKU ref." },
              quantity: { kind: "quantity", meaning: "Units sold." },
              value: { kind: "money", meaning: "Item value.", projection: "financial" },
            },
          },
        },
      },
    },
    projections: {
      financial: { requires: { tier: "full_admin" }, egressClass: "sensitive", meaning: "Revenue, payments, variance, top-item value." },
    },
    freshness: {
      classes: ["accepted", "live"],
      authority: "authoritative_record",
      rule: "Accepted/frozen report authoritative after close; live operating-day read otherwise; sub-sources carry their own capture time.",
    },
    completeness: { rule: "Each sub-source reports coverage.", sourceKeys: ["report", "liveDay", "topItems"] },
    citation: { rule: "Cite report revision/fingerprint or live snapshot hash.", sourceRefKinds: ["report_revision", "live_snapshot"] },
    evidence: { mode: "extractor", extractorKey: "reports.daySales", extractorVersion: "1", claimShapes: ["transactionCount", "revenue"] },
    cost: { worstCasePerCall: SNAPSHOT_COST },
    egressClass: "operational",
    examples: [{ title: "Yesterday", verb: "get", args: { operatingDate: "2026-08-20" }, description: "Closed day." }],
    binding: { readIntents: ["reports.view", "pos.view"], portKey: "reports.daySales", implementationVersion: "1" },
  }),
  defineCapabilityManifest({
    contractVersion: 1,
    capabilityId: "cap_dailyops_week_performance",
    namespace: { package: "reports", resource: "weekPerformance" },
    packageVersion: "1.0.0",
    purpose: "Seven-day performance with the prior boundary day.",
    scope: { kind: "store" },
    lifecycle: "unpublished",
    operations: {
      get: {
        purpose: "Week ending at an operating date.",
        filters: {
          weekEndOperatingDate: { kind: "operatingDate", required: true, meaning: "Week-ending operating date." },
        },
        bounds: { kind: "snapshot", maxEmbeddedItems: 8 },
      },
    },
    result: {
      fields: {
        days: {
          kind: "array",
          maxItems: 8,
          meaning: "Per-day metrics.",
          items: {
            kind: "object",
            meaning: "Day metrics.",
            fields: {
              operatingDate: { kind: "operatingDate", meaning: "Day." },
              revenue: { kind: "money", meaning: "Revenue.", projection: "financial", valueState: true },
            },
          },
        },
      },
    },
    projections: {
      financial: { requires: { tier: "full_admin" }, egressClass: "sensitive", meaning: "All financial metrics." },
    },
    freshness: { classes: ["accepted", "live"], authority: "authoritative_record", rule: "Per-day accepted report when available, else explicitly live/partial." },
    completeness: { rule: "Lists missing or truncated days.", sourceKeys: ["days"] },
    citation: { rule: "Cite each day revision.", sourceRefKinds: ["report_revision"] },
    evidence: { mode: "extractor", extractorKey: "reports.weekPerformance", extractorVersion: "1", claimShapes: ["days"] },
    cost: { worstCasePerCall: SNAPSHOT_COST },
    egressClass: "operational",
    examples: [{ title: "This week", verb: "get", args: { weekEndOperatingDate: "2026-08-21" }, description: "Week to date." }],
    binding: { readIntents: ["reports.view"], portKey: "reports.weekPerformance", implementationVersion: "1" },
  }),
  defineCapabilityManifest({
    contractVersion: 1,
    capabilityId: "cap_dailyops_store_pulse",
    namespace: { package: "reports", resource: "storePulse" },
    packageVersion: "1.0.0",
    purpose: "Bounded store pulse summary for today or the week.",
    scope: { kind: "store" },
    lifecycle: "unpublished",
    operations: {
      get: {
        purpose: "One bounded summary.",
        filters: {
          operatingDate: operatingDateFilter,
          window: { kind: "enum", required: true, values: ["today", "week"], meaning: "Summary window." },
        },
        bounds: { kind: "snapshot" },
      },
    },
    result: {
      fields: {
        window: { kind: "enum", values: ["today", "week"], meaning: "Window." },
        pulse: { kind: "money", meaning: "Financial pulse.", projection: "financial", valueState: true },
      },
    },
    projections: {
      financial: { requires: { tier: "full_admin" }, egressClass: "sensitive", meaning: "Financial pulse fields." },
    },
    freshness: { classes: ["derived", "live", "accepted"], authority: "derived", rule: "Mixed-time sources allowed and individually timestamped." },
    completeness: { rule: "Aggregate completeness is the minimum input completeness.", sourceKeys: ["sales", "activity", "work"] },
    citation: { rule: "Cite constituent summary sources.", sourceRefKinds: ["summary_source"] },
    evidence: { mode: "provenance_only", reason: "Derived from constituent sources." },
    cost: { worstCasePerCall: SNAPSHOT_COST },
    egressClass: "operational",
    examples: [{ title: "Today", verb: "get", args: { operatingDate: "2026-08-21", window: "today" }, description: "Today's pulse." }],
    binding: { readIntents: ["reports.view"], portKey: "reports.storePulse", implementationVersion: "1" },
  }),
  defineCapabilityManifest({
    contractVersion: 1,
    capabilityId: "cap_dailyops_register_sessions",
    namespace: { package: "cash", resource: "registerSessions" },
    packageVersion: "1.0.0",
    purpose: "Register session state and closeouts.",
    scope: { kind: "store" },
    lifecycle: "unpublished",
    operations: {
      list: {
        purpose: "Page sessions for an operating date.",
        filters: {
          operatingDate: operatingDateFilter,
          status: { kind: "enum", required: false, values: ["open", "closing", "closed"], meaning: "Session status partition." },
        },
        bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 2 },
      },
      get: {
        purpose: "One session snapshot.",
        filters: { sessionRef: { kind: "opaqueRef", refKind: "resource", required: true, meaning: "Session ref." } },
        bounds: { kind: "snapshot" },
      },
    },
    result: {
      fields: {
        sessionRef: { kind: "opaqueRef", refKind: "resource", meaning: "Session ref." },
        status: { kind: "enum", values: ["open", "closing", "closed"], meaning: "Status." },
        cashTotal: { kind: "money", meaning: "Cash total.", projection: "cashFinancials", valueState: true },
        variance: { kind: "money", meaning: "Variance.", projection: "cashFinancials", valueState: true },
      },
    },
    projections: {
      cashFinancials: { requires: { tier: "full_admin" }, egressClass: "sensitive", meaning: "Cash totals, variance, deposits, reviewer evidence." },
    },
    freshness: { classes: ["live"], authority: "live_read", rule: "Live session state." },
    completeness: { rule: "Complete only after status partitions and pages are exhausted.", sourceKeys: ["partitions", "pages"] },
    citation: { rule: "Cite session and closeout versions without raw ids.", sourceRefKinds: ["register_session", "closeout"] },
    evidence: { mode: "extractor", extractorKey: "cash.registerSessions", extractorVersion: "1", claimShapes: ["status"] },
    cost: { worstCasePerCall: PAGE_LIST_COST },
    egressClass: "operational",
    examples: [
      { title: "Open sessions", verb: "list", args: { operatingDate: "2026-08-21", status: "open" }, description: "Open now." },
      { title: "One session", verb: "get", args: { sessionRef: "resource:session-7" }, description: "Snapshot." },
    ],
    binding: { readIntents: ["cash_controls.view"], portKey: "cash.registerSessions", implementationVersion: "1" },
  }),
  defineCapabilityManifest({
    contractVersion: 1,
    capabilityId: "cap_dailyops_activity",
    namespace: { package: "operations", resource: "activity" },
    packageVersion: "1.0.0",
    purpose: "Operational activity timeline.",
    scope: { kind: "store" },
    lifecycle: "unpublished",
    operations: {
      list: {
        purpose: "Page timeline events, newest first.",
        filters: {
          operatingDate: operatingDateFilter,
          before: { kind: "opaqueRef", refKind: "resource", required: false, meaning: "Event ref to page before." },
        },
        bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 3 },
      },
    },
    result: {
      fields: {
        eventRef: { kind: "opaqueRef", refKind: "resource", meaning: "Event ref." },
        occurredAt: { kind: "timestamp", meaning: "Event time." },
        family: { kind: "string", meaning: "Source family." },
        financialDetail: { kind: "text", meaning: "Financial detail.", projection: "financialEvents" },
      },
    },
    projections: {
      financialEvents: { requires: { tier: "manager" }, egressClass: "sensitive", meaning: "Manager review and financial event details." },
    },
    freshness: { classes: ["live"], authority: "live_read", rule: "Event-time ordered but separately captured." },
    completeness: { rule: "Reflects page boundary and source-family coverage.", sourceKeys: ["pages", "sourceFamilies"] },
    citation: { rule: "Cite normalized event/source refs.", sourceRefKinds: ["timeline_event"] },
    evidence: { mode: "provenance_only", reason: "Events are immutable references." },
    cost: { worstCasePerCall: PAGE_LIST_COST },
    egressClass: "operational",
    examples: [{ title: "Recent", verb: "list", args: { operatingDate: "2026-08-21" }, description: "Newest events." }],
    binding: { readIntents: ["daily_operations.view", "workflow_traces.view"], portKey: "operations.activity", implementationVersion: "1" },
  }),
  defineCapabilityManifest({
    contractVersion: 1,
    capabilityId: "cap_dailyops_automation",
    namespace: { package: "automation", resource: "dailyOperations" },
    packageVersion: "1.0.0",
    purpose: "Automation run and policy evidence for the store day.",
    scope: { kind: "store" },
    lifecycle: "unpublished",
    operations: {
      list: {
        purpose: "Runs and policies for an operating date.",
        filters: {
          operatingDate: operatingDateFilter,
          action: { kind: "enum", required: false, values: ["opening_auto_start", "eod_auto_complete", "register_closeout_approval"], meaning: "Automation action." },
        },
        bounds: { kind: "collection", maxItemsPerPage: 50, maxPagesPerRun: 1 },
      },
    },
    result: {
      fields: {
        runRef: { kind: "opaqueRef", refKind: "source", meaning: "Run idempotency/outcome ref." },
        action: { kind: "string", meaning: "Action." },
        outcome: { kind: "string", meaning: "Outcome." },
        policyVersion: { kind: "string", meaning: "Policy version." },
        thresholds: { kind: "text", meaning: "Policy thresholds.", projection: "policyDetails" },
      },
    },
    projections: {
      policyDetails: { requires: { tier: "full_admin" }, egressClass: "sensitive", meaning: "Policy thresholds and review evidence." },
    },
    freshness: { classes: ["live"], authority: "live_read", rule: "Automation ledger is evidence, not domain truth." },
    completeness: { rule: "Reports missing scheduled windows.", sourceKeys: ["runs", "scheduledWindows"] },
    citation: { rule: "Cite policy version and run idempotency/outcome refs.", sourceRefKinds: ["automation_run", "automation_policy"] },
    evidence: { mode: "provenance_only", reason: "Ledger rows are references." },
    cost: { worstCasePerCall: budgetVector({ calls: 1, rows: 50, bytes: 98_304, costUnits: 2, elapsedMs: 2_000 }) },
    egressClass: "operational",
    examples: [{ title: "Today", verb: "list", args: { operatingDate: "2026-08-21" }, description: "All actions." }],
    binding: { readIntents: ["daily_operations.view"], portKey: "automation.dailyOperations", implementationVersion: "1" },
  }),
  defineCapabilityManifest({
    contractVersion: 1,
    capabilityId: "cap_dailyops_inventory_positions",
    namespace: { package: "inventory", resource: "positions" },
    packageVersion: "1.0.0",
    purpose: "Live stock positions.",
    scope: { kind: "store" },
    lifecycle: "unpublished",
    operations: {
      list: {
        purpose: "Page positions.",
        filters: {
          category: { kind: "string", required: false, meaning: "Category label." },
          stockState: { kind: "enum", required: false, values: ["in_stock", "low", "out"], meaning: "Stock state." },
        },
        bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 3 },
      },
      get: {
        purpose: "One SKU position.",
        filters: { skuRef: { kind: "opaqueRef", refKind: "resource", required: true, meaning: "SKU ref." } },
        bounds: { kind: "snapshot" },
      },
    },
    result: {
      fields: {
        skuRef: { kind: "opaqueRef", refKind: "resource", meaning: "SKU ref." },
        onHand: { kind: "quantity", meaning: "Units on hand." },
        unitCost: { kind: "money", meaning: "Unit cost.", projection: "costOverlay" },
        stockValue: { kind: "money", meaning: "Stock value.", projection: "costOverlay" },
      },
    },
    projections: {
      costOverlay: { requires: { tier: "member", readIntents: ["inventory.cost_overlay.view"] }, egressClass: "sensitive", meaning: "Unit cost and value." },
    },
    freshness: { classes: ["live"], authority: "live_read", rule: "Live stock position." },
    completeness: { rule: "Page exhaustion determines collection completeness.", sourceKeys: ["positions"] },
    citation: { rule: "Cite SKU snapshot hashes and capture time.", sourceRefKinds: ["sku_snapshot"] },
    evidence: { mode: "extractor", extractorKey: "inventory.positions", extractorVersion: "1", claimShapes: ["onHand"] },
    cost: { worstCasePerCall: PAGE_LIST_COST },
    egressClass: "operational",
    examples: [{ title: "Low stock", verb: "list", args: { stockState: "low" }, description: "Low positions." }],
    binding: { readIntents: ["inventory.stock.view", "inventory.cost_overlay.view"], portKey: "inventory.positions", implementationVersion: "1" },
  }),
  defineCapabilityManifest({
    contractVersion: 1,
    capabilityId: "cap_dailyops_replenishment",
    namespace: { package: "inventory", resource: "replenishment" },
    packageVersion: "1.0.0",
    purpose: "Replenishment recommendations derived from stock and procurement inputs.",
    scope: { kind: "store" },
    lifecycle: "unpublished",
    operations: {
      list: {
        purpose: "Page recommendations.",
        filters: {
          continuityStatus: { kind: "enum", required: false, values: ["at_risk", "stable"], meaning: "Continuity status." },
        },
        bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 2 },
      },
    },
    result: {
      fields: {
        recommendationRef: { kind: "opaqueRef", refKind: "resource", meaning: "Recommendation ref." },
        skuRef: { kind: "opaqueRef", refKind: "resource", meaning: "SKU ref." },
        derivationVersion: { kind: "string", meaning: "Derivation version." },
        inputFreshness: { kind: "enum", values: ["live", "stale"], meaning: "Input freshness." },
        supplierCost: { kind: "money", meaning: "Supplier cost.", projection: "supplierCommercial" },
      },
    },
    projections: {
      supplierCommercial: { requires: { tier: "full_admin" }, egressClass: "sensitive", meaning: "Supplier cost/commitment fields." },
    },
    freshness: { classes: ["derived", "live"], authority: "derived", rule: "Live recommendation; exposes input freshness and derivation version." },
    completeness: { rule: "Page exhaustion plus input coverage.", sourceKeys: ["recommendations", "inputs"] },
    citation: { rule: "Cite recommendation plus constituent opaque refs.", sourceRefKinds: ["replenishment_recommendation", "sku_snapshot"] },
    evidence: { mode: "provenance_only", reason: "Recommendations are re-derived." },
    cost: { worstCasePerCall: PAGE_LIST_COST },
    egressClass: "operational",
    examples: [{ title: "At risk", verb: "list", args: { continuityStatus: "at_risk" }, description: "At-risk SKUs." }],
    binding: { readIntents: ["procurement.view", "inventory.stock.view"], portKey: "inventory.replenishment", implementationVersion: "1" },
  }),
];
