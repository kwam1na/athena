/**
 * `reports.daySales`, `reports.weekPerformance`, `reports.storePulse` — the
 * reporting resources of the Daily Operations package (V26-1267).
 *
 * Authority boundary: declarations only; `salesPorts.ts` implements the reads
 * against the authoritative report record (`reportDay` / `reportSkuDay`), the
 * frozen-versus-live week metric seam, and the store pulse summary.
 *
 * The distinction the whole package turns on is recorded here: a folded day
 * carries a certified fold revision and is `accepted`; an open day is a
 * provisional preview and is `live`. Both are served by the same resource, and
 * the envelope says which one the answer is standing on.
 *
 * Every financial figure sits behind the `financial` projection. Below full
 * admin those fields are structurally ABSENT — never a zero, which is what the
 * operator surface does today and what an agent answer must never repeat.
 */
import { defineCapabilityManifest } from "../../../shared/agentHarness/manifest";
import { defineAgentReadPort, type AgentReadPortIndex } from "../../../shared/agentHarness/readPort";
import type { AgentEvidenceExtractor } from "../../agentHarness/conformance";
import {
  AGENT_SNAPSHOT_COST,
  OPERATING_DATE_FILTER,
  OPERATING_WINDOW_FIELD,
} from "../../lib/agentCapabilityManifests";

export const REPORTS_PACKAGE_VERSION = "1.0.0";
export const DAY_SALES_PORT_KEY = "reports.daySales";
export const WEEK_PERFORMANCE_PORT_KEY = "reports.weekPerformance";
export const STORE_PULSE_PORT_KEY = "reports.storePulse";

/** Top items and payment groups are both capped at 50 by the matrix. */
export const DAY_SALES_TOP_ITEM_LIMIT = 50;

export const DAY_SALES_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_dailyops_day_sales",
  namespace: { package: "reports", resource: "daySales" },
  packageVersion: REPORTS_PACKAGE_VERSION,
  purpose: "One operating day of sales: volume, revenue, payment groups, and the top items behind them.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    get: {
      purpose: "One day summary from the accepted report when folded, otherwise the live operating-day preview.",
      filters: { operatingDate: OPERATING_DATE_FILTER },
      bounds: { kind: "snapshot", maxEmbeddedItems: 110 },
    },
  },
  result: {
    fields: {
      operatingDate: { kind: "operatingDate", meaning: "Operating date this summary describes." },
      operatingWindow: OPERATING_WINDOW_FIELD,
      recordState: {
        kind: "enum",
        values: ["open", "provisional", "reconciled", "amended", "absent"],
        meaning: "State of the underlying daily report record; `open` is a preview, `absent` means no record exists.",
      },
      recordRevision: {
        kind: "string",
        optional: true,
        meaning: "Certified fold revision of the accepted record, when the day has been folded.",
      },
      transactionCount: { kind: "integer", meaning: "Completed transactions settled on the day." },
      unitsSold: { kind: "integer", meaning: "Units sold on the day." },
      unitsReturned: { kind: "integer", meaning: "Units returned on the day." },
      revenue: {
        kind: "money",
        meaning: "Net sales for the day.",
        projection: "financial",
        valueState: true,
      },
      grossRevenue: {
        kind: "money",
        meaning: "Gross sales before refunds.",
        projection: "financial",
        valueState: true,
      },
      refunds: { kind: "money", meaning: "Refunds issued on the day.", projection: "financial", valueState: true },
      grossProfit: {
        kind: "money",
        meaning: "Gross profit, absent when any revenue is uncosted.",
        projection: "financial",
        valueState: true,
      },
      paymentGroups: {
        kind: "array",
        maxItems: 50,
        meaning: "Gross payments by method, present only when the mix reconciles to the day's total.",
        projection: "financial",
        items: {
          kind: "object",
          meaning: "One payment method group.",
          fields: {
            method: { kind: "string", meaning: "Payment method." },
            amount: { kind: "money", meaning: "Gross amount collected through the method." },
            shareBasisPoints: { kind: "integer", meaning: "Share of the day's payments, in basis points." },
            tenderUseCount: { kind: "integer", meaning: "Number of tender uses." },
          },
        },
      },
      topItems: {
        kind: "array",
        maxItems: 50,
        meaning: "Top items by units sold on the day.",
        items: {
          kind: "object",
          meaning: "One item's contribution to the day.",
          fields: {
            skuRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque reference to the SKU." },
            skuCode: { kind: "string", optional: true, meaning: "Business code of the SKU." },
            displayName: { kind: "string", meaning: "Catalogue name of the item." },
            quantity: { kind: "quantity", meaning: "Units sold." },
            value: { kind: "money", meaning: "Net sales attributed to the item.", projection: "financial" },
          },
        },
      },
    },
  },
  projections: {
    financial: {
      requires: { tier: "full_admin" },
      egressClass: "sensitive",
      meaning: "Revenue, refunds, profit, payment groups, and top-item value; omitted entirely below full admin.",
    },
  },
  freshness: {
    classes: ["accepted", "live"],
    authority: "authoritative_record",
    rule: "The folded report record is authoritative after close; before it, the day is an explicitly live preview.",
  },
  completeness: {
    rule: "Each sub-source reports its own coverage; the aggregate is their minimum.",
    sourceKeys: ["report", "topItems", "paymentMix"],
  },
  citation: {
    rule: "Cite the report revision when folded, or the live day snapshot hash otherwise, plus the capture time.",
    sourceRefKinds: ["report_revision", "live_snapshot", "sku_snapshot"],
  },
  evidence: {
    mode: "extractor",
    extractorKey: "reports.daySales",
    extractorVersion: "1",
    claimShapes: ["transactionCount"],
  },
  cost: { worstCasePerCall: AGENT_SNAPSHOT_COST },
  egressClass: "operational",
  examples: [
    {
      title: "Yesterday's sales",
      verb: "get",
      args: { operatingDate: "2026-08-20" },
      description: "The accepted report for a closed day.",
    },
  ],
  binding: {
    readIntents: ["reports.view", "pos.view"],
    portKey: DAY_SALES_PORT_KEY,
    implementationVersion: "1",
  },
});

export const DAY_SALES_EXTRACTOR: AgentEvidenceExtractor = {
  extractorKey: "reports.daySales",
  extractorVersion: "1",
  claimShapes: ["transactionCount"],
  extract: (input) => {
    const data = input.data as
      | { readonly operatingDate?: unknown; readonly transactionCount?: unknown; readonly recordState?: unknown }
      | null;
    if (
      !data ||
      typeof data.operatingDate !== "string" ||
      typeof data.transactionCount !== "number" ||
      typeof data.recordState !== "string"
    ) {
      return { unsupported: "transaction_count_not_present_in_result" };
    }
    return {
      claim: {
        operatingDate: data.operatingDate,
        transactionCount: data.transactionCount,
        recordState: data.recordState,
      },
    };
  },
};

export const WEEK_PERFORMANCE_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_dailyops_week_performance",
  namespace: { package: "reports", resource: "weekPerformance" },
  packageVersion: REPORTS_PACKAGE_VERSION,
  purpose: "Seven operating days of performance ending on a chosen day, plus the prior week's boundary day.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    get: {
      purpose: "Per-day metrics for the week ending at an operating date, each labelled with its own authority.",
      filters: {
        weekEndOperatingDate: {
          kind: "operatingDate",
          required: true,
          meaning: "Last operating date of the week; the server derives the seven-day span through store time.",
        },
      },
      bounds: { kind: "snapshot", maxEmbeddedItems: 40 },
    },
  },
  result: {
    fields: {
      weekEndOperatingDate: { kind: "operatingDate", meaning: "Last operating date of the reported week." },
      weekStartOperatingDate: { kind: "operatingDate", meaning: "First operating date of the reported week." },
      priorBoundaryOperatingDate: {
        kind: "operatingDate",
        meaning: "The prior week's boundary day, for a week-over-week comparison.",
      },
      days: {
        kind: "array",
        maxItems: 8,
        meaning: "One entry per day in the week plus the prior boundary day.",
        items: {
          kind: "object",
          meaning: "One day's metrics and the authority behind them.",
          fields: {
            operatingDate: { kind: "operatingDate", meaning: "The day." },
            authority: {
              kind: "enum",
              values: ["accepted", "live"],
              meaning: "`accepted` when the day is closed and frozen; `live` when it is still being read.",
            },
            isPriorBoundary: { kind: "boolean", meaning: "True for the prior week's comparison day." },
            transactionCount: { kind: "integer", meaning: "Completed transactions on the day." },
            revenue: { kind: "money", meaning: "Sales total for the day.", projection: "financial", valueState: true },
            expenses: {
              kind: "money",
              meaning: "Expense total for the day.",
              projection: "financial",
              valueState: true,
            },
            cashTaken: {
              kind: "money",
              meaning: "Cash collected on the day.",
              projection: "financial",
              valueState: true,
            },
          },
        },
      },
    },
  },
  projections: {
    financial: {
      requires: { tier: "full_admin" },
      egressClass: "sensitive",
      meaning: "Every financial metric in the week view; omitted entirely below full admin.",
    },
  },
  freshness: {
    classes: ["accepted", "live"],
    authority: "authoritative_record",
    rule: "Per-day frozen close metrics where the day is closed; explicitly live otherwise.",
  },
  completeness: {
    rule: "Lists the days that could not be read; the aggregate is partial whenever any day is missing.",
    sourceKeys: ["days"],
  },
  citation: { rule: "Cite each day's close revision or live read.", sourceRefKinds: ["report_revision", "live_snapshot"] },
  evidence: { mode: "provenance_only", reason: "A week figure is a derivation across days, not a single record." },
  cost: { worstCasePerCall: AGENT_SNAPSHOT_COST },
  egressClass: "operational",
  examples: [
    {
      title: "This week so far",
      verb: "get",
      args: { weekEndOperatingDate: "2026-08-22" },
      description: "Seven days ending Saturday plus the prior boundary day.",
    },
  ],
  binding: {
    readIntents: ["reports.view"],
    portKey: WEEK_PERFORMANCE_PORT_KEY,
    implementationVersion: "1",
  },
});

export const STORE_PULSE_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_dailyops_store_pulse",
  namespace: { package: "reports", resource: "storePulse" },
  packageVersion: REPORTS_PACKAGE_VERSION,
  purpose: "A bounded trading pulse for today or the current week, with its own comparison window.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    get: {
      purpose: "One bounded pulse summary over a named window.",
      filters: {
        operatingDate: OPERATING_DATE_FILTER,
        window: {
          kind: "enum",
          required: true,
          values: ["today", "week"],
          meaning: "Summary window, anchored on the operating date.",
        },
      },
      bounds: { kind: "snapshot", maxEmbeddedItems: 40 },
    },
  },
  result: {
    fields: {
      operatingDate: { kind: "operatingDate", meaning: "Operating date the window is anchored on." },
      operatingWindow: OPERATING_WINDOW_FIELD,
      window: { kind: "enum", values: ["today", "week"], meaning: "Window the pulse covers." },
      transactionCount: { kind: "integer", meaning: "Completed transactions in the window." },
      itemsSold: { kind: "integer", meaning: "Units sold in the window." },
      historyDayCount: { kind: "integer", meaning: "Days of history the trend is based on." },
      isLimitedHistory: { kind: "boolean", meaning: "True when there is too little history for a stable trend." },
      revenue: { kind: "money", meaning: "Sales in the window.", projection: "financial", valueState: true },
      averageTransaction: {
        kind: "money",
        meaning: "Average basket value in the window.",
        projection: "financial",
        valueState: true,
      },
      revenueChangeBasisPoints: {
        kind: "integer",
        meaning: "Change against the comparison window, in basis points.",
        projection: "financial",
      },
      busiestHour: {
        kind: "object",
        optional: true,
        meaning: "Busiest trading hour in the window.",
        fields: {
          hour: { kind: "integer", meaning: "Hour of the day, store local." },
          transactionCount: { kind: "integer", meaning: "Transactions in that hour." },
          revenue: { kind: "money", meaning: "Sales in that hour.", projection: "financial" },
        },
      },
      topItems: {
        kind: "array",
        maxItems: 10,
        meaning: "Best-selling items in the window.",
        items: {
          kind: "object",
          meaning: "One item's contribution to the window.",
          fields: {
            displayName: { kind: "string", meaning: "Catalogue name of the item." },
            skuCode: { kind: "string", optional: true, meaning: "Business code of the SKU." },
            quantity: { kind: "quantity", meaning: "Units sold." },
            value: { kind: "money", meaning: "Sales attributed to the item.", projection: "financial" },
          },
        },
      },
    },
  },
  projections: {
    financial: {
      requires: { tier: "full_admin" },
      egressClass: "sensitive",
      meaning: "Every financial pulse figure; omitted entirely below full admin.",
    },
  },
  freshness: {
    classes: ["derived", "live", "accepted"],
    authority: "derived",
    rule: "A derivation over mixed-time sources, each individually timestamped by its own read.",
  },
  completeness: {
    rule: "The aggregate is the minimum completeness of the contributing summaries.",
    sourceKeys: ["sales", "comparison", "items"],
  },
  citation: {
    rule: "Cite each constituent summary source and its capture time.",
    sourceRefKinds: ["summary_source"],
  },
  evidence: { mode: "provenance_only", reason: "The pulse is a derivation; the constituent sources are the evidence." },
  cost: { worstCasePerCall: AGENT_SNAPSHOT_COST },
  egressClass: "operational",
  examples: [
    {
      title: "How is today trading?",
      verb: "get",
      args: { operatingDate: "2026-08-21", window: "today" },
      description: "Today's pulse against yesterday.",
    },
  ],
  binding: {
    readIntents: ["reports.view"],
    portKey: STORE_PULSE_PORT_KEY,
    implementationVersion: "1",
  },
});

export const REPORTS_MANIFESTS = [
  DAY_SALES_MANIFEST,
  WEEK_PERFORMANCE_MANIFEST,
  STORE_PULSE_MANIFEST,
] as const;

export const REPORTS_READ_PORTS: AgentReadPortIndex = {
  contractVersion: 1,
  ports: [
    defineAgentReadPort({
      contractVersion: 1,
      portKey: DAY_SALES_PORT_KEY,
      capabilityId: DAY_SALES_MANIFEST.capabilityId,
      verbs: ["get"],
      scopeKind: "store",
      readIntents: DAY_SALES_MANIFEST.binding.readIntents,
      implementationVersion: "1",
      declaredCost: AGENT_SNAPSHOT_COST,
      handler: { kind: "internal_query", functionPath: "reports/agentCapabilities/salesPorts:getDaySales" },
      projections: ["financial"],
      completenessSourceKeys: ["report", "topItems", "paymentMix"],
    }),
    defineAgentReadPort({
      contractVersion: 1,
      portKey: WEEK_PERFORMANCE_PORT_KEY,
      capabilityId: WEEK_PERFORMANCE_MANIFEST.capabilityId,
      verbs: ["get"],
      scopeKind: "store",
      readIntents: WEEK_PERFORMANCE_MANIFEST.binding.readIntents,
      implementationVersion: "1",
      declaredCost: AGENT_SNAPSHOT_COST,
      handler: { kind: "internal_query", functionPath: "reports/agentCapabilities/salesPorts:getWeekPerformance" },
      projections: ["financial"],
      completenessSourceKeys: ["days"],
    }),
    defineAgentReadPort({
      contractVersion: 1,
      portKey: STORE_PULSE_PORT_KEY,
      capabilityId: STORE_PULSE_MANIFEST.capabilityId,
      verbs: ["get"],
      scopeKind: "store",
      readIntents: STORE_PULSE_MANIFEST.binding.readIntents,
      implementationVersion: "1",
      declaredCost: AGENT_SNAPSHOT_COST,
      handler: { kind: "internal_query", functionPath: "reports/agentCapabilities/salesPorts:getStorePulse" },
      projections: ["financial"],
      completenessSourceKeys: ["sales", "comparison", "items"],
    }),
  ],
};
