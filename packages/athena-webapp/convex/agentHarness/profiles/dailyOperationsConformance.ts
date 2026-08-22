/**
 * Conformance fixtures for the Daily Operations package (V26-1267).
 *
 * Every published capability ships probes next to its profile: at least one
 * in-scope observation per declared verb, one foreign-scope observation that
 * must return nothing, and — where the manifest declares extractor evidence —
 * the deterministic extractor itself. `bun run agent-sdk:generate` refuses to
 * publish an `enabled` capability whose probes do not pass
 * `runCapabilityConformance`, so these fixtures are the executable statement of
 * what each read port must return.
 *
 * They are hand-authored on purpose: the gate runs at build time, with no
 * database. The port tests assert the live ports produce the same shapes.
 */
import { budgetVector, type BudgetVector } from "../../../shared/agentHarness/execution";
import type { AgentReadEnvelope, AgentSourceCompleteness } from "../../../shared/agentHarness/results";
import { known, unknown } from "../../../shared/agentHarness/results";
import { opaqueRef, type AgentReadVerb } from "../../../shared/agentHarness/values";
import type { AgentConformanceProbe, AgentEvidenceExtractor } from "../conformance";
import {
  AGENT_PAGE_COST,
  AGENT_SMALL_PAGE_COST,
  AGENT_SNAPSHOT_COST,
} from "../../lib/agentCapabilityManifests";
import { AUTOMATION_MANIFEST } from "../../automation/agentCapabilities/evidence";
import {
  REGISTER_SESSIONS_EXTRACTOR,
  REGISTER_SESSIONS_MANIFEST,
} from "../../cashControls/agentCapabilities/registers";
import { ACTIVITY_MANIFEST } from "../../operations/agentCapabilities/activity";
import { STORE_DAY_EXTRACTOR, STORE_DAY_MANIFEST } from "../../operations/agentCapabilities/storeDay";
import { APPROVALS_MANIFEST, ATTENTION_MANIFEST } from "../../operations/agentCapabilities/work";
import {
  DAY_SALES_EXTRACTOR,
  DAY_SALES_MANIFEST,
  STORE_PULSE_MANIFEST,
  WEEK_PERFORMANCE_MANIFEST,
} from "../../reports/agentCapabilities/sales";
import { POSITIONS_EXTRACTOR, POSITIONS_MANIFEST, REPLENISHMENT_MANIFEST } from "../../stockOps/agentCapabilities/inventory";

const OBSERVED_AT = 1_755_000_000_000;
const HOME_SCOPE = "store:store-home";
const FOREIGN_SCOPE = "store:store-other";
const OPERATING_DATE = "2026-08-21";
const CURRENCY = "GHS";

const money = (amount: number) => ({ amount, currency: CURRENCY });
const quantity = (value: number) => ({ value, unit: "unit" });
const WINDOW = { derivation: "schedule", timezone: "Africa/Accra" } as const;

const complete = (sourceKeys: readonly string[]): AgentSourceCompleteness[] =>
  sourceKeys.map((sourceKey) => ({ sourceKey, status: "complete", capturedAt: OBSERVED_AT }));

const unavailableSources = (
  sourceKeys: readonly string[],
  unavailable: { readonly [key: string]: string },
): AgentSourceCompleteness[] =>
  sourceKeys.map((sourceKey) =>
    unavailable[sourceKey]
      ? { sourceKey, status: "unavailable", reason: unavailable[sourceKey], capturedAt: OBSERVED_AT }
      : { sourceKey, status: "complete", capturedAt: OBSERVED_AT },
  );

function envelope(input: {
  capabilityId: string;
  namespace: string;
  verb: AgentReadVerb;
  data: unknown;
  freshnessClass: "live" | "accepted" | "derived" | "stale";
  authority: "live_read" | "authoritative_record" | "derived";
  sources: readonly AgentSourceCompleteness[];
  sourceRefKind: string;
  refCount?: number;
  pageSize?: number;
}): AgentReadEnvelope<unknown> {
  const allComplete = input.sources.length > 0 && input.sources.every((source) => source.status === "complete");
  const refCount = input.refCount ?? 1;
  const base = {
    contractVersion: 1 as const,
    capabilityId: input.capabilityId,
    namespace: input.namespace,
    verb: input.verb,
    data: input.data,
    observedAt: OBSERVED_AT,
    capturedAt: OBSERVED_AT,
    freshness: {
      class: input.freshnessClass,
      authority: input.authority,
      observedAt: OBSERVED_AT,
      capturedAt: OBSERVED_AT,
    },
    completeness: { status: allComplete ? ("complete" as const) : ("partial" as const), sources: input.sources },
    warnings: [],
    sourceRefs: Array.from({ length: refCount }, (_, index) => ({
      ref: opaqueRef("source", `${input.sourceRefKind}.probe-${index}`),
      kind: input.sourceRefKind,
      capturedAt: OBSERVED_AT,
    })),
  };
  if (input.verb === "get") return { ...base, verb: "get", pagination: undefined } as AgentReadEnvelope<unknown>;
  return {
    ...base,
    verb: "list",
    pagination: {
      hasMore: false,
      pageIndex: 0,
      pageSize: input.pageSize ?? (Array.isArray(input.data) ? input.data.length : 0),
      pagesRemainingInRun: 1,
    },
  } as AgentReadEnvelope<unknown>;
}

const budget = (declared: BudgetVector, settled: Partial<BudgetVector>) => ({
  requested: declared,
  settled: budgetVector({ calls: 1, ...settled }),
});

const PAGE_BUDGET = budget(AGENT_PAGE_COST, { rows: 2, bytes: 2_048, costUnits: 1, elapsedMs: 40 });
const SMALL_PAGE_BUDGET = budget(AGENT_SMALL_PAGE_COST, { rows: 2, bytes: 2_048, costUnits: 1, elapsedMs: 40 });
const SNAPSHOT_BUDGET = budget(AGENT_SNAPSHOT_COST, { rows: 1, bytes: 4_096, costUnits: 1, elapsedMs: 60 });

// ---------------------------------------------------------------------------
// operations.storeDay
// ---------------------------------------------------------------------------

const STORE_DAY_BASE = {
  operatingDate: OPERATING_DATE,
  operatingWindow: WINDOW,
  lifecycleStage: "close_blocked",
  lifecycleSummary: "One register is still open and an approval is pending.",
  openingStatus: "started",
  openingReadiness: { blockerCount: 0, reviewCount: 1, carryForwardCount: 1, readyCount: 3 },
  closeStatus: "not_started",
  closeReadiness: { blockerCount: 0, reviewCount: 0, carryForwardCount: 0, readyCount: 0 },
  attentionCount: 2,
  openWorkItemCount: 1,
  pendingApprovalCount: 1,
  registerBlockerCount: 1,
  transactionCount: 2,
  openingRecordRef: opaqueRef("source", "store_day_record.probe-opening"),
};

const storeDayEnvelope = (data: unknown, sources = complete(STORE_DAY_MANIFEST.completeness.sourceKeys)) =>
  envelope({
    capabilityId: STORE_DAY_MANIFEST.capabilityId,
    namespace: "operations.storeDay",
    verb: "get",
    data,
    freshnessClass: "live",
    authority: "authoritative_record",
    sources,
    sourceRefKind: "store_day_record",
  });

const storeDayProbes: readonly AgentConformanceProbe[] = [
  {
    label: "current store day without manager review evidence",
    verb: "get",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: storeDayEnvelope(STORE_DAY_BASE),
    repeat: storeDayEnvelope(STORE_DAY_BASE),
    budget: SNAPSHOT_BUDGET,
  },
  {
    label: "current store day with manager review evidence granted",
    verb: "get",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["managerReview"],
    envelope: storeDayEnvelope({
      ...STORE_DAY_BASE,
      managerReviewEvidence: [
        {
          key: "carry-forward-1",
          severity: "carry_forward",
          title: "Carry forward",
          message: "Drawer count review carried into today.",
        },
      ],
    }),
    budget: SNAPSHOT_BUDGET,
  },
  {
    label: "another store's day is invisible",
    verb: "get",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: storeDayEnvelope([], complete(STORE_DAY_MANIFEST.completeness.sourceKeys)),
    budget: SNAPSHOT_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// operations.attention
// ---------------------------------------------------------------------------

const ATTENTION_ROWS = [
  {
    itemRef: opaqueRef("resource", "attention_item.probe-approval"),
    operatingDate: OPERATING_DATE,
    operatingWindow: WINDOW,
    lane: "operations_queue",
    status: "blocking",
    title: "Drawer short by 5.00",
    subjectKind: "approval_request",
    subjectLabel: "Drawer short by 5.00",
  },
  {
    itemRef: opaqueRef("resource", "attention_item.probe-opening"),
    operatingDate: OPERATING_DATE,
    operatingWindow: WINDOW,
    lane: "daily_opening",
    status: "review",
    title: "Carry forward review",
    subjectKind: "operational_work_item",
  },
];

const attentionEnvelope = (data: unknown) =>
  envelope({
    capabilityId: ATTENTION_MANIFEST.capabilityId,
    namespace: "operations.attention",
    verb: "list",
    data,
    freshnessClass: "live",
    authority: "live_read",
    sources: complete(ATTENTION_MANIFEST.completeness.sourceKeys),
    sourceRefKind: "work_item",
    refCount: Array.isArray(data) ? data.length : 0,
  });

const attentionProbes: readonly AgentConformanceProbe[] = [
  {
    label: "attention queue without manager reasons",
    verb: "list",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: attentionEnvelope(ATTENTION_ROWS),
    repeat: attentionEnvelope(ATTENTION_ROWS),
    budget: PAGE_BUDGET,
  },
  {
    label: "attention queue with manager reasons granted",
    verb: "list",
    args: { operatingDate: OPERATING_DATE, status: "blocking" },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["managerReasons"],
    envelope: attentionEnvelope([
      { ...ATTENTION_ROWS[0], managerReason: "Resolve the pending approval in Operations." },
    ]),
    budget: PAGE_BUDGET,
  },
  {
    label: "another store's attention queue is invisible",
    verb: "list",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: attentionEnvelope([]),
    budget: PAGE_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// operations.approvals
// ---------------------------------------------------------------------------

const APPROVAL_ROW = {
  requestRef: opaqueRef("resource", "approval_request.probe-1"),
  operatingDate: OPERATING_DATE,
  requestKind: "variance_review",
  subjectKind: "register_session",
  state: "pending",
  stateVersion: "pending@1755000000000",
  raisedAt: OBSERVED_AT,
  reason: "Drawer short by 5.00",
};

const approvalsEnvelope = (data: unknown) =>
  envelope({
    capabilityId: APPROVALS_MANIFEST.capabilityId,
    namespace: "operations.approvals",
    verb: "list",
    data,
    freshnessClass: "live",
    authority: "live_read",
    sources: complete(APPROVALS_MANIFEST.completeness.sourceKeys),
    sourceRefKind: "approval_request",
    refCount: Array.isArray(data) ? data.length : 0,
  });

const approvalsProbes: readonly AgentConformanceProbe[] = [
  {
    label: "pending approvals without approval proof",
    verb: "list",
    args: { operatingDate: OPERATING_DATE, state: "pending" },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: approvalsEnvelope([APPROVAL_ROW]),
    repeat: approvalsEnvelope([APPROVAL_ROW]),
    budget: PAGE_BUDGET,
  },
  {
    label: "pending approvals with approval proof granted",
    verb: "list",
    args: { operatingDate: OPERATING_DATE, state: "pending" },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["approvalProof"],
    envelope: approvalsEnvelope([
      { ...APPROVAL_ROW, approvalProof: "No reviewer is recorded yet. No approval proof is attached." },
    ]),
    budget: PAGE_BUDGET,
  },
  {
    label: "another store's approvals are invisible",
    verb: "list",
    args: { operatingDate: OPERATING_DATE, state: "pending" },
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: approvalsEnvelope([]),
    budget: PAGE_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// operations.activity
// ---------------------------------------------------------------------------

const ACTIVITY_ROW = {
  eventRef: opaqueRef("resource", "timeline_event.probe-1"),
  operatingDate: OPERATING_DATE,
  operatingWindow: WINDOW,
  occurredAt: OBSERVED_AT,
  family: "operational_event",
  eventKind: "register_session_closed",
  summary: "Register 2 closed with a variance of 5.00",
  subjectKind: "register_session",
  subjectLabel: "Register 2",
};

const activityEnvelope = (data: unknown) =>
  envelope({
    capabilityId: ACTIVITY_MANIFEST.capabilityId,
    namespace: "operations.activity",
    verb: "list",
    data,
    freshnessClass: "live",
    authority: "live_read",
    sources: complete(ACTIVITY_MANIFEST.completeness.sourceKeys),
    sourceRefKind: "timeline_event",
    refCount: Array.isArray(data) ? data.length : 0,
  });

const activityProbes: readonly AgentConformanceProbe[] = [
  {
    label: "activity without financial detail",
    verb: "list",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: activityEnvelope([ACTIVITY_ROW]),
    repeat: activityEnvelope([ACTIVITY_ROW]),
    budget: PAGE_BUDGET,
  },
  {
    label: "activity with financial detail granted",
    verb: "list",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["financialEvents"],
    envelope: activityEnvelope([
      { ...ACTIVITY_ROW, financialDetail: "Register 2 closed with a variance of 5.00 Related records: a register session." },
    ]),
    budget: PAGE_BUDGET,
  },
  {
    label: "another store's activity is invisible",
    verb: "list",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: activityEnvelope([]),
    budget: PAGE_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// reports.daySales
// ---------------------------------------------------------------------------

const DAY_SALES_BASE = {
  operatingDate: "2026-08-20",
  operatingWindow: WINDOW,
  recordState: "reconciled",
  recordRevision: "7",
  transactionCount: 1,
  unitsSold: 1,
  unitsReturned: 0,
  topItems: [
    {
      skuRef: opaqueRef("resource", "product_sku.probe-1"),
      skuCode: "BD-12",
      displayName: "Bundle deal 12in",
      quantity: quantity(1),
    },
  ],
};

const daySalesEnvelope = (data: unknown, sources = complete(DAY_SALES_MANIFEST.completeness.sourceKeys)) =>
  envelope({
    capabilityId: DAY_SALES_MANIFEST.capabilityId,
    namespace: "reports.daySales",
    verb: "get",
    data,
    freshnessClass: "accepted",
    authority: "authoritative_record",
    sources,
    sourceRefKind: "report_revision",
  });

const daySalesProbes: readonly AgentConformanceProbe[] = [
  {
    label: "accepted day without financial fields",
    verb: "get",
    args: { operatingDate: "2026-08-20" },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: daySalesEnvelope(DAY_SALES_BASE),
    repeat: daySalesEnvelope(DAY_SALES_BASE),
    budget: SNAPSHOT_BUDGET,
  },
  {
    label: "accepted day with financial fields granted",
    verb: "get",
    args: { operatingDate: "2026-08-20" },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["financial"],
    envelope: daySalesEnvelope({
      ...DAY_SALES_BASE,
      revenue: known(money(30_000)),
      grossRevenue: known(money(30_000)),
      refunds: known(money(0)),
      grossProfit: known(money(8_000)),
      paymentGroups: [
        { method: "cash", amount: money(30_000), shareBasisPoints: 10_000, tenderUseCount: 1 },
      ],
      topItems: [{ ...DAY_SALES_BASE.topItems[0], value: money(30_000) }],
    }),
    budget: SNAPSHOT_BUDGET,
  },
  {
    label: "a day with no report record reports every source honestly",
    verb: "get",
    args: { operatingDate: "2026-01-01" },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["financial"],
    envelope: envelope({
      capabilityId: DAY_SALES_MANIFEST.capabilityId,
      namespace: "reports.daySales",
      verb: "get",
      data: {
        operatingDate: "2026-01-01",
        operatingWindow: WINDOW,
        recordState: "absent",
        transactionCount: 0,
        unitsSold: 0,
        unitsReturned: 0,
        revenue: unknown("not_recorded"),
        grossRevenue: unknown("not_recorded"),
        refunds: unknown("not_recorded"),
        grossProfit: unknown("not_recorded"),
        paymentGroups: [],
        topItems: [],
      },
      freshnessClass: "live",
      authority: "authoritative_record",
      sources: unavailableSources(DAY_SALES_MANIFEST.completeness.sourceKeys, {
        report: "no_report_record_for_day",
        topItems: "no_report_record_for_day",
        paymentMix: "payment_mix_does_not_reconcile",
      }),
      sourceRefKind: "live_snapshot",
    }),
    budget: SNAPSHOT_BUDGET,
  },
  {
    label: "another store's day is invisible",
    verb: "get",
    args: { operatingDate: "2026-08-20" },
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: daySalesEnvelope([]),
    budget: SNAPSHOT_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// reports.weekPerformance
// ---------------------------------------------------------------------------

const weekDay = (operatingDate: string, authority: "accepted" | "live", isPriorBoundary = false) => ({
  operatingDate,
  authority,
  isPriorBoundary,
  transactionCount: authority === "accepted" ? 1 : 2,
});

const WEEK_DAYS = [
  weekDay("2026-08-16", "accepted"),
  weekDay("2026-08-17", "accepted"),
  weekDay("2026-08-18", "accepted"),
  weekDay("2026-08-19", "accepted"),
  weekDay("2026-08-20", "accepted"),
  weekDay("2026-08-21", "live"),
  weekDay("2026-08-22", "live"),
  weekDay("2026-08-15", "accepted", true),
];

const weekEnvelope = (data: unknown) =>
  envelope({
    capabilityId: WEEK_PERFORMANCE_MANIFEST.capabilityId,
    namespace: "reports.weekPerformance",
    verb: "get",
    data,
    freshnessClass: "accepted",
    authority: "authoritative_record",
    sources: complete(WEEK_PERFORMANCE_MANIFEST.completeness.sourceKeys),
    sourceRefKind: "report_revision",
  });

const WEEK_BASE = {
  weekEndOperatingDate: "2026-08-22",
  weekStartOperatingDate: "2026-08-16",
  priorBoundaryOperatingDate: "2026-08-15",
};

const weekProbes: readonly AgentConformanceProbe[] = [
  {
    label: "week without financial metrics",
    verb: "get",
    args: { weekEndOperatingDate: "2026-08-22" },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: weekEnvelope({ ...WEEK_BASE, days: WEEK_DAYS }),
    repeat: weekEnvelope({ ...WEEK_BASE, days: WEEK_DAYS }),
    budget: SNAPSHOT_BUDGET,
  },
  {
    label: "week with financial metrics granted",
    verb: "get",
    args: { weekEndOperatingDate: "2026-08-22" },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["financial"],
    envelope: weekEnvelope({
      ...WEEK_BASE,
      days: WEEK_DAYS.map((day) => ({
        ...day,
        revenue: known(money(30_000)),
        expenses: known(money(0)),
        cashTaken: known(money(30_000)),
      })),
    }),
    budget: SNAPSHOT_BUDGET,
  },
  {
    label: "another store's week is invisible",
    verb: "get",
    args: { weekEndOperatingDate: "2026-08-22" },
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: weekEnvelope([]),
    budget: SNAPSHOT_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// reports.storePulse
// ---------------------------------------------------------------------------

const PULSE_BASE = {
  operatingDate: OPERATING_DATE,
  operatingWindow: WINDOW,
  window: "today",
  transactionCount: 2,
  itemsSold: 2,
  historyDayCount: 2,
  isLimitedHistory: true,
  topItems: [
    { displayName: "Bundle deal 12in", skuCode: "BD-12", quantity: quantity(1) },
  ],
};

const pulseEnvelope = (data: unknown, sources = complete(STORE_PULSE_MANIFEST.completeness.sourceKeys)) =>
  envelope({
    capabilityId: STORE_PULSE_MANIFEST.capabilityId,
    namespace: "reports.storePulse",
    verb: "get",
    data,
    freshnessClass: "derived",
    authority: "derived",
    sources,
    sourceRefKind: "summary_source",
  });

const pulseProbes: readonly AgentConformanceProbe[] = [
  {
    label: "pulse without financial figures",
    verb: "get",
    args: { operatingDate: OPERATING_DATE, window: "today" },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: pulseEnvelope(PULSE_BASE),
    repeat: pulseEnvelope(PULSE_BASE),
    budget: SNAPSHOT_BUDGET,
  },
  {
    label: "pulse with financial figures granted, comparison window empty",
    verb: "get",
    args: { operatingDate: OPERATING_DATE, window: "today" },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["financial"],
    envelope: pulseEnvelope(
      {
        ...PULSE_BASE,
        revenue: known(money(95_000)),
        averageTransaction: known(money(47_500)),
        revenueChangeBasisPoints: 0,
        busiestHour: { hour: 10, transactionCount: 1, revenue: money(40_000) },
        topItems: [{ ...PULSE_BASE.topItems[0], value: money(40_000) }],
      },
      unavailableSources(STORE_PULSE_MANIFEST.completeness.sourceKeys, {
        comparison: "no_comparison_window_activity",
      }),
    ),
    budget: SNAPSHOT_BUDGET,
  },
  {
    label: "another store's pulse is invisible",
    verb: "get",
    args: { operatingDate: OPERATING_DATE, window: "today" },
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: pulseEnvelope([]),
    budget: SNAPSHOT_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// cash.registerSessions
// ---------------------------------------------------------------------------

const SESSION_BASE = {
  sessionRef: opaqueRef("resource", "register_session.probe-1"),
  registerLabel: "Register 2",
  status: "closed",
  openedOperatingDate: OPERATING_DATE,
  closeoutOperatingDate: OPERATING_DATE,
  operatingWindow: WINDOW,
  openedAt: OBSERVED_AT,
  closedAt: OBSERVED_AT,
  hasPendingApproval: false,
  closeoutEventCount: 1,
  closeoutVersion: "closed@1755000000000#1",
};

const SESSION_CASH = {
  openingFloat: known(money(20_000)),
  expectedCash: known(money(45_000)),
  countedCash: known(money(44_500)),
  variance: known(money(-500)),
  closeoutHistory: [
    {
      kind: "closed",
      occurredAt: OBSERVED_AT,
      expectedCash: money(45_000),
      countedCash: money(44_500),
      variance: money(-500),
    },
  ],
};

const sessionsEnvelope = (verb: AgentReadVerb, data: unknown) =>
  envelope({
    capabilityId: REGISTER_SESSIONS_MANIFEST.capabilityId,
    namespace: "cash.registerSessions",
    verb,
    data,
    freshnessClass: "live",
    authority: "live_read",
    sources: complete(REGISTER_SESSIONS_MANIFEST.completeness.sourceKeys),
    sourceRefKind: "register_session",
    refCount: Array.isArray(data) ? data.length : 1,
  });

const sessionProbes: readonly AgentConformanceProbe[] = [
  {
    label: "sessions listed without cash figures",
    verb: "list",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: sessionsEnvelope("list", [SESSION_BASE]),
    repeat: sessionsEnvelope("list", [SESSION_BASE]),
    budget: PAGE_BUDGET,
  },
  {
    label: "sessions listed with cash figures granted",
    verb: "list",
    args: { operatingDate: OPERATING_DATE, status: "closed" },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["cashFinancials"],
    envelope: sessionsEnvelope("list", [{ ...SESSION_BASE, ...SESSION_CASH }]),
    budget: PAGE_BUDGET,
  },
  {
    label: "one session snapshot without cash figures",
    verb: "get",
    args: { sessionRef: opaqueRef("resource", "register_session.probe-1") },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: sessionsEnvelope("get", SESSION_BASE),
    repeat: sessionsEnvelope("get", SESSION_BASE),
    budget: PAGE_BUDGET,
  },
  {
    label: "another store's sessions are invisible",
    verb: "list",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: sessionsEnvelope("list", []),
    budget: PAGE_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// automation.dailyOperations
// ---------------------------------------------------------------------------

const AUTOMATION_ROW = {
  runRef: opaqueRef("source", "automation_run.probe-1"),
  operatingDate: OPERATING_DATE,
  operatingWindow: WINDOW,
  action: "opening.auto_start",
  lane: "opening",
  outcome: "applied",
  disposition: "action_taken",
  policyMode: "enabled",
  policyVersion: "opening.v3",
  idempotencyToken: "opening-2026-08-21",
  occurredAt: OBSERVED_AT,
};

const automationEnvelope = (data: unknown, sources = complete(AUTOMATION_MANIFEST.completeness.sourceKeys)) =>
  envelope({
    capabilityId: AUTOMATION_MANIFEST.capabilityId,
    namespace: "automation.dailyOperations",
    verb: "list",
    data,
    freshnessClass: "live",
    authority: "live_read",
    sources,
    sourceRefKind: "automation_run",
    refCount: Array.isArray(data) ? data.length : 0,
  });

const automationProbes: readonly AgentConformanceProbe[] = [
  {
    label: "automation runs without policy detail, one scheduled window missing",
    verb: "list",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: automationEnvelope(
      [AUTOMATION_ROW],
      [
        { sourceKey: "runs", status: "complete", capturedAt: OBSERVED_AT },
        {
          sourceKey: "scheduledWindows",
          status: "partial",
          reason: "no_run_recorded_for_scheduled_window",
          missing: ["eod.auto_complete"],
          capturedAt: OBSERVED_AT,
        },
      ],
    ),
    repeat: automationEnvelope(
      [AUTOMATION_ROW],
      [
        { sourceKey: "runs", status: "complete", capturedAt: OBSERVED_AT },
        {
          sourceKey: "scheduledWindows",
          status: "partial",
          reason: "no_run_recorded_for_scheduled_window",
          missing: ["eod.auto_complete"],
          capturedAt: OBSERVED_AT,
        },
      ],
    ),
    budget: SMALL_PAGE_BUDGET,
  },
  {
    label: "automation runs with policy detail granted",
    verb: "list",
    args: { operatingDate: OPERATING_DATE, action: "opening.auto_start" },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["policyDetails"],
    envelope: automationEnvelope([
      {
        ...AUTOMATION_ROW,
        policyEvidence: {
          kind: "opening_gate",
          eligible: true,
          gates: [{ key: "blockers", passed: true }],
        },
      },
    ]),
    budget: SMALL_PAGE_BUDGET,
  },
  {
    label: "another store's automation ledger is invisible",
    verb: "list",
    args: { operatingDate: OPERATING_DATE },
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: automationEnvelope([]),
    budget: SMALL_PAGE_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// inventory.positions
// ---------------------------------------------------------------------------

const POSITION_BASE = {
  skuRef: opaqueRef("resource", "product_sku.probe-1"),
  skuCode: "BD-12",
  displayName: "Bundle deal 12in",
  category: "Hair",
  subcategory: "Wigs",
  onHand: quantity(1),
  available: quantity(1),
  reserved: quantity(0),
  stockState: "low",
};

const POSITION_COST = {
  unitCost: known(money(22_000)),
  stockValue: known(money(22_000)),
};

const positionsEnvelope = (verb: AgentReadVerb, data: unknown) =>
  envelope({
    capabilityId: POSITIONS_MANIFEST.capabilityId,
    namespace: "inventory.positions",
    verb,
    data,
    freshnessClass: "live",
    authority: "live_read",
    sources: complete(POSITIONS_MANIFEST.completeness.sourceKeys),
    sourceRefKind: "sku_snapshot",
    refCount: Array.isArray(data) ? data.length : 1,
  });

const positionProbes: readonly AgentConformanceProbe[] = [
  {
    label: "positions without the cost overlay",
    verb: "list",
    args: { stockState: "low" },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: positionsEnvelope("list", [POSITION_BASE]),
    repeat: positionsEnvelope("list", [POSITION_BASE]),
    budget: PAGE_BUDGET,
  },
  {
    label: "positions with the cost overlay escalation granted",
    verb: "list",
    args: { stockState: "low" },
    scopeRef: HOME_SCOPE,
    grantedProjections: ["costOverlay"],
    envelope: positionsEnvelope("list", [{ ...POSITION_BASE, ...POSITION_COST }]),
    budget: PAGE_BUDGET,
  },
  {
    label: "one SKU position without the cost overlay",
    verb: "get",
    args: { skuRef: opaqueRef("resource", "product_sku.probe-1") },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: positionsEnvelope("get", POSITION_BASE),
    repeat: positionsEnvelope("get", POSITION_BASE),
    budget: PAGE_BUDGET,
  },
  {
    label: "another store's positions are invisible",
    verb: "list",
    args: {},
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: positionsEnvelope("list", []),
    budget: PAGE_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// inventory.replenishment
// ---------------------------------------------------------------------------

const REPLENISHMENT_ROW = {
  recommendationRef: opaqueRef("resource", "replenishment_recommendation.probe-1"),
  skuRef: opaqueRef("resource", "product_sku.probe-1"),
  skuCode: "BD-12",
  displayName: "Bundle deal 12in",
  continuityStatus: "exposed",
  needsAction: true,
  onHand: quantity(1),
  available: quantity(1),
  suggestedOrderQuantity: quantity(9),
  inboundQuantity: quantity(0),
  plannedQuantity: quantity(0),
  guidance: "No cover on order. Raise a purchase order for 9 units.",
  derivationVersion: "replenishment.v1",
  inputFreshness: "live",
};

const replenishmentEnvelope = (data: unknown) =>
  envelope({
    capabilityId: REPLENISHMENT_MANIFEST.capabilityId,
    namespace: "inventory.replenishment",
    verb: "list",
    data,
    freshnessClass: "derived",
    authority: "derived",
    sources: complete(REPLENISHMENT_MANIFEST.completeness.sourceKeys),
    sourceRefKind: "replenishment_recommendation",
    refCount: Array.isArray(data) ? data.length : 0,
  });

const replenishmentProbes: readonly AgentConformanceProbe[] = [
  {
    label: "recommendations without supplier commercial detail",
    verb: "list",
    args: { continuityStatus: "exposed" },
    scopeRef: HOME_SCOPE,
    grantedProjections: [],
    envelope: replenishmentEnvelope([REPLENISHMENT_ROW]),
    repeat: replenishmentEnvelope([REPLENISHMENT_ROW]),
    budget: PAGE_BUDGET,
  },
  {
    label: "recommendations with supplier commercial detail granted",
    verb: "list",
    args: {},
    scopeRef: HOME_SCOPE,
    grantedProjections: ["supplierCommercial"],
    envelope: replenishmentEnvelope([
      {
        ...REPLENISHMENT_ROW,
        supplierCommitment: {
          hasActiveVendor: true,
          openPurchaseOrderCount: 0,
          cancelledPurchaseOrderCount: 0,
        },
      },
    ]),
    budget: PAGE_BUDGET,
  },
  {
    label: "another store's recommendations are invisible",
    verb: "list",
    args: {},
    scopeRef: FOREIGN_SCOPE,
    grantedProjections: [],
    foreignScope: true,
    envelope: replenishmentEnvelope([]),
    budget: PAGE_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// Registration fixture
// ---------------------------------------------------------------------------

export const DAILY_OPERATIONS_EVIDENCE_EXTRACTORS: {
  readonly [capabilityId: string]: AgentEvidenceExtractor;
} = {
  [STORE_DAY_MANIFEST.capabilityId]: STORE_DAY_EXTRACTOR,
  [DAY_SALES_MANIFEST.capabilityId]: DAY_SALES_EXTRACTOR,
  [REGISTER_SESSIONS_MANIFEST.capabilityId]: REGISTER_SESSIONS_EXTRACTOR,
  [POSITIONS_MANIFEST.capabilityId]: POSITIONS_EXTRACTOR,
};

export const DAILY_OPERATIONS_CONFORMANCE: {
  readonly [capabilityId: string]: {
    readonly probes: readonly AgentConformanceProbe[];
    readonly extractor?: AgentEvidenceExtractor;
  };
} = {
  [STORE_DAY_MANIFEST.capabilityId]: { probes: storeDayProbes, extractor: STORE_DAY_EXTRACTOR },
  [ATTENTION_MANIFEST.capabilityId]: { probes: attentionProbes },
  [APPROVALS_MANIFEST.capabilityId]: { probes: approvalsProbes },
  [ACTIVITY_MANIFEST.capabilityId]: { probes: activityProbes },
  [DAY_SALES_MANIFEST.capabilityId]: { probes: daySalesProbes, extractor: DAY_SALES_EXTRACTOR },
  [WEEK_PERFORMANCE_MANIFEST.capabilityId]: { probes: weekProbes },
  [STORE_PULSE_MANIFEST.capabilityId]: { probes: pulseProbes },
  [REGISTER_SESSIONS_MANIFEST.capabilityId]: {
    probes: sessionProbes,
    extractor: REGISTER_SESSIONS_EXTRACTOR,
  },
  [AUTOMATION_MANIFEST.capabilityId]: { probes: automationProbes },
  [POSITIONS_MANIFEST.capabilityId]: { probes: positionProbes, extractor: POSITIONS_EXTRACTOR },
  [REPLENISHMENT_MANIFEST.capabilityId]: { probes: replenishmentProbes },
};
