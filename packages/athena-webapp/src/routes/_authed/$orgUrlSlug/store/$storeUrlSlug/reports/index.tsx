import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { z } from "zod";

import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useStableReportQuery } from "@/components/reports/useStableReportQuery";
import { api } from "~/convex/_generated/api";

import { ReportsCatalogLookup } from "@/components/reports/ReportsCatalogLookup";
import { ReportDaysPanel } from "@/components/reports/ReportDaysPanel";
import { ReportsOverviewView } from "@/components/reports/ReportsOverviewView";
import {
  dateRangeForOverviewWindow,
  REPORT_OVERVIEW_WINDOWS,
  todayOperatingDateGuess,
  type ReportOverviewWindow,
} from "@/components/reports/reportPeriodKeys";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportsOverviewSearchSchema = z.object({
  window: z.enum(REPORT_OVERVIEW_WINDOWS).optional(),
  daysStart: dateSchema.optional(),
  daysEnd: dateSchema.optional(),
  daysPage: z.coerce.number().int().positive().optional(),
});

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/",
)({
  component: ReportsOverviewRoute,
  validateSearch: reportsOverviewSearchSchema,
});

function ReportsOverviewRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { activeStore } = useGetActiveStore();

  /**
   * Gating the page on the overview query — the same document the header
   * content needs, deduplicated by the Convex client, so no extra read —
   * keeps the report sections from painting at different moments.
   */
  const { data: overview, isInitialLoad } = useStableReportQuery(
    useQuery(
      api.reports.queries.getOverview,
      activeStore?._id ? { storeId: activeStore._id } : "skip",
    ),
  );

  const defaultDaysEnd = isoDateOffset(0);
  const defaultDaysStart = isoDateOffset(-13);
  const daysEnd = search.daysEnd ?? defaultDaysEnd;
  const daysStart = search.daysStart ?? defaultDaysStart;
  const canResetDaysRange =
    daysStart !== defaultDaysStart || daysEnd !== defaultDaysEnd;
  const selectedWindow = search.window ?? "today";
  const overviewAnchorDate =
    overview?.dailyTrend.at(-1)?.operatingDate ?? todayOperatingDateGuess();
  const detailRange = dateRangeForOverviewWindow(
    selectedWindow,
    overviewAnchorDate,
  );

  if (activeStore === null || isInitialLoad) return null;

  return (
    <div className="space-y-layout-xl md:space-y-layout-2xl">
      <ReportsCatalogLookup
        endDate={detailRange.endDate}
        startDate={detailRange.startDate}
      />
      <ReportsOverviewView
        onSelectedWindowChange={(window: ReportOverviewWindow) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              window: window === "today" ? undefined : window,
            }),
          })
        }
        selectedWindow={selectedWindow}
      />
      <ReportDaysPanel
        canResetRange={canResetDaysRange}
        endDate={daysEnd}
        onPageChange={(daysPage) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              daysPage: daysPage === 1 ? undefined : daysPage,
            }),
          })
        }
        onRangeChange={(next) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              daysStart: next.startDate,
              daysEnd: next.endDate,
              daysPage: undefined,
            }),
          })
        }
        onRangeReset={() =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              daysStart: undefined,
              daysEnd: undefined,
              daysPage: undefined,
            }),
          })
        }
        page={search.daysPage ?? 1}
        startDate={daysStart}
      />
    </div>
  );
}
