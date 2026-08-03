import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

import { EmptyState } from "@/components/states/empty/empty-state";
import { FlipText } from "@/components/common/FlipNumber";
import { ReportsWeeklyView } from "@/components/reports/ReportsWeeklyView";
import { formatReportDateRange } from "@/components/reports/reportFormat";
import { reportsWeeklySearchSchema } from "@/components/reports/reportRouteSearch";
import { useReportsSharedDemoMode } from "@/components/reports/useReportsSharedDemoMode";
import { useStableReportQuery } from "@/components/reports/useStableReportQuery";
import { createSharedDemoWeeklyBriefing } from "@/components/shared-demo/sharedDemoReportsFixture";
import { weeklyLifecycleLabel } from "@/components/reports/weeklyReportPresentation";
import { Button } from "@/components/ui/button";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";

export { reportsWeeklySearchSchema } from "@/components/reports/reportRouteSearch";

function traceWeeklyHistoryMotion(
  phase: "start" | "frame" | "complete",
  latest?: Record<string, string | number>,
) {
  if (!import.meta.env.DEV) return;

  const region = document.querySelector<HTMLElement>(
    '[data-testid="weekly-history-motion-region"]',
  );
  const netSales = document.querySelector<HTMLElement>(
    '[data-testid="weekly-net-sales-value"]',
  );

  console.debug("[Weekly history motion]", {
    phase,
    gridTemplateRows: latest?.gridTemplateRows,
    opacity: latest?.opacity,
    regionHeight: region?.getBoundingClientRect().height,
    netSalesTop: netSales?.getBoundingClientRect().top,
  });
}

function WeeklyStatusRow({
  action,
  status,
}: {
  action?: React.ReactNode;
  status: string;
}) {
  return (
    <div
      className="flex flex-wrap items-start justify-between gap-layout-sm"
      data-motion="flip"
      data-testid="weekly-summary-entry"
    >
      <p
        aria-live="polite"
        className="text-sm text-muted-foreground"
        data-testid="weekly-status"
      >
        <FlipText delayMs={200} testId="weekly-status-value" value={status} />
      </p>
      {action}
    </div>
  );
}

function unavailableWeeklyCopy(reason: string | null) {
  if (reason === "capability_disabled") {
    return {
      title: "Weekly report unavailable",
      description: "Weekly reporting has not been enabled for this store.",
    };
  }
  if (reason === "missing_schedule") {
    return {
      title: "Store hours needed",
      description:
        "Add a Store hours schedule before Athena can determine this reporting week.",
    };
  }
  if (reason === "missing_timezone") {
    return {
      title: "Store time zone needed",
      description:
        "Set the Store hours time zone before Athena can determine this reporting week.",
    };
  }
  if (reason === "no_scheduled_dates") {
    return {
      title: "No scheduled dates",
      description:
        "This reporting week has no operational dates. Review Store hours to make a date operational.",
    };
  }
  return {
    title: "Weekly report is materializing",
    description:
      "Athena is preparing the store's first weekly projection. Check again after reporting activity finishes materializing.",
  };
}

/**
 * The shared demo has no accepted weeks: a browser fixture has no register
 * close to accept, so `createSharedDemoWeeklyBriefing` returns a live
 * week-to-date projection with a `null` accepted baseline. History is
 * therefore legitimately empty and already exhausted — not pending — so the
 * drawer shows its empty state instead of a spinner and no cursor page fires.
 */
const SHARED_DEMO_WEEKLY_HISTORY = {
  page: [] as never[],
  isDone: true,
  continueCursor: "",
};

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/weekly",
)({
  component: ReportsWeeklyRoute,
  validateSearch: reportsWeeklySearchSchema,
});

export function ReportsWeeklyRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const { activeStore } = useGetActiveStore();
  const selectedReportId = search.reportId;

  // One projection query at a time: active OR selected historical detail.
  // History starts only when the operator opens the selector, keeping Weekly
  // at a maximum of two compact Reports subscriptions.
  const { isSharedDemo, useLiveQuery } = useReportsSharedDemoMode();
  const liveActive = useQuery(
    api.reports.queries.getActiveWeeklyBriefing,
    activeStore?._id && !selectedReportId && useLiveQuery
      ? { storeId: activeStore._id }
      : "skip",
  );
  const demoActive = useMemo(
    () =>
      isSharedDemo && !selectedReportId
        ? createSharedDemoWeeklyBriefing()
        : undefined,
    [isSharedDemo, selectedReportId],
  );
  const active = isSharedDemo ? demoActive : liveActive;
  const liveSelectedDetail = useQuery(
    api.reports.queries.getAcceptedWeeklyDetail,
    activeStore?._id && selectedReportId && useLiveQuery
      ? { storeId: activeStore._id, reportId: selectedReportId }
      : "skip",
  );
  // A pasted `reportId` in the demo names a week that cannot exist: settle it
  // as absent so the route renders its "unavailable" state rather than
  // waiting forever on a read that was never opened.
  const selectedDetail = isSharedDemo
    ? selectedReportId
      ? null
      : undefined
    : liveSelectedDetail;
  const liveHistory = useQuery(
    api.reports.queries.listAcceptedWeeklyHistory,
    activeStore?._id && search.history && useLiveQuery
      ? {
        storeId: activeStore._id,
        paginationOpts: {
          cursor: search.historyCursor ?? null,
          numItems: 12,
        },
      }
      : "skip",
  );
  const history: typeof liveHistory = isSharedDemo
    ? search.history
      ? SHARED_DEMO_WEEKLY_HISTORY
      : undefined
    : liveHistory;
  const stableActive = useStableReportQuery(active, "active");
  const stableDetail = useStableReportQuery(
    selectedDetail,
    selectedReportId ? `history:${selectedReportId}` : undefined,
  );
  const stable = selectedReportId ? stableDetail : stableActive;

  /**
   * The polite region has to exist before the first result lands, otherwise
   * the "loading" announcement is inserted with the region itself and screen
   * readers never hear it. Rendering only the region keeps the initial paint
   * as quiet as the other Reports routes.
   */
  if (
    activeStore === null ||
    stable.isInitialLoad ||
    stable.data === undefined
  ) {
    return (
      <div className="space-y-layout-xl md:space-y-layout-2xl">
        <WeeklyStatusRow status="Loading reporting week..." />
      </div>
    );
  }

  const report = selectedReportId
    ? (stableDetail.data ?? null)
    : stableActive.data?.status === "available"
      ? (stableActive.data.acceptedBaseline ?? stableActive.data.current)
      : null;
  const historyEntries = history?.page ?? [];
  const historyCursorTrail = search.historyCursorTrail ?? [];
  const unavailableReason =
    !selectedReportId && stableActive.data?.status === "unavailable"
      ? stableActive.data.reason
      : null;
  const unavailableCopy = unavailableWeeklyCopy(unavailableReason);
  const weeklyStatus = stable.isRefreshing
    ? "Loading reporting week..."
    : report
      ? "Reporting week " +
      formatReportDateRange(report.cycleStartDate, report.cycleEndDate, {
        includeWeekday: true,
      }) +
      ". " +
      weeklyLifecycleLabel(report) +
      "."
      : unavailableReason === "missing_projection"
        ? "Weekly reporting is materializing."
        : "Weekly reporting is unavailable.";

  return (
    <div className="space-y-layout-xl md:space-y-layout-2xl">
      {/*
        The settled announcement names the reporting dates and lifecycle in
        its own words. The visible briefing already prints the plain range,
        so this region uses the weekday-qualified form rather than repeating
        on-screen text verbatim.
      */}
      <WeeklyStatusRow
        action={
          <Button
            aria-expanded={search.history === true}
            className="h-control-standard"
            onClick={() =>
              void navigate({
                search: (current) => ({
                  ...current,
                  history: current.history ? undefined : true,
                  historyCursor: undefined,
                  historyCursorTrail: undefined,
                }),
              })
            }
            variant="outline"
          >
            {search.history ? "Close history" : "Weekly history"}
          </Button>
        }
        status={weeklyStatus}
      />

      <div>
        <AnimatePresence>
          {search.history ? (
            <motion.div
              animate={{
                gridTemplateRows: "1fr",
                opacity: 1,
              }}
              className="grid"
              data-testid="weekly-history-motion-region"
              exit={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { gridTemplateRows: "0fr", opacity: 0 }
              }
              initial={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { gridTemplateRows: "0fr", opacity: 0 }
              }
              key="weekly-report-history"
              onAnimationComplete={() => traceWeeklyHistoryMotion("complete")}
              onAnimationStart={() => traceWeeklyHistoryMotion("start")}
              onUpdate={(latest) => traceWeeklyHistoryMotion("frame", latest)}
              transition={
                prefersReducedMotion
                  ? { duration: 0.15, ease: "easeOut" }
                  : {
                    gridTemplateRows: {
                      bounce: 0,
                      duration: 0.3,
                      type: "spring",
                    },
                    opacity: { duration: 0.18, ease: "easeOut" },
                  }
              }
            >
              <div
                className="min-h-0 overflow-hidden"
                data-testid="weekly-history-motion-content"
              >
                <section
                  aria-label="Weekly report history"
                  className="border-y border-border py-layout-md"
                >
                  {history === undefined ? (
                    <p className="text-sm text-muted-foreground">
                      Loading weekly history.
                    </p>
                  ) : historyEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No accepted weeks yet.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-layout-sm">
                      {historyEntries.map((entry) => (
                        <Button
                          aria-pressed={entry.reportId === selectedReportId}
                          className="h-control-standard"
                          key={entry.reportId}
                          onClick={() =>
                            void navigate({
                              search: (current) => ({
                                ...current,
                                reportId: entry.reportId,
                              }),
                            })
                          }
                          variant={
                            entry.reportId === selectedReportId
                              ? "default"
                              : "outline"
                          }
                        >
                          {formatReportDateRange(
                            entry.cycleStartDate,
                            entry.cycleEndDate,
                          )}
                        </Button>
                      ))}
                    </div>
                  )}
                  {historyCursorTrail.length > 0 ||
                    (history && !history.isDone && history.continueCursor) ? (
                    <div className="mt-layout-md flex flex-wrap gap-layout-sm">
                      {historyCursorTrail.length > 0 ? (
                        <Button
                          className="h-control-standard"
                          onClick={() =>
                            void navigate({
                              search: (current) => {
                                const trail = current.historyCursorTrail ?? [];
                                const previousCursor = trail.at(-1) ?? null;
                                const remainingTrail = trail.slice(0, -1);
                                return {
                                  ...current,
                                  history: true,
                                  historyCursor: previousCursor ?? undefined,
                                  historyCursorTrail:
                                    remainingTrail.length > 0
                                      ? remainingTrail
                                      : undefined,
                                };
                              },
                            })
                          }
                          variant="outline"
                        >
                          Newer accepted weeks
                        </Button>
                      ) : null}
                      {history && !history.isDone && history.continueCursor ? (
                        <Button
                          className="h-control-standard"
                          onClick={() =>
                            void navigate({
                              search: (current) => ({
                                ...current,
                                history: true,
                                historyCursor: history.continueCursor,
                                historyCursorTrail: [
                                  ...(current.historyCursorTrail ?? []),
                                  current.historyCursor ?? null,
                                ],
                              }),
                            })
                          }
                          variant="outline"
                        >
                          Older accepted weeks
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </section>
                <div
                  aria-hidden="true"
                  className="h-layout-xl md:h-layout-2xl"
                />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {report ? (
          <ReportsWeeklyView report={report} />
        ) : (
          <EmptyState
            description={
              selectedReportId
                ? "This accepted reporting week is no longer available. Choose another week from history."
                : unavailableCopy.description
            }
            title={
              selectedReportId
                ? "Accepted week unavailable"
                : unavailableCopy.title
            }
          />
        )}
      </div>
    </div>
  );
}
