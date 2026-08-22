/**
 * Seeded Daily Operations store used by the characterization suites and the
 * direct-harness smoke (V26-1267).
 *
 * Two-dot basename on purpose: the Convex bundler skips multi-dot basenames, so
 * this test-support module is never deployed and never treated as ingress.
 *
 * The seed is deliberately one *interesting* operating day rather than a
 * minimal one: an opened-and-not-closed current day plus a closed prior day, so
 * the same fixture exercises live-versus-accepted authority, a partially
 * covered week, an open and a closed register, pending approvals and work,
 * automation runs in two lanes, timeline events, stock positions with a cost
 * basis, and a replenishment-pressured SKU.
 */
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { insertRegisterSessionWithAuthority } from "../../operations/registerSessionAuthorityRevision";

export const FIXTURE_TIMEZONE = "Africa/Accra";
/** 2026-08-20T00:00:00Z — the seeded "prior" (closed) operating day. */
export const PRIOR_OPERATING_DATE = "2026-08-20";
/** 2026-08-21T00:00:00Z — the seeded "current" (open) operating day. */
export const CURRENT_OPERATING_DATE = "2026-08-21";
export const FIXTURE_CURRENCY = "GHS";

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayStart(operatingDate: string): number {
  return Date.parse(`${operatingDate}T00:00:00.000Z`);
}

export function dayEnd(operatingDate: string): number {
  return dayStart(operatingDate) + DAY_MS;
}

/** Fixed "now": mid-morning on the current operating day. */
export const FIXTURE_NOW = dayStart(CURRENT_OPERATING_DATE) + 10 * 60 * 60 * 1000;

export type DailyOperationsFixture = {
  readonly userId: Id<"athenaUser">;
  readonly organizationId: Id<"organization">;
  readonly storeId: Id<"store">;
  readonly openRegisterSessionId: Id<"registerSession">;
  readonly closedRegisterSessionId: Id<"registerSession">;
  readonly approvalRequestId: Id<"approvalRequest">;
  readonly workItemId: Id<"operationalWorkItem">;
  readonly openingAutomationRunId: Id<"automationRun">;
  readonly closeAutomationRunId: Id<"automationRun">;
  readonly timelineEventId: Id<"operationalEvent">;
  readonly lowStockSkuId: Id<"productSku">;
  readonly healthySkuId: Id<"productSku">;
  readonly priorCloseId: Id<"dailyClose">;
};

/**
 * Seed the fixture store. `role` decides the seeded operator's membership;
 * `withSchedule` decides whether `storeTime` can resolve an operating window
 * (absent it, ports must fall back to the UTC day and say so).
 */
export async function seedDailyOperationsStore(
  ctx: MutationCtx,
  options: {
    slug?: string;
    role?: "full_admin" | "pos_only";
    operationalRoles?: ("manager" | "cashier")[];
    withSchedule?: boolean;
  } = {},
): Promise<DailyOperationsFixture> {
  const slug = options.slug ?? "daily-ops";
  const withSchedule = options.withSchedule ?? true;
  const currentStart = dayStart(CURRENT_OPERATING_DATE);
  const priorStart = dayStart(PRIOR_OPERATING_DATE);

  const userId = await ctx.db.insert("athenaUser", { email: `${slug}@athena.test` });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: `${slug} org`,
    slug: `${slug}-org`,
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    currency: FIXTURE_CURRENCY,
    name: `${slug} store`,
    organizationId,
    slug,
  });
  await ctx.db.insert("organizationMember", {
    organizationId,
    userId,
    role: options.role ?? "full_admin",
    operationalRoles: options.operationalRoles,
  });

  if (withSchedule) {
    const timezoneVersionId = await ctx.db.insert("storeTimezoneVersion", {
      organizationId,
      storeId,
      timezone: FIXTURE_TIMEZONE,
      effectiveFrom: priorStart - 30 * DAY_MS,
      contentHash: "tz-v1",
      source: "admin_authorized",
      authorizedByUserId: userId,
      authorizedAt: priorStart - 30 * DAY_MS,
      createdAt: priorStart - 30 * DAY_MS,
    });
    await ctx.db.insert("storeSchedule", {
      organizationId,
      storeId,
      timezone: FIXTURE_TIMEZONE,
      timezoneVersionId,
      // Accra keeps UTC year round, so the seeded windows line up with the UTC
      // day the legacy surface uses; a DST-bearing zone would not, which is the
      // whole reason the window is server-derived.
      // 00:00–23:59 store local. Minute 1440 is not a valid wall-clock minute,
      // so a full day is expressed as the last minute of the day.
      weeklyWindows: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        startMinute: 0,
        endMinute: 1439,
      })),
      weeklyClosedDays: [],
      dateExceptions: [],
      effectiveFrom: priorStart - 30 * DAY_MS,
      status: "active",
      source: "seed",
      createdAt: priorStart - 30 * DAY_MS,
      updatedAt: priorStart - 30 * DAY_MS,
    });
  }

  // --- catalogue -----------------------------------------------------------
  const categoryId = await ctx.db.insert("category", {
    name: "Hair",
    slug: "hair",
    storeId,
  });
  const subcategoryId = await ctx.db.insert("subcategory", {
    categoryId,
    name: "Wigs",
    slug: "wigs",
    storeId,
  });
  const productId = await ctx.db.insert("product", {
    availability: "live",
    categoryId,
    createdByUserId: userId,
    currency: FIXTURE_CURRENCY,
    inventoryCount: 6,
    name: "Bundle deal",
    organizationId,
    slug: "bundle-deal",
    storeId,
    subcategoryId,
  });
  const lowStockSkuId = await ctx.db.insert("productSku", {
    images: [],
    inventoryCount: 1,
    price: 40_000,
    netPrice: 40_000,
    unitCost: 22_000,
    productId,
    productName: "Bundle deal 12in",
    quantityAvailable: 1,
    sku: "BD-12",
    storeId,
  });
  const healthySkuId = await ctx.db.insert("productSku", {
    images: [],
    inventoryCount: 24,
    price: 55_000,
    netPrice: 55_000,
    unitCost: 30_000,
    productId,
    productName: "Bundle deal 16in",
    quantityAvailable: 24,
    sku: "BD-16",
    storeId,
  });

  // --- sales ---------------------------------------------------------------
  await ctx.db.insert("posTransaction", {
    transactionNumber: "T-1001",
    storeId,
    subtotal: 40_000,
    tax: 0,
    total: 40_000,
    payments: [{ method: "cash", amount: 40_000, timestamp: currentStart + 3_600_000 }],
    totalPaid: 40_000,
    paymentMethod: "cash",
    status: "completed",
    completedAt: currentStart + 3_600_000,
  });
  await ctx.db.insert("posTransaction", {
    transactionNumber: "T-1002",
    storeId,
    subtotal: 55_000,
    tax: 0,
    total: 55_000,
    payments: [{ method: "card", amount: 55_000, timestamp: currentStart + 7_200_000 }],
    totalPaid: 55_000,
    paymentMethod: "card",
    status: "completed",
    completedAt: currentStart + 7_200_000,
  });
  await ctx.db.insert("posTransaction", {
    transactionNumber: "T-0900",
    storeId,
    subtotal: 30_000,
    tax: 0,
    total: 30_000,
    payments: [{ method: "cash", amount: 30_000, timestamp: priorStart + 5_400_000 }],
    totalPaid: 30_000,
    paymentMethod: "cash",
    status: "completed",
    completedAt: priorStart + 5_400_000,
  });

  // --- accepted report evidence (prior day) and live day (current) ----------
  await ctx.db.insert("reportDay", {
    storeId,
    operatingDate: PRIOR_OPERATING_DATE,
    currency: FIXTURE_CURRENCY,
    status: "reconciled",
    grossSalesMinor: 30_000,
    netSalesMinor: 30_000,
    refundsMinor: 0,
    unitsSold: 1,
    unitsReturned: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 8_000,
    paymentsCollectedMinor: 30_000,
    paymentsRefundedMinor: 0,
    paymentAllocatedMinor: 30_000,
    transactionCount: 1,
    foldedAt: dayEnd(PRIOR_OPERATING_DATE),
    foldVersion: 6,
    factCount: 1,
    lastFactRecordedAt: priorStart + 5_400_000,
    flags: { mixedCurrency: false, hasUncostedRevenue: false, quarantinedFactCount: 0 },
    paymentMix: {
      status: "complete",
      totalMinor: 30_000,
      rows: [{ method: "cash", amountMinor: 30_000, shareBasisPoints: 10_000, tenderUseCount: 1 }],
    },
    certifiedFoldRevision: 7,
    closeAcceptedAt: dayEnd(PRIOR_OPERATING_DATE),
  });
  await ctx.db.insert("reportSkuDay", {
    storeId,
    productSkuId: lowStockSkuId,
    operatingDate: PRIOR_OPERATING_DATE,
    unitsSold: 1,
    unitsReturned: 0,
    grossSalesMinor: 30_000,
    netSalesMinor: 30_000,
    refundsMinor: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 8_000,
    certifiedFoldRevision: 7,
  });
  await ctx.db.insert("reportDay", {
    storeId,
    operatingDate: CURRENT_OPERATING_DATE,
    currency: FIXTURE_CURRENCY,
    status: "open",
    grossSalesMinor: 95_000,
    netSalesMinor: 95_000,
    refundsMinor: 0,
    unitsSold: 2,
    unitsReturned: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 43_000,
    paymentsCollectedMinor: 95_000,
    paymentsRefundedMinor: 0,
    paymentAllocatedMinor: 95_000,
    transactionCount: 2,
    foldVersion: 6,
    factCount: 2,
    lastFactRecordedAt: currentStart + 7_200_000,
    flags: { mixedCurrency: false, hasUncostedRevenue: false, quarantinedFactCount: 0 },
  });
  await ctx.db.insert("reportSkuDay", {
    storeId,
    productSkuId: lowStockSkuId,
    operatingDate: CURRENT_OPERATING_DATE,
    unitsSold: 1,
    unitsReturned: 0,
    grossSalesMinor: 40_000,
    netSalesMinor: 40_000,
    refundsMinor: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 18_000,
  });
  await ctx.db.insert("reportSkuDay", {
    storeId,
    productSkuId: healthySkuId,
    operatingDate: CURRENT_OPERATING_DATE,
    unitsSold: 1,
    unitsReturned: 0,
    grossSalesMinor: 55_000,
    netSalesMinor: 55_000,
    refundsMinor: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 25_000,
  });

  // --- store-day lifecycle -------------------------------------------------
  const priorCloseId = await ctx.db.insert("dailyClose", {
    storeId,
    organizationId,
    operatingDate: PRIOR_OPERATING_DATE,
    status: "completed",
    lifecycleStatus: "active",
    isCurrent: true,
    readiness: { status: "ready", blockerCount: 0, reviewCount: 0, carryForwardCount: 1, readyCount: 4 },
    summary: { salesTotal: 30_000, transactionCount: 1 },
    sourceSubjects: [],
    carryForwardWorkItemIds: [],
    createdAt: priorStart + 1_000,
    updatedAt: dayEnd(PRIOR_OPERATING_DATE),
    completedAt: dayEnd(PRIOR_OPERATING_DATE) - 1_000,
    completedByUserId: userId,
    actorType: "automation",
    reportingCloseVersion: 7,
  });
  await ctx.db.insert("dailyOpening", {
    storeId,
    organizationId,
    operatingDate: CURRENT_OPERATING_DATE,
    status: "started",
    startAt: currentStart,
    endAt: dayEnd(CURRENT_OPERATING_DATE),
    priorDailyCloseId: priorCloseId,
    readiness: { status: "needs_attention", blockerCount: 0, reviewCount: 1, carryForwardCount: 1, readyCount: 3 },
    sourceSubjects: [],
    carryForwardWorkItemIds: [],
    acknowledgedItemKeys: [],
    createdAt: currentStart + 60_000,
    updatedAt: currentStart + 60_000,
    startedAt: currentStart + 60_000,
    actorType: "automation",
    managerReviewEvidence: [
      {
        key: "carry-forward-1",
        severity: "carry_forward",
        category: "inventory",
        title: "Carry forward",
        message: "Drawer count review carried into today.",
        subject: { type: "operational_work_item", id: "carry-forward-1", label: "Recount BD-12" },
      },
    ],
  });

  // --- registers -----------------------------------------------------------
  // Register sessions are written through the authority-revision writer, the
  // only sanctioned path (`check-register-session-authority-writers`).
  const openRegisterSessionId = await insertRegisterSessionWithAuthority(ctx, {
    storeId,
    organizationId,
    registerNumber: "Register 1",
    status: "open",
    openedAt: currentStart + 120_000,
    openedOperatingDate: CURRENT_OPERATING_DATE,
    openingFloat: 20_000,
    expectedCash: 60_000,
  });
  const closedRegisterSessionId = await insertRegisterSessionWithAuthority(ctx, {
    storeId,
    organizationId,
    registerNumber: "Register 2",
    status: "closed",
    openedAt: currentStart + 130_000,
    openedOperatingDate: CURRENT_OPERATING_DATE,
    closeoutOperatingDate: CURRENT_OPERATING_DATE,
    closedAt: currentStart + 9_000_000,
    openingFloat: 20_000,
    expectedCash: 45_000,
    countedCash: 44_500,
    variance: -500,
    closeoutRecords: [
      { type: "closed", occurredAt: currentStart + 9_000_000, expectedCash: 45_000, countedCash: 44_500, variance: -500 },
    ],
  });

  // --- work, approvals, activity ------------------------------------------
  const workItemId = await ctx.db.insert("operationalWorkItem", {
    storeId,
    organizationId,
    type: "inventory_review",
    status: "open",
    priority: "high",
    approvalState: "none",
    title: "Recount BD-12",
    notes: "Manager note: shelf count disagreed with the system.",
    createdAt: currentStart + 200_000,
    productSkuId: lowStockSkuId,
  });
  const approvalRequestId = await ctx.db.insert("approvalRequest", {
    storeId,
    organizationId,
    requestType: "variance_review",
    subjectType: "register_session",
    subjectId: String(closedRegisterSessionId),
    status: "pending",
    registerSessionId: closedRegisterSessionId,
    reason: "Drawer short by 5.00",
    notes: "Reviewer note: cashier recount pending.",
    createdAt: currentStart + 9_100_000,
  });
  const timelineEventId = await ctx.db.insert("operationalEvent", {
    storeId,
    organizationId,
    eventType: "register_session_closed",
    subjectType: "register_session",
    subjectId: String(closedRegisterSessionId),
    subjectLabel: "Register 2",
    message: "Register 2 closed with a variance of 5.00",
    createdAt: currentStart + 9_000_500,
    registerSessionId: closedRegisterSessionId,
  });
  await ctx.db.insert("operationalEvent", {
    storeId,
    organizationId,
    eventType: "stock_adjustment_recorded",
    subjectType: "product_sku",
    subjectId: String(lowStockSkuId),
    subjectLabel: "Bundle deal 12in",
    message: "Stock adjustment recorded for Bundle deal 12in",
    createdAt: currentStart + 5_000_000,
  });

  // --- automation ----------------------------------------------------------
  const openingAutomationRunId = await ctx.db.insert("automationRun", {
    storeId,
    organizationId,
    operatingDate: CURRENT_OPERATING_DATE,
    domain: "daily_operations",
    action: "opening.auto_start",
    triggerType: "cron",
    idempotencyKey: `opening-${CURRENT_OPERATING_DATE}`,
    outcome: "applied",
    policyMode: "enabled",
    policyVersion: "opening.v3",
    mutationBoundary: "dailyOpening.start",
    sourceSubjects: [{ type: "daily_opening", id: CURRENT_OPERATING_DATE }],
    snapshotCounts: { blockers: 0, reviews: 1 },
    eventIds: [],
    createdAt: currentStart + 60_000,
    updatedAt: currentStart + 60_000,
    appliedAt: currentStart + 60_000,
    decisionEvidence: {
      kind: "opening_gate",
      eligible: true,
      policy: { blockerHandling: "manager_review" },
      gates: [{ key: "blockers", passed: true }],
    },
  });
  const closeAutomationRunId = await ctx.db.insert("automationRun", {
    storeId,
    organizationId,
    operatingDate: CURRENT_OPERATING_DATE,
    domain: "daily_operations",
    action: "eod.prepare",
    triggerType: "cron",
    idempotencyKey: `eod-prepare-${CURRENT_OPERATING_DATE}`,
    outcome: "prepared",
    policyMode: "dry_run",
    policyVersion: "eod.v5",
    mutationBoundary: "dailyClose.prepare",
    sourceSubjects: [{ type: "daily_close", id: CURRENT_OPERATING_DATE }],
    snapshotCounts: { blockers: 1 },
    decisionReason: "register_variance_open",
    eventIds: [],
    createdAt: currentStart + 9_200_000,
    updatedAt: currentStart + 9_200_000,
    decisionEvidence: {
      kind: "eod_gate",
      eligible: false,
      observed: { openRegisters: 1 },
      policy: { varianceToleranceMinor: 1_000 },
      gates: [{ key: "registers_closed", passed: false, reason: "one register still open" }],
    },
  });

  // --- replenishment inputs ------------------------------------------------
  await ctx.db.insert("vendor", {
    storeId,
    organizationId,
    name: "Accra Supply Co",
    lookupKey: "accra-supply-co",
    status: "active",
    createdAt: priorStart,
    createdByUserId: userId,
  });

  return {
    userId,
    organizationId,
    storeId,
    openRegisterSessionId,
    closedRegisterSessionId,
    approvalRequestId,
    workItemId,
    openingAutomationRunId,
    closeAutomationRunId,
    timelineEventId,
    lowStockSkuId,
    healthySkuId,
    priorCloseId,
  };
}
