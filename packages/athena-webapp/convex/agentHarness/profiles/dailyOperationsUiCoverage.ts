/**
 * UI-field coverage fixture for the Daily Operations profile (V26-1267).
 *
 * Every operator-visible datum on the Daily Operations surface maps to exactly
 * one of three things:
 *
 * - `resource` — an authoritative semantic resource and the field on it that
 *   carries the same fact. The sibling test resolves the field path against the
 *   published manifest, so a rename on either side breaks the build.
 * - `presentation_only` — routing, labels, formatting, selection state, and
 *   client caches. These are not facts about the store; an agent answer must
 *   never invent them.
 * - `matrix_deferred` — a real operator-visible fact the v1 capability matrix
 *   deliberately does not publish. Changing the matrix requires a plan
 *   amendment, so these are recorded honestly rather than smuggled in.
 *
 * The paths are DERIVED from the view-model type declarations in
 * `DailyOperationsView.tsx` and `StorePulseSummaryView.tsx` by the sibling
 * test, not transcribed from prose: adding a data area to the view without
 * mapping it here fails that test.
 */

export type DailyOperationsUiCoverage =
  | { readonly kind: "resource"; readonly resource: string; readonly field: string; readonly note?: string }
  | { readonly kind: "presentation_only"; readonly reason: string }
  | { readonly kind: "matrix_deferred"; readonly reason: string };

const resource = (resourceNamespace: string, field: string, note?: string): DailyOperationsUiCoverage => ({
  kind: "resource",
  resource: resourceNamespace,
  field,
  ...(note ? { note } : {}),
});
const presentation = (reason: string): DailyOperationsUiCoverage => ({ kind: "presentation_only", reason });
const deferred = (reason: string): DailyOperationsUiCoverage => ({ kind: "matrix_deferred", reason });

const ROUTING = presentation("In-app route or link target; the profile's source-destination resolver owns navigation.");
const LABEL = presentation("Formatted operator copy derived from a fact that is already mapped.");

export const DAILY_OPERATIONS_UI_COVERAGE: { readonly [path: string]: DailyOperationsUiCoverage } = {
  // --- automation status -----------------------------------------------------
  "DailyOperationsAutomationStatus.bucket": resource("automation.dailyOperations", "disposition"),
  "DailyOperationsAutomationStatus.id": resource("automation.dailyOperations", "runRef"),
  "DailyOperationsAutomationStatus.lane": resource("automation.dailyOperations", "lane"),
  "DailyOperationsAutomationStatus.occurredAt": resource("automation.dailyOperations", "occurredAt"),
  "DailyOperationsAutomationStatus.outcome": resource("automation.dailyOperations", "outcome"),
  "DailyOperationsAutomationStatus.reviewEvidence.id": resource("automation.dailyOperations", "policyEvidence.gates.key"),
  "DailyOperationsAutomationStatus.reviewEvidence.label": resource("automation.dailyOperations", "policyEvidence.kind"),
  "DailyOperationsAutomationStatus.reviewEvidence.message": resource(
    "automation.dailyOperations",
    "policyEvidence.gates.reason",
  ),
  "DailyOperationsAutomationStatus.reviewEvidence.source.id": resource("automation.dailyOperations", "runRef"),
  "DailyOperationsAutomationStatus.reviewEvidence.source.label": resource("automation.dailyOperations", "action"),
  "DailyOperationsAutomationStatus.reviewEvidence.source.type": resource("automation.dailyOperations", "action"),
  "DailyOperationsAutomationStatus.reviewEvidence.sourceLink.params": ROUTING,
  "DailyOperationsAutomationStatus.reviewEvidence.sourceLink.search": ROUTING,
  "DailyOperationsAutomationStatus.reviewEvidence.sourceLink.to": ROUTING,
  "DailyOperationsAutomationStatus.sourceLink.params": ROUTING,
  "DailyOperationsAutomationStatus.sourceLink.search": ROUTING,
  "DailyOperationsAutomationStatus.sourceLink.to": ROUTING,

  // --- completed close attribution ------------------------------------------
  "DailyOperationsCompletedCloseAttribution.actorType": resource("operations.storeDay", "completedCloseActor"),
  "DailyOperationsCompletedCloseAttribution.automationDecisionReason": resource(
    "automation.dailyOperations",
    "decisionReason",
  ),
  "DailyOperationsCompletedCloseAttribution.carryForwardCount": resource(
    "operations.storeDay",
    "closeReadiness.carryForwardCount",
  ),
  "DailyOperationsCompletedCloseAttribution.completedAt": resource("operations.storeDay", "completedCloseAt"),
  "DailyOperationsCompletedCloseAttribution.policyReviewedItemKeys": resource(
    "automation.dailyOperations",
    "policyEvidence.gates.key",
  ),
  "DailyOperationsCompletedCloseAttribution.restrictedDetailsRedacted": presentation(
    "A redaction flag the screen needs because it zeroes restricted money; the agent surface omits the fields instead, so there is nothing to flag.",
  ),

  // --- open register sessions -----------------------------------------------
  "DailyOperationsOpenRegisterSessionsSnapshot.operatingDate": resource(
    "cash.registerSessions",
    "openedOperatingDate",
  ),
  "DailyOperationsOpenRegisterSessionsSnapshot.sessions.displayLabel": resource(
    "cash.registerSessions",
    "registerLabel",
  ),
  "DailyOperationsOpenRegisterSessionsSnapshot.sessions.id": resource("cash.registerSessions", "sessionRef"),
  "DailyOperationsOpenRegisterSessionsSnapshot.sessions.openedOperatingDate": resource(
    "cash.registerSessions",
    "openedOperatingDate",
  ),

  // --- scheduled platform cron evidence -------------------------------------
  "DailyOperationsScheduledRunSummary.candidateCount": deferred("Platform cron-run evidence is outside the v1 matrix."),
  "DailyOperationsScheduledRunSummary.completedAt": deferred("Platform cron-run evidence is outside the v1 matrix."),
  "DailyOperationsScheduledRunSummary.cronFamily": deferred("Platform cron-run evidence is outside the v1 matrix."),
  "DailyOperationsScheduledRunSummary.failedCount": deferred("Platform cron-run evidence is outside the v1 matrix."),
  "DailyOperationsScheduledRunSummary.id": deferred("Platform cron-run evidence is outside the v1 matrix."),
  "DailyOperationsScheduledRunSummary.outcome": deferred("Platform cron-run evidence is outside the v1 matrix."),
  "DailyOperationsScheduledRunSummary.processedCount": deferred("Platform cron-run evidence is outside the v1 matrix."),
  "DailyOperationsScheduledRunSummary.skippedCount": deferred("Platform cron-run evidence is outside the v1 matrix."),
  "DailyOperationsScheduledRunSummary.succeededCount": deferred("Platform cron-run evidence is outside the v1 matrix."),
  "DailyOperationsScheduledRunSummary.windowEndAt": deferred("Platform cron-run evidence is outside the v1 matrix."),
  "DailyOperationsScheduledRunSummary.windowStartAt": deferred("Platform cron-run evidence is outside the v1 matrix."),

  // --- attention queue -------------------------------------------------------
  "DailyOperationsSnapshot.attentionItems.id": resource("operations.attention", "itemRef"),
  "DailyOperationsSnapshot.attentionItems.label": resource("operations.attention", "title"),
  "DailyOperationsSnapshot.attentionItems.message": resource("operations.attention", "managerReason"),
  "DailyOperationsSnapshot.attentionItems.owner": resource("operations.attention", "lane"),
  "DailyOperationsSnapshot.attentionItems.params": ROUTING,
  "DailyOperationsSnapshot.attentionItems.registerSession.displayLabel": resource(
    "operations.attention",
    "registerLabel",
  ),
  "DailyOperationsSnapshot.attentionItems.registerSession.isOpenedForOperatingDate": resource(
    "cash.registerSessions",
    "openedOperatingDate",
  ),
  "DailyOperationsSnapshot.attentionItems.registerSession.openedOperatingDate": resource(
    "cash.registerSessions",
    "openedOperatingDate",
  ),
  "DailyOperationsSnapshot.attentionItems.search": ROUTING,
  "DailyOperationsSnapshot.attentionItems.severity": resource("operations.attention", "status"),
  "DailyOperationsSnapshot.attentionItems.source.id": resource("operations.attention", "itemRef"),
  "DailyOperationsSnapshot.attentionItems.source.label": resource("operations.attention", "subjectLabel"),
  "DailyOperationsSnapshot.attentionItems.source.type": resource("operations.attention", "subjectKind"),
  "DailyOperationsSnapshot.attentionItems.to": ROUTING,

  // --- snapshot roots --------------------------------------------------------
  "DailyOperationsSnapshot.automationStatuses": resource("automation.dailyOperations", "runRef"),
  "DailyOperationsSnapshot.completedClose": resource("operations.storeDay", "completedCloseAt"),
  "DailyOperationsSnapshot.currency": resource(
    "reports.daySales",
    "revenue",
    "Every money value in the agent surface carries its own currency.",
  ),
  "DailyOperationsSnapshot.endAt": resource(
    "operations.storeDay",
    "operatingWindow.derivation",
    "The agent surface names an operating date and reports how the window was derived; it never exposes a raw window.",
  ),
  "DailyOperationsSnapshot.startAt": resource("operations.storeDay", "operatingWindow.derivation"),
  "DailyOperationsSnapshot.lanes.count": resource("operations.storeDay", "attentionCount"),
  "DailyOperationsSnapshot.lanes.countLabel": LABEL,
  "DailyOperationsSnapshot.lanes.description": LABEL,
  "DailyOperationsSnapshot.lanes.key": resource("operations.attention", "lane"),
  "DailyOperationsSnapshot.lanes.label": LABEL,
  "DailyOperationsSnapshot.lanes.status": resource("operations.attention", "status"),
  "DailyOperationsSnapshot.lanes.to": ROUTING,
  "DailyOperationsSnapshot.lifecycle.description": resource("operations.storeDay", "lifecycleSummary"),
  "DailyOperationsSnapshot.lifecycle.label": LABEL,
  "DailyOperationsSnapshot.lifecycle.status": resource("operations.storeDay", "lifecycleStage"),
  "DailyOperationsSnapshot.operatingDate": resource("operations.storeDay", "operatingDate"),
  "DailyOperationsSnapshot.primaryAction.label": ROUTING,
  "DailyOperationsSnapshot.primaryAction.to": ROUTING,
  "DailyOperationsSnapshot.priorDayMetric": resource("reports.weekPerformance", "days.isPriorBoundary"),
  "DailyOperationsSnapshot.scheduledRunSummaries": deferred(
    "Platform cron-run evidence is outside the v1 matrix.",
  ),
  "DailyOperationsSnapshot.storeId": presentation(
    "Raw store identifier used for routing; an agent result never carries a raw identifier.",
  ),
  "DailyOperationsSnapshot.storePulse": resource("reports.storePulse", "revenue"),
  "DailyOperationsSnapshot.timelineHasMore": presentation(
    "Client pagination flag; the agent envelope carries explicit pagination and per-source completeness.",
  ),
  "DailyOperationsSnapshot.weekSnapshots": presentation("Client-side cache of per-day snapshots."),

  // --- close summary ---------------------------------------------------------
  "DailyOperationsSnapshot.closeSummary.carriedOverCashTotal": resource("cash.registerSessions", "openingFloat"),
  "DailyOperationsSnapshot.closeSummary.carriedOverRegisterCount": resource(
    "cash.registerSessions",
    "openedOperatingDate",
    "Derivable by counting sessions whose opened operating date precedes the day.",
  ),
  "DailyOperationsSnapshot.closeSummary.currentDayCashTotal": resource("reports.daySales", "paymentGroups.amount"),
  "DailyOperationsSnapshot.closeSummary.currentDayCashTransactionCount": resource(
    "reports.daySales",
    "paymentGroups.tenderUseCount",
  ),
  "DailyOperationsSnapshot.closeSummary.expenseTotal": resource("reports.weekPerformance", "days.expenses"),
  "DailyOperationsSnapshot.closeSummary.expenseTransactionCount": deferred(
    "Expense transaction counts are not published by the v1 matrix; only expense totals are.",
  ),
  "DailyOperationsSnapshot.closeSummary.netCashVariance": resource("cash.registerSessions", "variance"),
  "DailyOperationsSnapshot.closeSummary.paymentTotals.amount": resource("reports.daySales", "paymentGroups.amount"),
  "DailyOperationsSnapshot.closeSummary.paymentTotals.method": resource("reports.daySales", "paymentGroups.method"),
  "DailyOperationsSnapshot.closeSummary.paymentTotals.transactionCount": resource(
    "reports.daySales",
    "paymentGroups.tenderUseCount",
  ),
  "DailyOperationsSnapshot.closeSummary.registerVarianceCount": resource("cash.registerSessions", "variance"),
  "DailyOperationsSnapshot.closeSummary.salesTotal": resource("reports.daySales", "revenue"),
  "DailyOperationsSnapshot.closeSummary.transactionCount": resource("reports.daySales", "transactionCount"),

  // --- timeline --------------------------------------------------------------
  "DailyOperationsSnapshot.timeline.approvedProductLink.label": ROUTING,
  "DailyOperationsSnapshot.timeline.approvedProductLink.params": ROUTING,
  "DailyOperationsSnapshot.timeline.approvedProductLink.search": ROUTING,
  "DailyOperationsSnapshot.timeline.approvedProductLink.to": ROUTING,
  "DailyOperationsSnapshot.timeline.createdAt": resource("operations.activity", "occurredAt"),
  "DailyOperationsSnapshot.timeline.id": resource("operations.activity", "eventRef"),
  "DailyOperationsSnapshot.timeline.message": resource("operations.activity", "summary"),
  "DailyOperationsSnapshot.timeline.onlineOrderLink.label": ROUTING,
  "DailyOperationsSnapshot.timeline.onlineOrderLink.matchLabel": ROUTING,
  "DailyOperationsSnapshot.timeline.onlineOrderLink.params": ROUTING,
  "DailyOperationsSnapshot.timeline.onlineOrderLink.search": ROUTING,
  "DailyOperationsSnapshot.timeline.onlineOrderLink.to": ROUTING,
  "DailyOperationsSnapshot.timeline.productLink.label": ROUTING,
  "DailyOperationsSnapshot.timeline.productLink.params": ROUTING,
  "DailyOperationsSnapshot.timeline.productLink.search": ROUTING,
  "DailyOperationsSnapshot.timeline.productLink.to": ROUTING,
  "DailyOperationsSnapshot.timeline.registerLink.label": ROUTING,
  "DailyOperationsSnapshot.timeline.registerLink.matchLabel": ROUTING,
  "DailyOperationsSnapshot.timeline.registerLink.params": ROUTING,
  "DailyOperationsSnapshot.timeline.registerLink.search": ROUTING,
  "DailyOperationsSnapshot.timeline.registerLink.to": ROUTING,
  "DailyOperationsSnapshot.timeline.subject.id": resource("operations.activity", "eventRef"),
  "DailyOperationsSnapshot.timeline.subject.label": resource("operations.activity", "subjectLabel"),
  "DailyOperationsSnapshot.timeline.subject.type": resource("operations.activity", "subjectKind"),
  "DailyOperationsSnapshot.timeline.transactionLink.label": ROUTING,
  "DailyOperationsSnapshot.timeline.transactionLink.params": ROUTING,
  "DailyOperationsSnapshot.timeline.transactionLink.search": ROUTING,
  "DailyOperationsSnapshot.timeline.transactionLink.to": ROUTING,
  "DailyOperationsSnapshot.timeline.type": resource("operations.activity", "eventKind"),

  // --- week metrics ----------------------------------------------------------
  "DailyOperationsSnapshot.weekMetrics.currentDayCashTotal": resource("reports.weekPerformance", "days.cashTaken"),
  "DailyOperationsSnapshot.weekMetrics.currentDayCashTransactionCount": deferred(
    "Per-day cash transaction counts are not published by the v1 matrix.",
  ),
  "DailyOperationsSnapshot.weekMetrics.expenseTotal": resource("reports.weekPerformance", "days.expenses"),
  "DailyOperationsSnapshot.weekMetrics.expenseTransactionCount": deferred(
    "Per-day expense transaction counts are not published by the v1 matrix.",
  ),
  "DailyOperationsSnapshot.weekMetrics.isClosed": resource("reports.weekPerformance", "days.authority"),
  "DailyOperationsSnapshot.weekMetrics.isReopened": resource("operations.storeDay", "closeStatus"),
  "DailyOperationsSnapshot.weekMetrics.isSelected": presentation("Which day the operator has selected on screen."),
  "DailyOperationsSnapshot.weekMetrics.operatingDate": resource("reports.weekPerformance", "days.operatingDate"),
  "DailyOperationsSnapshot.weekMetrics.paymentTotals.amount": resource("reports.daySales", "paymentGroups.amount"),
  "DailyOperationsSnapshot.weekMetrics.paymentTotals.method": resource("reports.daySales", "paymentGroups.method"),
  "DailyOperationsSnapshot.weekMetrics.paymentTotals.transactionCount": resource(
    "reports.daySales",
    "paymentGroups.tenderUseCount",
  ),
  "DailyOperationsSnapshot.weekMetrics.salesTotal": resource("reports.weekPerformance", "days.revenue"),
  "DailyOperationsSnapshot.weekMetrics.transactionCount": resource(
    "reports.weekPerformance",
    "days.transactionCount",
  ),
  "DailyOperationsSnapshot.weekStorePulses.operatingDate": resource("reports.storePulse", "operatingDate"),
  "DailyOperationsSnapshot.weekStorePulses.storePulse": resource("reports.storePulse", "revenue"),

  // --- sibling snapshots -----------------------------------------------------
  "DailyOperationsStorePulseSnapshot.operatingDate": resource("reports.storePulse", "operatingDate"),
  "DailyOperationsStorePulseSnapshot.storePulse": resource("reports.storePulse", "revenue"),
  "DailyOperationsStoreRequestsSnapshot.approvalsLane": resource("operations.approvals", "state"),
  "DailyOperationsStoreRequestsSnapshot.operatingDate": resource("operations.approvals", "operatingDate"),
  "DailyOperationsTimelineSnapshot.operatingDate": resource("operations.activity", "operatingDate"),
  "DailyOperationsTimelineSnapshot.timeline": resource("operations.activity", "eventRef"),
  "DailyOperationsWeekAnalyticsSnapshot.operatingDate": resource(
    "reports.weekPerformance",
    "weekStartOperatingDate",
  ),
  "DailyOperationsWeekAnalyticsSnapshot.priorWeekBoundaryMetric": resource(
    "reports.weekPerformance",
    "days.isPriorBoundary",
  ),
  "DailyOperationsWeekAnalyticsSnapshot.weekEndOperatingDate": resource(
    "reports.weekPerformance",
    "weekEndOperatingDate",
  ),
  "DailyOperationsWeekAnalyticsSnapshot.weekMetrics": resource("reports.weekPerformance", "days.operatingDate"),

  // --- store pulse -----------------------------------------------------------
  "StorePulseOperatorSnapshot.busiestHour.hour": resource("reports.storePulse", "busiestHour.hour"),
  "StorePulseOperatorSnapshot.busiestHour.label": LABEL,
  "StorePulseOperatorSnapshot.busiestHour.totalSales": resource("reports.storePulse", "busiestHour.revenue"),
  "StorePulseOperatorSnapshot.busiestHour.transactionCount": resource(
    "reports.storePulse",
    "busiestHour.transactionCount",
  ),
  "StorePulseOperatorSnapshot.comparison.averageTransactionDeltaPercent": deferred(
    "Only the sales change is published in v1; the other comparison deltas are not.",
  ),
  "StorePulseOperatorSnapshot.comparison.currentAverageTransaction": resource(
    "reports.storePulse",
    "averageTransaction",
  ),
  "StorePulseOperatorSnapshot.comparison.currentItemsSold": resource("reports.storePulse", "itemsSold"),
  "StorePulseOperatorSnapshot.comparison.currentSales": resource("reports.storePulse", "revenue"),
  "StorePulseOperatorSnapshot.comparison.currentTransactions": resource("reports.storePulse", "transactionCount"),
  "StorePulseOperatorSnapshot.comparison.itemsSoldDeltaPercent": deferred(
    "Only the sales change is published in v1; the other comparison deltas are not.",
  ),
  "StorePulseOperatorSnapshot.comparison.salesDeltaPercent": resource(
    "reports.storePulse",
    "revenueChangeBasisPoints",
  ),
  "StorePulseOperatorSnapshot.comparison.transactionDeltaPercent": deferred(
    "Only the sales change is published in v1; the other comparison deltas are not.",
  ),
  "StorePulseOperatorSnapshot.comparison.yesterdayAverageTransaction": deferred(
    "The comparison window's own figures are not published in v1; the change is.",
  ),
  "StorePulseOperatorSnapshot.comparison.yesterdayItemsSold": deferred(
    "The comparison window's own figures are not published in v1; the change is.",
  ),
  "StorePulseOperatorSnapshot.comparison.yesterdaySales": deferred(
    "The comparison window's own figures are not published in v1; the change is.",
  ),
  "StorePulseOperatorSnapshot.comparison.yesterdayTransactions": deferred(
    "The comparison window's own figures are not published in v1; the change is.",
  ),
  "StorePulseOperatorSnapshot.historyDays": resource("reports.storePulse", "historyDayCount"),
  "StorePulseOperatorSnapshot.isLimited": resource("reports.storePulse", "isLimitedHistory"),
  "StorePulseOperatorSnapshot.paymentMix": resource("reports.daySales", "paymentGroups.method"),
  "StorePulseOperatorSnapshot.topItems.name": resource("reports.storePulse", "topItems.displayName"),
  "StorePulseOperatorSnapshot.topItems.productSku": resource("reports.storePulse", "topItems.skuCode"),
  "StorePulseOperatorSnapshot.topItems.quantity": resource("reports.storePulse", "topItems.quantity"),
  "StorePulseOperatorSnapshot.topItems.totalSales": resource("reports.storePulse", "topItems.value"),
  "StorePulseOperatorSnapshot.trend": resource("reports.weekPerformance", "days.operatingDate"),
  "StorePulseOperatorSnapshot.usableHistoryDays": resource("reports.storePulse", "historyDayCount"),

  "StorePulsePaymentMixEntry.count": resource("reports.daySales", "paymentGroups.tenderUseCount"),
  "StorePulsePaymentMixEntry.label": LABEL,
  "StorePulsePaymentMixEntry.method": resource("reports.daySales", "paymentGroups.method"),
  "StorePulsePaymentMixEntry.share": resource("reports.daySales", "paymentGroups.shareBasisPoints"),
  "StorePulsePaymentMixEntry.total": resource("reports.daySales", "paymentGroups.amount"),

  "StorePulseSummary.averageTransaction": resource("reports.storePulse", "averageTransaction"),
  "StorePulseSummary.date": resource("reports.storePulse", "operatingDate"),
  "StorePulseSummary.operatorSnapshot": resource("reports.storePulse", "revenue"),
  "StorePulseSummary.totalItemsSold": resource("reports.storePulse", "itemsSold"),
  "StorePulseSummary.totalSales": resource("reports.storePulse", "revenue"),
  "StorePulseSummary.totalTransactions": resource("reports.storePulse", "transactionCount"),

  "StorePulseTrendDay.averageTransaction": deferred(
    "Per-day average basket in the trend series is not published in v1.",
  ),
  "StorePulseTrendDay.date": resource("reports.weekPerformance", "days.operatingDate"),
  "StorePulseTrendDay.hasKnownItemCount": deferred(
    "Per-day item-count availability in the trend series is not published in v1.",
  ),
  "StorePulseTrendDay.label": LABEL,
  "StorePulseTrendDay.totalItemsSold": deferred("Per-day units sold in the trend series is not published in v1."),
  "StorePulseTrendDay.totalSales": resource("reports.weekPerformance", "days.revenue"),
  "StorePulseTrendDay.transactionCount": resource("reports.weekPerformance", "days.transactionCount"),
};
