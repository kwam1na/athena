import type {
  DailyOpeningSnapshot,
  DailyOpeningViewContentProps,
} from "@/components/operations/DailyOpeningView";
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
  getLocalOperatingDateRange,
} from "@/lib/operations/operatingDate";
import { SHARED_DEMO_STORE_IDENTITY } from "~/shared/sharedDemoStory";
import type { Id } from "~/convex/_generated/dataModel";

import { getSharedDemoHistoricalDayFixture } from "./sharedDemoOperationsFixture";

function shiftOperatingDate(operatingDate: string, days: number) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  if (!date) throw new Error(`Invalid operating date: ${operatingDate}`);
  date.setDate(date.getDate() + days);
  return getLocalOperatingDate(date);
}

function getOperatingDateTimestamp(
  operatingDate: string,
  hours: number,
  minutes: number,
) {
  const date = getLocalDateFromOperatingDate(operatingDate);
  if (!date) throw new Error(`Invalid operating date: ${operatingDate}`);
  return date.setHours(hours, minutes, 0, 0);
}

export function createSharedDemoDailyOpeningFixture({
  operatingDate,
  orgUrlSlug,
  storeId,
  storeUrlSlug,
}: {
  operatingDate: string;
  orgUrlSlug: string;
  storeId: Id<"store">;
  storeUrlSlug: string;
}): DailyOpeningViewContentProps | undefined {
  const today = getLocalOperatingDate();
  const day = getSharedDemoHistoricalDayFixture(operatingDate);

  const priorOperatingDate = shiftOperatingDate(operatingDate, -1);
  const priorDay = getSharedDemoHistoricalDayFixture(priorOperatingDate);
  if (!day && !(operatingDate === today && priorDay)) return undefined;

  const priorCloseCompletedAt = getOperatingDateTimestamp(
    priorOperatingDate,
    20,
    15,
  );
  const startedAt = getOperatingDateTimestamp(operatingDate, 8, 30);
  const range = getLocalOperatingDateRange(
    getLocalDateFromOperatingDate(operatingDate)!,
  );
  const snapshot: DailyOpeningSnapshot = {
    automationStatus: {
      bucket: "action_taken",
      id: `demo-opening-automation-${operatingDate}`,
      occurredAt: startedAt,
      outcome: "applied",
    },
    blockers: [],
    carryForwardItems: [],
    endAt: range.endAt,
    operatingDate,
    priorClose: {
      completedAt: priorCloseCompletedAt,
      operatingDate: priorOperatingDate,
    },
    readiness: {
      blockerCount: 0,
      carryForwardCount: 0,
      readyCount: 1,
      reviewCount: 0,
      status: "ready",
    },
    readyItems: [
      {
        category: "prior_close",
        id: `daily_close:demo-close-${priorOperatingDate}:completed`,
        key: `daily_close:demo-close-${priorOperatingDate}:completed`,
        link: priorDay
          ? {
              label: "View EOD Review",
              search: { operatingDate: priorOperatingDate },
              to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
            }
          : undefined,
        message: "The prior store day has a completed end of day review.",
        metadata: {
          completedAt: priorCloseCompletedAt,
          operatingDate: priorOperatingDate,
        },
        severity: "ready",
        statusLabel: "Ready",
        subject: {
          id: `demo-close-${priorOperatingDate}`,
          label: `EOD Review ${priorOperatingDate}`,
          type: "daily_close",
        },
        title: "Prior EOD Review completed",
      },
    ],
    reviewItems: [],
    startAt: range.startAt,
    startedOpening: {
      actorType: "automation",
      startedAt,
    },
    status: "started",
    summary: {
      blockerCount: 0,
      carryForwardCount: 0,
      readyCount: 1,
      reviewCount: 0,
    },
  };

  return {
    currency: SHARED_DEMO_STORE_IDENTITY.currency,
    hasFullAdminAccess: true,
    isAuthenticated: true,
    isLoadingAccess: false,
    isLoadingSnapshot: false,
    isStarting: false,
    onStartDay: async () => ({
      error: {
        code: "validation_failed",
        message: "This historical Opening Handoff is read-only.",
      },
      kind: "user_error",
    }),
    orgUrlSlug,
    snapshot,
    storeId,
    storeUrlSlug,
  };
}
