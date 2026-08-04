import { useMutation, useQuery } from "convex/react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowDown, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getOrigin } from "@/lib/navigationUtils";
import { ListPagination } from "@/components/common/ListPagination";
import { useStableReportQuery } from "./useStableReportQuery";
import { useReportsSharedDemoMode } from "./useReportsSharedDemoMode";
import {
  createSharedDemoReportDays,
  createSharedDemoReportMixLifecycle,
  createSharedDemoReportSkuMix,
} from "@/components/shared-demo/sharedDemoReportsFixture";
import {
  inclusiveOperatingDaySpan,
  REPORT_SKU_MIX_SYNC_MAX_DAYS,
  type ReportMixLifecycle,
} from "~/shared/reportsContract";
import { EmptyState } from "@/components/states/empty/empty-state";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { ReportDateRangeField } from "./ReportDateRangeField";
import {
  formatOperatingDate,
  formatReportMoney,
  formatUnits,
} from "./reportFormat";
import { ReportSkuMixChart } from "./ReportSkuMixChart";
import {
  ReportUnitsMovedChartSheet,
  type ReportUnitsMovedTab,
  type ReportUnitsMovedFocusSurface,
} from "./ReportUnitsMovedChartSheet";

const REPORT_DAYS_PAGE_SIZE = 14;

/** The latest mix ensure/retry outcome (see the sheet's EnsureOutcome). */
type MixEnsureOutcome = {
  requestKey: string | null;
  lifecycle: ReportMixLifecycle;
};

function pageContainingDate(
  daysNewestFirst: Array<{ operatingDate: string }>,
  operatingDate: string,
): number | undefined {
  const dateIndex = daysNewestFirst.findIndex(
    (day) => day.operatingDate === operatingDate,
  );
  return dateIndex < 0
    ? undefined
    : Math.floor(dateIndex / REPORT_DAYS_PAGE_SIZE) + 1;
}

/**
 * Day overview: `listDays` stays scoped to the stable table range while the
 * selected range controls emphasis and the product mix. An optional day
 * selection temporarily narrows both to one operating date. The date link
 * opens the Items view scoped to that day's `d:` period key (via
 * `periodType`/`periodDate`, see `reports/items/index.tsx`).
 */
export function ReportDaysPanel({
  canResetRange,
  startDate,
  endDate,
  tableStartDate,
  tableEndDate,
  onRangeChange,
  onRangeReset,
  onSelectedDateChange,
  isUnitsSheetOpen,
  onUnitsSheetOpenChange,
  onUnitsSheetPageChange,
  onUnitsSheetRestoreComplete,
  onUnitsSheetSkuLinkNavigate,
  onUnitsSheetTabChange,
  unitsSheetPage,
  unitsSheetRestoreFocusSkuId,
  unitsSheetRestoreFocusSurface,
  unitsSheetRestoreScrollOffset,
  unitsSheetTab,
  onPageChange,
  page,
  selectedDate,
}: {
  canResetRange: boolean;
  startDate: string;
  endDate: string;
  tableStartDate: string;
  tableEndDate: string;
  onRangeChange: (
    next: { startDate: string; endDate: string },
    targetPage: number,
  ) => void;
  onRangeReset: () => void;
  onSelectedDateChange: (date: string | undefined) => void;
  isUnitsSheetOpen?: boolean;
  onUnitsSheetOpenChange?: (open: boolean) => void;
  onUnitsSheetPageChange?: (page: number) => void;
  onUnitsSheetRestoreComplete?: () => void;
  onUnitsSheetSkuLinkNavigate?: (context: {
    endDate: string;
    focusSurface: ReportUnitsMovedFocusSurface;
    productSkuId: string;
    scrollOffset?: number;
    startDate: string;
  }) => void | Promise<void>;
  onUnitsSheetTabChange?: (tab: ReportUnitsMovedTab) => void;
  unitsSheetPage?: number;
  unitsSheetRestoreFocusSkuId?: string;
  unitsSheetRestoreFocusSurface?: ReportUnitsMovedFocusSurface;
  unitsSheetRestoreScrollOffset?: number;
  unitsSheetTab?: ReportUnitsMovedTab;
  onPageChange: (page: number) => void;
  page: number;
  selectedDate?: string;
}) {
  const { activeStore } = useGetActiveStore();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const pendingRangeStart = useRef<string | null>(null);
  const { isSharedDemo, useLiveQuery } = useReportsSharedDemoMode();
  const liveDays = useQuery(
    api.reports.queries.listDays,
    activeStore?._id && useLiveQuery
      ? {
          storeId: activeStore._id,
          startDate: tableStartDate,
          endDate: tableEndDate,
        }
      : "skip",
  );
  const demoDays = useMemo(
    () =>
      isSharedDemo
        ? createSharedDemoReportDays({
            startDate: tableStartDate,
            endDate: tableEndDate,
          })
        : undefined,
    [isSharedDemo, tableEndDate, tableStartDate],
  );
  const {
    data: days,
    dataContext: settledDaysPage,
    isInitialLoad,
    isRefreshing,
  } = useStableReportQuery(isSharedDemo ? demoDays : liveDays, page);
  const skuMixContext = useMemo(
    () => ({ endDate, selectedDate, startDate }),
    [endDate, selectedDate, startDate],
  );
  const skuMixStartDate = selectedDate ?? startDate;
  const skuMixEndDate = selectedDate ?? endDate;
  /**
   * Span routing (U5): selections of at most `REPORT_SKU_MIX_SYNC_MAX_DAYS`
   * inclusive days — every day click, the dominant ambient interaction — stay
   * on the synchronous `listRangeSkuMix` reader forever. Provably safe: the
   * fold bounds `reportSkuDay` at 2,000 rows per operating day, so a 2-day
   * span reads at most 4,000 rows, strictly under the reader's 5,000-row cap
   * (see the constant's provability comment in shared/reportsContract.ts).
   * Longer spans use the admitted snapshot lifecycle instead, whose 184-day
   * ceiling the server enforces via `REPORT_RANGE_MAX_DAYS_BY_KIND.sku_mix`;
   * ambient browsing therefore never consumes async admission budget.
   */
  const isSyncMixSpan =
    inclusiveOperatingDaySpan(skuMixStartDate, skuMixEndDate) <=
    REPORT_SKU_MIX_SYNC_MAX_DAYS;
  const storeId = activeStore?._id;
  const liveSkuMix = useQuery(
    api.reports.queries.listRangeSkuMix,
    storeId && useLiveQuery && isSyncMixSpan
      ? {
          storeId,
          startDate: skuMixStartDate,
          endDate: skuMixEndDate,
        }
      : "skip",
  );

  /**
   * Multi-day poll-then-subscribe, mirroring ReportUnitsMovedChartSheet:
   * idempotent ensure on range change; while the outcome is
   * waiting/backpressure (no durable row) re-call ensure after the
   * server-supplied interval on a single unmount-cancelled timer; once a
   * requestKey lands, the `getMixRangeVisible` subscription owns the
   * lifecycle. Demo mode never reaches here (client gate; the server denies
   * demo generation independently).
   */
  const [mixAdmission, setMixAdmission] = useState<
    MixEnsureOutcome | undefined
  >(undefined);
  const [mixEnsureFailed, setMixEnsureFailed] = useState(false);
  const ensureMixRange = useMutation(api.reports.skuMixRange.ensureMixRange);
  const retryMixRange = useMutation(api.reports.skuMixRange.retryMixRange);
  const asyncMixEnabled = Boolean(!isSyncMixSpan && storeId && useLiveQuery);

  useEffect(() => {
    if (!asyncMixEnabled || !storeId) return;
    let cancelled = false;
    setMixAdmission(undefined);
    setMixEnsureFailed(false);
    ensureMixRange({
      storeId,
      startDate: skuMixStartDate,
      endDate: skuMixEndDate,
    }).then(
      (result) => {
        if (!cancelled) setMixAdmission(result);
      },
      () => {
        if (!cancelled) setMixEnsureFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    asyncMixEnabled,
    ensureMixRange,
    skuMixEndDate,
    skuMixStartDate,
    storeId,
  ]);

  const mixAdmissionLifecycle = mixAdmission?.lifecycle;
  useEffect(() => {
    if (!asyncMixEnabled || !storeId) return;
    if (
      mixAdmissionLifecycle?.state !== "waiting" &&
      mixAdmissionLifecycle?.state !== "backpressure"
    ) {
      return;
    }
    let cancelled = false;
    // The timer belongs to this effect instance — unmounting or changing the
    // range clears it, and a StrictMode double effect cleans up its first
    // timer before arming the second, so timers never stack.
    const timer = window.setTimeout(() => {
      ensureMixRange({
        storeId,
        startDate: skuMixStartDate,
        endDate: skuMixEndDate,
      }).then(
        (result) => {
          if (!cancelled) setMixAdmission(result);
        },
        () => {
          if (!cancelled) setMixEnsureFailed(true);
        },
      );
    }, mixAdmissionLifecycle.retryAfterMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    asyncMixEnabled,
    ensureMixRange,
    mixAdmissionLifecycle,
    skuMixEndDate,
    skuMixStartDate,
    storeId,
  ]);

  const mixRequestKey = mixAdmission?.requestKey ?? null;
  const liveMixVisible = useQuery(
    api.reports.skuMixRange.getMixRangeVisible,
    asyncMixEnabled && storeId && mixRequestKey
      ? { storeId, requestKey: mixRequestKey }
      : "skip",
  );
  const mixLifecycle: ReportMixLifecycle | undefined = asyncMixEnabled
    ? (liveMixVisible?.lifecycle ?? mixAdmissionLifecycle)
    : undefined;
  /** Completed snapshots only — a lifecycle state is never settled data. */
  const asyncMixData =
    asyncMixEnabled &&
    liveMixVisible?.lifecycle.state === "completed" &&
    liveMixVisible.data
      ? liveMixVisible.data
      : undefined;

  const demoSkuMix = useMemo(
    () =>
      isSharedDemo
        ? isSyncMixSpan
          ? createSharedDemoReportSkuMix({
              startDate: skuMixStartDate,
              endDate: skuMixEndDate,
            })
          : // Demo multi-day mix (U6): an immediately-completed lifecycle
            // wrapping the same fixture computation the sync path uses.
            createSharedDemoReportMixLifecycle({
              startDate: skuMixStartDate,
              endDate: skuMixEndDate,
            }).data
        : undefined,
    [isSharedDemo, isSyncMixSpan, skuMixEndDate, skuMixStartDate],
  );
  // Both paths feed the SAME settled seam, so the `{data, dataContext}` pair
  // always describes the range the on-screen rows came from, whichever path
  // served it — the Units moved sheet's range source depends on this.
  const {
    data: skuMix,
    dataContext: settledSkuMixContext,
    isRefreshing: isSkuMixRefreshing,
  } = useStableReportQuery(
    isSharedDemo ? demoSkuMix : isSyncMixSpan ? liveSkuMix : asyncMixData,
    skuMixContext,
  );

  const isMixTerminalError =
    asyncMixEnabled &&
    (mixEnsureFailed || mixLifecycle?.state === "terminal_error");
  const mixErrorCorrelationId =
    mixLifecycle?.state === "terminal_error"
      ? mixLifecycle.correlationId
      : undefined;
  const isMixNotAvailable =
    asyncMixEnabled &&
    !mixEnsureFailed &&
    mixLifecycle?.state === "not_available";
  const isMixPending =
    asyncMixEnabled &&
    !isMixTerminalError &&
    !isMixNotAvailable &&
    (mixLifecycle === undefined ||
      mixLifecycle.state === "waiting" ||
      mixLifecycle.state === "backpressure" ||
      mixLifecycle.state === "queued_pending");
  const mixBuildState =
    mixLifecycle?.state === "backpressure"
      ? ("waiting_for_capacity" as const)
      : mixLifecycle?.state === "waiting"
        ? ("waiting_for_data" as const)
        : mixLifecycle?.state === "queued_pending"
          ? ("updating" as const)
          : ("preparing" as const);
  /**
   * The async lifecycle, seen with settled rows already on screen. Preserve
   * the prior chart while naming whether the next range is being prepared,
   * waiting on report data, waiting to enter the queue, or actively folding.
   * The sync path never sets this, so day clicks stay untouched.
   */
  const mixBuildingRange = useMemo(
    () =>
      isMixPending
        ? {
            endDate: skuMixEndDate,
            startDate: skuMixStartDate,
            state: mixBuildState,
          }
        : undefined,
    [isMixPending, mixBuildState, skuMixEndDate, skuMixStartDate],
  );

  const handleMixRetry = async () => {
    if (!storeId || !mixRequestKey) return;
    try {
      const result = await retryMixRange({
        storeId,
        requestKey: mixRequestKey,
      });
      setMixAdmission(result);
      setMixEnsureFailed(false);
    } catch {
      setMixEnsureFailed(true);
    }
  };
  const settledUnitsStartDate =
    settledSkuMixContext?.selectedDate ??
    settledSkuMixContext?.startDate ??
    skuMixStartDate;
  const settledUnitsEndDate =
    settledSkuMixContext?.selectedDate ??
    settledSkuMixContext?.endDate ??
    skuMixEndDate;
  const daysNewestFirst = days
    ? [...days].sort((left, right) =>
        right.operatingDate.localeCompare(left.operatingDate),
      )
    : days;
  const totalDays = daysNewestFirst?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalDays / REPORT_DAYS_PAGE_SIZE));
  const displayPage = isRefreshing ? (settledDaysPage ?? page) : page;
  const currentPage = Math.min(displayPage, pageCount);
  const visibleDays = daysNewestFirst?.slice(
    (currentPage - 1) * REPORT_DAYS_PAGE_SIZE,
    currentPage * REPORT_DAYS_PAGE_SIZE,
  );
  const placeholderRowCount = Math.max(
    0,
    REPORT_DAYS_PAGE_SIZE - (visibleDays?.length ?? 0),
  );
  const isSelectedDay = (operatingDate: string) =>
    selectedDate === operatingDate;
  const isInSelectedRange = (operatingDate: string) =>
    operatingDate >= startDate && operatingDate <= endDate;
  const selectDay = (operatingDate: string) => {
    onSelectedDateChange(
      isSelectedDay(operatingDate) ? undefined : operatingDate,
    );
  };

  useEffect(() => {
    const targetDate = pendingRangeStart.current;
    if (!targetDate || !daysNewestFirst || isRefreshing) return;

    const targetPage = pageContainingDate(daysNewestFirst, targetDate);
    pendingRangeStart.current = null;
    if (targetPage !== undefined && targetPage !== page) {
      onPageChange(targetPage);
    }
  }, [daysNewestFirst, isRefreshing, onPageChange, page]);

  return (
    <section className="space-y-layout-sm" data-testid="report-days-panel">
      <div className="flex flex-wrap items-center justify-end gap-layout-xs">
        {canResetRange || selectedDate !== undefined ? (
          <Button
            aria-label={
              selectedDate !== undefined
                ? "Return to selected date range"
                : "Reset date range to default"
            }
            className="h-auto gap-2 px-layout-sm py-layout-xs text-sm font-normal text-muted-foreground"
            onClick={() => {
              if (selectedDate !== undefined) {
                onSelectedDateChange(undefined);
                return;
              }
              onRangeReset();
            }}
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            {selectedDate !== undefined ? "Show selected range" : "Reset range"}
          </Button>
        ) : null}
        <ReportDateRangeField
          endDate={endDate}
          onSelect={(next) => {
            const targetPage = pageContainingDate(
              daysNewestFirst ?? [],
              next.startDate,
            );
            pendingRangeStart.current =
              targetPage === undefined ? next.startDate : null;
            onRangeChange(next, targetPage ?? 1);
          }}
          startDate={startDate}
        />
      </div>
      {/* Nothing until the first result settles: these queries resolve fast
          enough that a skeleton appears and vanishes as a flash of its own.
          Refreshes keep the previous data on screen (see useStableReportQuery),
          so this branch is only ever the very first load. */}
      {isInitialLoad ||
      daysNewestFirst === undefined ? null : daysNewestFirst.length === 0 ? (
        <EmptyState
          title="No days in range"
          description="Choose a different date range."
        />
      ) : (
        <div
          className="grid items-stretch gap-layout-3xl lg:grid-cols-2"
          data-testid="report-days-content-grid"
        >
          <div className="flex min-w-0 flex-col gap-layout-sm">
            <div>
              <h3
                className="text-base font-medium text-foreground"
                data-testid="report-days-heading"
                id="report-days-heading"
              >
                Days
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Net sales and units sold by operating date
              </p>
            </div>
            <div
              aria-busy={isRefreshing}
              aria-labelledby="report-days-heading"
              className={cn(
                "flex-1 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface",
                "transition-opacity duration-150 motion-reduce:transition-none",
                isRefreshing && "opacity-60",
              )}
              data-refreshing={isRefreshing ? "true" : undefined}
              data-testid="report-days-table-card"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead aria-sort="descending">
                      <span className="inline-flex items-center gap-1">
                        Date
                        <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                      </span>
                    </TableHead>
                    <TableHead className="text-right">Net sales</TableHead>
                    <TableHead className="text-right">Units sold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDays?.map((day) => {
                    const isSelected = isSelectedDay(day.operatingDate);
                    const isHighlighted = selectedDate
                      ? isSelected
                      : isInSelectedRange(day.operatingDate);
                    const isDeemphasized = !isHighlighted;

                    return (
                      <TableRow
                        aria-label={`${isSelected ? "Clear day selection for" : "Show products sold for"} ${formatOperatingDate(day.operatingDate)}`}
                        aria-pressed={isSelected}
                        className={cn(
                          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          "transition-[background-color,color,opacity] duration-150 motion-reduce:transition-none",
                          isDeemphasized &&
                            "opacity-40 hover:opacity-70 focus-visible:opacity-100",
                        )}
                        data-deemphasized={isDeemphasized ? "true" : undefined}
                        data-highlighted={isHighlighted ? "true" : undefined}
                        data-status={day.status}
                        key={day.operatingDate}
                        onClick={(event) => {
                          const target = event.target;
                          if (
                            target instanceof Element &&
                            target.closest("a")
                          ) {
                            return;
                          }
                          selectDay(day.operatingDate);
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.target !== event.currentTarget ||
                            (event.key !== "Enter" && event.key !== " ")
                          ) {
                            return;
                          }
                          event.preventDefault();
                          selectDay(day.operatingDate);
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <TableCell>
                          <Link
                            className={cn(
                              isHighlighted && "font-medium text-foreground",
                            )}
                            params={{
                              orgUrlSlug: orgUrlSlug!,
                              storeUrlSlug: storeUrlSlug!,
                            }}
                            search={{
                              periodType: "day",
                              periodDate: day.operatingDate,
                              // Carries the current URL so the items workspace
                              // can offer a way back to this day list.
                              o: getOrigin(),
                            }}
                            to="/$orgUrlSlug/store/$storeUrlSlug/reports/items"
                          >
                            {formatOperatingDate(day.operatingDate)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-numeric tabular-nums">
                          {formatReportMoney(day.netSalesMinor, day.currency)}
                        </TableCell>
                        <TableCell className="text-right font-numeric tabular-nums">
                          {formatUnits(day.unitsSold)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {Array.from({ length: placeholderRowCount }, (_, index) => (
                    <TableRow
                      aria-hidden="true"
                      className="invisible pointer-events-none"
                      data-testid="report-day-placeholder-row"
                      key={`placeholder-${index}`}
                    >
                      <TableCell>{"\u00a0"}</TableCell>
                      <TableCell>{"\u00a0"}</TableCell>
                      <TableCell>{"\u00a0"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ListPagination
                onPageChange={onPageChange}
                page={currentPage}
                pageCount={pageCount}
                pageSize={REPORT_DAYS_PAGE_SIZE}
                totalItems={totalDays}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-layout-sm">
            <div
              className="flex flex-wrap items-start justify-between gap-layout-sm"
              data-testid="report-products-sold-header"
            >
              <div className="min-w-0 flex-1">
                <h3
                  className="text-base font-medium text-foreground"
                  id="report-sku-mix-heading"
                >
                  Products sold
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedDate
                    ? `Share of units sold on ${formatOperatingDate(selectedDate)}`
                    : "Share of units sold by product in this date range"}
                </p>
              </div>
              <ReportUnitsMovedChartSheet
                activeTab={unitsSheetTab}
                currency={activeStore?.currency ?? "USD"}
                granularPage={unitsSheetPage}
                isOpen={isUnitsSheetOpen}
                onActiveTabChange={onUnitsSheetTabChange}
                onGranularPageChange={onUnitsSheetPageChange}
                onOpenChange={onUnitsSheetOpenChange}
                onRestoreComplete={onUnitsSheetRestoreComplete}
                onSkuLinkNavigate={onUnitsSheetSkuLinkNavigate}
                orgUrlSlug={orgUrlSlug!}
                restoreFocusSkuId={unitsSheetRestoreFocusSkuId}
                restoreFocusSurface={unitsSheetRestoreFocusSurface}
                restoreScrollOffset={unitsSheetRestoreScrollOffset}
                periodEndDate={settledUnitsEndDate}
                periodStartDate={settledUnitsStartDate}
                scrollContextKey={`overview:${orgUrlSlug}:${storeUrlSlug}:${settledUnitsStartDate}:${settledUnitsEndDate}`}
                storeUrlSlug={storeUrlSlug!}
              />
            </div>
            <ReportSkuMixChart
              building={mixBuildingRange}
              data={skuMix}
              detailLink={
                orgUrlSlug && storeUrlSlug
                  ? {
                      orgUrlSlug,
                      search: settledSkuMixContext?.selectedDate
                        ? {
                            o: getOrigin(),
                            periodDate: settledSkuMixContext.selectedDate,
                            periodType: "day",
                          }
                        : {
                            endDate: settledSkuMixContext?.endDate ?? endDate,
                            o: getOrigin(),
                            startDate:
                              settledSkuMixContext?.startDate ?? startDate,
                          },
                      storeUrlSlug,
                    }
                  : undefined
              }
              errorCorrelationId={mixErrorCorrelationId}
              hasError={isMixTerminalError}
              isNotAvailable={isMixNotAvailable}
              isPending={isMixPending}
              isRefreshing={isSkuMixRefreshing}
              onRetry={mixRequestKey ? handleMixRetry : undefined}
              selectedDate={settledSkuMixContext?.selectedDate}
            />
          </div>
        </div>
      )}
    </section>
  );
}
