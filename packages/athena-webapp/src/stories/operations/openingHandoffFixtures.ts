/**
 * Screenshot fixtures for the Opening Handoff workspace.
 *
 * Authored prop bags rendered directly by `DailyOpeningView`'s `fixture` prop — no Convex
 * query runs. Part of one continuous story with the Daily Operations and EOD Review
 * fixtures; see `operationsFixtureContext.ts` and the plan at
 * `docs/plans/2026-07-19-001-feat-operations-screenshot-fixtures-plan.md`.
 *
 * Item titles and messages are reproduced from the server helpers in
 * `convex/operations/dailyOpening.ts` rather than invented, so the workspace reads like
 * real output.
 *
 * Money is in minor units (pesewas).
 */

import type {
  DailyOpeningItem,
  DailyOpeningViewContentProps,
} from "@/components/operations/DailyOpeningView";

import {
  DAY_END,
  DAY_START,
  DEMO_STAFF,
  KENTE_CARRY_FORWARD,
  LINK_PARAMS,
  momentAt,
  OPERATING_DATE,
  ORG_URL_SLUG,
  STORE_ID,
  STORE_URL_SLUG,
} from "./operationsFixtureContext";

/** Just after 9:45 AM, when Athena opened the day in the companion stories. */
export const OPENED_BY_ATHENA_CLOCK = new Date(2026, 6, 18, 9, 50);

const PRIOR_OPERATING_DATE = "2026-07-17";
const OPENED_AT = momentAt(9, 45);
const PRIOR_CLOSED_AT = new Date(2026, 6, 17, 20, 40).getTime();

/**
 * The prior day's completed close, surfaced as a cleared readiness item.
 * Copy follows `priorCloseReadyItem` in convex/operations/dailyOpening.ts.
 */
const priorCloseReadyItem: DailyOpeningItem = {
  category: "prior_close",
  id: "daily_close:prior:completed",
  key: "daily_close:prior:completed",
  link: {
    label: "View EOD Review",
    params: LINK_PARAMS,
    search: { operatingDate: PRIOR_OPERATING_DATE },
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  },
  message: "The prior store day has a completed end of day review.",
  metadata: {
    completedAt: PRIOR_CLOSED_AT,
    operatingDate: PRIOR_OPERATING_DATE,
  },
  severity: "ready",
  subject: {
    id: "daily_close:prior",
    label: `EOD Review ${PRIOR_OPERATING_DATE}`,
    type: "daily_close",
  },
  title: "Prior EOD Review completed",
};

/** When the Kente inventory review became actionable — flagged at the prior day's close,
 * so it reads as carried into this morning's opening. */
const KENTE_OPEN_SINCE = new Date(2026, 6, 17, 19, 15).getTime();

/**
 * The Kente scarf carry-forward from the prior close — the same low-stock thread the
 * Daily Operations timeline and EOD Review fixtures reference.
 *
 * A synced-sale inventory review with a product SKU projects as a single-member logical
 * work group, so this follows the group branch of `legacyLogicalCarryForwardItem` in
 * convex/operations/dailyOpening.ts: `subject.type` is `logical_operational_work_group`,
 * the message speaks of a "work group", and the metadata carries `oldestActionableAt`.
 * The builder sets no `statusLabel` or `description`.
 */
const kenteCarryForwardItem: DailyOpeningItem = {
  category: "carry_forward",
  id: "carry_forward_group:0",
  key: "carry_forward_group:0",
  link: {
    label: "View open work",
    params: LINK_PARAMS,
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
  },
  message:
    "This unresolved prior-close work group must be acknowledged for Opening.",
  // memberCount / sourceCount are group-internal; the workspace filters them out of the
  // row (they are not operator-facing). Kept here as real snapshot data.
  metadata: {
    memberCount: 1,
    oldestActionableAt: KENTE_OPEN_SINCE,
    priority: KENTE_CARRY_FORWARD.priority,
    sourceCount: 1,
    status: KENTE_CARRY_FORWARD.status,
    type: KENTE_CARRY_FORWARD.workItemType,
  },
  severity: "carry_forward",
  subject: {
    id: KENTE_CARRY_FORWARD.groupKey,
    label: KENTE_CARRY_FORWARD.title,
    type: "logical_operational_work_group",
  },
  title: KENTE_CARRY_FORWARD.title,
};

/**
 * Opening Handoff already started automatically by Athena. The presence of
 * `startedOpening` is what puts the workspace in its "started" state; `actorType:
 * "automation"` with a null staff name renders the attribution as "Athena".
 */
export const openedByAthenaFixture: DailyOpeningViewContentProps = {
  currency: "GHS",
  hasFullAdminAccess: true,
  isAuthenticated: true,
  isLoadingAccess: false,
  isLoadingSnapshot: false,
  isStarting: false,
  // The operating-date trigger renders `disabled={disabled || !onChange}`, so a
  // handler must be present for the control to look live. A fixture has nowhere to
  // navigate, so this is a no-op that only keeps the trigger enabled.
  onOperatingDateChange: () => {},
  onStartDay: async () => ({ data: undefined, kind: "ok" }),
  orgUrlSlug: ORG_URL_SLUG,
  storeId: STORE_ID,
  storeUrlSlug: STORE_URL_SLUG,
  snapshot: {
    automationStatus: {
      bucket: "action_taken",
      id: "auto-opening-0718",
      occurredAt: OPENED_AT,
      outcome: "applied",
      reviewEvidence: [kenteCarryForwardItem],
    },
    blockers: [],
    carryForwardItems: [kenteCarryForwardItem],
    endAt: DAY_END,
    operatingDate: OPERATING_DATE,
    priorClose: {
      completedAt: PRIOR_CLOSED_AT,
      completedByStaffName: DEMO_STAFF.manager,
      notes: null,
      operatingDate: PRIOR_OPERATING_DATE,
    },
    readiness: {
      blockerCount: 0,
      carryForwardCount: 1,
      readyCount: 1,
      reviewCount: 0,
      status: "ready",
    },
    readyItems: [priorCloseReadyItem],
    reviewItems: [],
    startAt: DAY_START,
    startedOpening: {
      actorType: "automation",
      notes: null,
      reviewEvidence: [kenteCarryForwardItem],
      startedAt: OPENED_AT,
      startedByStaffName: null,
    },
    status: "started",
    summary: {
      blockerCount: 0,
      carryForwardCount: 1,
      readyCount: 1,
      reviewCount: 0,
    },
  },
};

// ---------------------------------------------------------------------------
// Wednesday morning — the opening that precedes the mid-week Daily Operations
// hero shot (see `dailyOperationsFixtures.ts` `busy-wednesday`). Athena opened
// the store day at 9:34 AM, matching that shot's automation band. Self-contained
// dates so it doesn't repurpose the shared Saturday story.
// ---------------------------------------------------------------------------

const WED_OPERATING_DATE = "2026-07-15";
const WED_PRIOR_OPERATING_DATE = "2026-07-14";
const WED_DAY_START = new Date(2026, 6, 15, 0, 0).getTime();
const WED_DAY_END = new Date(2026, 6, 16, 0, 0).getTime();
const wedAt = (hour: number, minute: number) =>
  new Date(2026, 6, 15, hour, minute).getTime();

/** Just after 9:34 AM, when Athena opened the mid-week day. */
export const WEDNESDAY_OPENED_CLOCK = new Date(2026, 6, 15, 9, 40);

const WED_OPENED_AT = wedAt(9, 34);
const WED_PRIOR_CLOSED_AT = new Date(2026, 6, 14, 20, 40).getTime();
const WED_KENTE_OPEN_SINCE = new Date(2026, 6, 14, 19, 15).getTime();

const wednesdayPriorCloseReadyItem: DailyOpeningItem = {
  category: "prior_close",
  id: "daily_close:prior:completed",
  key: "daily_close:prior:completed",
  link: {
    label: "View EOD Review",
    params: LINK_PARAMS,
    search: { operatingDate: WED_PRIOR_OPERATING_DATE },
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  },
  message: "The prior store day has a completed end of day review.",
  metadata: {
    completedAt: WED_PRIOR_CLOSED_AT,
    operatingDate: WED_PRIOR_OPERATING_DATE,
  },
  severity: "ready",
  subject: {
    id: "daily_close:prior",
    label: `EOD Review ${WED_PRIOR_OPERATING_DATE}`,
    type: "daily_close",
  },
  title: "Prior EOD Review completed",
};

const wednesdayKenteCarryForwardItem: DailyOpeningItem = {
  category: "carry_forward",
  id: "carry_forward_group:0",
  key: "carry_forward_group:0",
  link: {
    label: "View open work",
    params: LINK_PARAMS,
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
  },
  message:
    "This unresolved prior-close work group must be acknowledged for Opening.",
  metadata: {
    memberCount: 1,
    oldestActionableAt: WED_KENTE_OPEN_SINCE,
    priority: KENTE_CARRY_FORWARD.priority,
    sourceCount: 1,
    status: KENTE_CARRY_FORWARD.status,
    type: KENTE_CARRY_FORWARD.workItemType,
  },
  severity: "carry_forward",
  subject: {
    id: KENTE_CARRY_FORWARD.groupKey,
    label: KENTE_CARRY_FORWARD.title,
    type: "logical_operational_work_group",
  },
  title: KENTE_CARRY_FORWARD.title,
};

export const wednesdayOpeningFixture: DailyOpeningViewContentProps = {
  currency: "GHS",
  hasFullAdminAccess: true,
  isAuthenticated: true,
  isLoadingAccess: false,
  isLoadingSnapshot: false,
  isStarting: false,
  // Keep the operating-date trigger enabled (see openedByAthenaFixture).
  onOperatingDateChange: () => {},
  onStartDay: async () => ({ data: undefined, kind: "ok" }),
  orgUrlSlug: ORG_URL_SLUG,
  storeId: STORE_ID,
  storeUrlSlug: STORE_URL_SLUG,
  snapshot: {
    automationStatus: {
      bucket: "action_taken",
      id: "auto-opening-0715",
      occurredAt: WED_OPENED_AT,
      outcome: "applied",
      reviewEvidence: [wednesdayKenteCarryForwardItem],
    },
    blockers: [],
    carryForwardItems: [wednesdayKenteCarryForwardItem],
    endAt: WED_DAY_END,
    operatingDate: WED_OPERATING_DATE,
    priorClose: {
      completedAt: WED_PRIOR_CLOSED_AT,
      completedByStaffName: DEMO_STAFF.manager,
      notes: null,
      operatingDate: WED_PRIOR_OPERATING_DATE,
    },
    readiness: {
      blockerCount: 0,
      carryForwardCount: 1,
      readyCount: 1,
      reviewCount: 0,
      status: "ready",
    },
    readyItems: [wednesdayPriorCloseReadyItem],
    reviewItems: [],
    startAt: WED_DAY_START,
    startedOpening: {
      actorType: "automation",
      notes: null,
      reviewEvidence: [wednesdayKenteCarryForwardItem],
      startedAt: WED_OPENED_AT,
      startedByStaffName: null,
    },
    status: "started",
    summary: {
      blockerCount: 0,
      carryForwardCount: 1,
      readyCount: 1,
      reviewCount: 0,
    },
  },
};

export const openingHandoffFixtures = {
  "opened-by-athena": {
    clock: OPENED_BY_ATHENA_CLOCK,
    props: openedByAthenaFixture,
  },
  "wednesday-opening": {
    clock: WEDNESDAY_OPENED_CLOCK,
    props: wednesdayOpeningFixture,
  },
} as const;

export type OpeningHandoffFixtureName = keyof typeof openingHandoffFixtures;
