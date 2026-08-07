import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { animate, cubicBezier, utils } from "animejs";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { LoaderCircle } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";

import { Button } from "@/components/ui/button";
import { FlipNumber } from "@/components/common/FlipNumber";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/states/empty/empty-state";
import { capitalizeWords, cn } from "@/lib/utils";
import type {
  ReportSkuMixData,
  ReportSkuMixRow,
} from "~/shared/reportsContract";
import {
  formatOperatingDate,
  formatReportDateRange,
  formatUnits,
} from "./reportFormat";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
] as const;

const OTHER_SKUS_COLOR = "hsl(var(--muted-foreground) / 0.15)";
const SKU_MIX_TRANSITION_DELAY_MS = 120;
const SKU_MIX_TRANSITION_DURATION_MS = 650;
const SKU_MIX_TRANSITION_EASING = "ease";
const SKU_MIX_EXIT_DURATION_MS = 180;
const SKU_MIX_REDUCED_MOTION_EXIT_DURATION_MS = 120;
const skuMixExitEase = cubicBezier(0.23, 1, 0.32, 1);
const SKU_MIX_EMPTY_ENTRY_DURATION_MS = 180;

function rowColor(row: ReportSkuMixRow, index: number): string {
  return row.key === "other"
    ? OTHER_SKUS_COLOR
    : CHART_COLORS[index % CHART_COLORS.length];
}

function formatShare(shareBasisPoints: number): string {
  const percentage = shareBasisPoints / 100;
  return `${Number.isInteger(percentage) ? percentage : percentage.toFixed(1)}%`;
}

function rowName(row: ReportSkuMixRow): string {
  return row.identity ? capitalizeWords(row.identity.displayName) : row.label;
}

type ReportSkuMixBuildState =
  "preparing" | "waiting_for_data" | "waiting_for_capacity" | "updating";

function buildStatusCopy(state: ReportSkuMixBuildState): {
  announcement: (range: string) => string;
  description: string;
  label: string;
  title: string;
} {
  switch (state) {
    case "waiting_for_capacity":
      return {
        announcement: (range) =>
          `Product mix for ${range} is taking a little longer to prepare`,
        description: "Product mix will appear when it’s ready.",
        label: "Taking a little longer…",
        title: "Taking a little longer",
      };
    case "waiting_for_data":
      return {
        announcement: (range) =>
          `Preparing report data for product mix for ${range}`,
        description: "Product mix will appear when this period is ready.",
        label: "Preparing report data…",
        title: "Preparing report data",
      };
    case "preparing":
      return {
        announcement: (range) => `Preparing product mix for ${range}`,
        description: "Organizing product sales for this period.",
        label: "Preparing…",
        title: "Preparing product mix",
      };
    case "updating":
      return {
        announcement: (range) => `Updating product mix for ${range}`,
        description: "Organizing product sales for this period.",
        label: "Updating…",
        title: "Preparing product mix",
      };
  }
}

export function ReportSkuMixChart({
  building,
  data,
  detailLink,
  errorCorrelationId,
  hasError,
  isNotAvailable,
  isPending,
  isRefreshing,
  onRetry,
  selectedDate,
}: {
  /**
   * The user-perceptible async lifecycle while settled rows stay on screen.
   * Distinct from `isRefreshing` (which also covers instant sync-path swaps):
   * the state names pre-admission waits separately from active folding, while
   * the chart's data labels and legend keep describing the settled range (the
   * `useStableReportQuery` contract).
   */
  building?: {
    endDate: string;
    startDate: string;
    state: ReportSkuMixBuildState;
  };
  data: ReportSkuMixData | undefined;
  detailLink?: {
    orgUrlSlug: string;
    search: Record<string, string>;
    storeUrlSlug: string;
  };
  /** Opaque correlation id of a terminal snapshot error (async path). */
  errorCorrelationId?: string;
  /** Terminal snapshot error: replaces the content with a sanitized alert. */
  hasError?: boolean;
  /** The mix surface is not available for this store (async path). */
  isNotAvailable?: boolean;
  /**
   * A multi-day snapshot is being prepared. Renders a calm status only while
   * nothing has settled yet — retained data keeps the existing quiet
   * `isRefreshing` treatment, never a competing skeleton (R12).
   */
  isPending?: boolean;
  isRefreshing: boolean;
  /** Requests a new fenced attempt for a terminal error, when possible. */
  onRetry?: () => void;
  selectedDate?: string;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const chartMotionRef = useRef<HTMLDivElement | null>(null);
  const legendMotionRef = useRef<HTMLUListElement | null>(null);
  const exitAnimationRef = useRef<ReturnType<typeof animate> | null>(null);
  const emptyStateRef = useRef<HTMLDivElement | null>(null);
  const emptyEntryAnimationRef = useRef<ReturnType<typeof animate> | null>(
    null,
  );
  const hasEnteredViewportRef = useRef(false);
  const renderedDataRef = useRef(data);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);
  const [isPieAnimationArmed, setIsPieAnimationArmed] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [renderedData, setRenderedData] = useState(data);
  const shouldReduceMotion = useReducedMotion();
  const rows = renderedData?.rows ?? [];
  const hasChartData = rows.length > 0;
  // Building reads only over settled content: with nothing rendered yet the
  // dedicated pending block owns the story, and a second affordance would
  // compete with it.
  const isBuilding = building !== undefined && renderedData !== undefined;
  const buildingCopy = building ? buildStatusCopy(building.state) : undefined;
  const showEmptyState = renderedData !== undefined && !hasChartData;
  const isAnimationActive = isPieAnimationArmed && !shouldReduceMotion;
  const isAnimationPending =
    hasChartData &&
    !isPieAnimationArmed &&
    !shouldReduceMotion &&
    typeof IntersectionObserver !== "undefined";
  // "across products", not "sold": this total sums per-SKU rows, so units on
  // non-catalog lines (sale facts with no productSkuId) are excluded here while
  // the overview's day-total tiles include them. The wording keeps the two
  // numbers from claiming to be the same measure.
  const unitsSoldLabel =
    renderedData?.totalUnitsSold === 1
      ? "unit across products"
      : "units across products";
  const chartConfig = Object.fromEntries(
    rows.map((row, index) => [
      row.key,
      {
        label: rowName(row),
        color: rowColor(row, index),
      },
    ]),
  ) satisfies ChartConfig;

  useLayoutEffect(() => {
    if (data === undefined) return;

    const currentData = renderedDataRef.current;
    const currentHasChartData = Boolean(currentData?.rows?.length);
    const nextHasChartData = Boolean(data.rows?.length);
    const chartMotion = chartMotionRef.current;
    const legendMotion = legendMotionRef.current;
    const exitTargets = [chartMotion, legendMotion].filter(
      (target): target is HTMLDivElement | HTMLUListElement => target !== null,
    );

    exitAnimationRef.current?.revert();
    exitAnimationRef.current = null;

    const showNextData = () => {
      renderedDataRef.current = data;
      setRenderedData(data);
      setIsExiting(false);
    };

    const canAnimateExit =
      currentHasChartData &&
      !nextHasChartData &&
      (hasEnteredViewportRef.current ||
        typeof IntersectionObserver === "undefined");

    if (!canAnimateExit || exitTargets.length === 0) {
      showNextData();
      return;
    }

    setIsExiting(true);
    exitAnimationRef.current = animate(exitTargets, {
      duration: shouldReduceMotion
        ? SKU_MIX_REDUCED_MOTION_EXIT_DURATION_MS
        : SKU_MIX_EXIT_DURATION_MS,
      ease: skuMixExitEase,
      opacity: 0,
      scale: shouldReduceMotion ? 1 : 0.96,
      onComplete: showNextData,
    });

    return () => {
      exitAnimationRef.current?.revert();
      exitAnimationRef.current = null;
    };
  }, [data, shouldReduceMotion]);

  useLayoutEffect(() => {
    if (isExiting) return;
    const motionTargets = [
      chartMotionRef.current,
      legendMotionRef.current,
    ].filter(
      (target): target is HTMLDivElement | HTMLUListElement => target !== null,
    );
    utils.set(motionTargets, {
      opacity: 1,
      scale: 1,
    });
  }, [isExiting, renderedData]);

  useLayoutEffect(() => {
    const emptyState = emptyStateRef.current;
    if (!showEmptyState || !emptyState) return;

    emptyEntryAnimationRef.current?.revert();
    utils.set(emptyState, {
      opacity: 0,
      scale: shouldReduceMotion ? 1 : 0.98,
    });
    emptyEntryAnimationRef.current = animate(emptyState, {
      duration: shouldReduceMotion
        ? SKU_MIX_REDUCED_MOTION_EXIT_DURATION_MS
        : SKU_MIX_EMPTY_ENTRY_DURATION_MS,
      ease: skuMixExitEase,
      opacity: 1,
      scale: 1,
      onComplete: () => {
        emptyState.removeAttribute("style");
        emptyEntryAnimationRef.current = null;
      },
    });

    return () => {
      emptyEntryAnimationRef.current?.revert();
      emptyEntryAnimationRef.current = null;
    };
  }, [shouldReduceMotion, showEmptyState]);

  useEffect(() => {
    const root = rootRef.current;
    if (
      !root ||
      shouldReduceMotion ||
      hasEnteredViewportRef.current ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          hasEnteredViewportRef.current ||
          !entries.some((entry) => entry.isIntersecting)
        ) {
          return;
        }
        hasEnteredViewportRef.current = true;
        setHasEnteredViewport(true);
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [shouldReduceMotion]);

  useEffect(() => {
    if (
      shouldReduceMotion ||
      !hasEnteredViewport ||
      !hasChartData ||
      typeof IntersectionObserver === "undefined"
    ) {
      setIsPieAnimationArmed(false);
      return;
    }

    setIsPieAnimationArmed(true);
  }, [hasChartData, hasEnteredViewport, shouldReduceMotion]);

  return (
    <section
      aria-busy={isRefreshing || isBuilding}
      aria-labelledby="report-sku-mix-heading"
      /*
       * `min-h` reserves the panel's settled height across its own state
       * machine (content / pending / empty / error). Without it the content
       * branch unmounting collapses this section to nothing, which drags the
       * days rail below it — a measured 0.21 layout shift on entering the
       * Overview tab. Matches the reservation the legend list already makes.
       */
      className="flex h-full min-h-[26rem] flex-1 flex-col rounded-lg p-layout-md"
      data-animation-active={String(isAnimationActive)}
      data-building={String(isBuilding)}
      data-exiting={String(isExiting)}
      data-testid="report-sku-mix-chart"
      ref={rootRef}
    >
      {/* Lifecycle hierarchy (async multi-day path, matching the Units moved
          sheet's state matrix): terminal error > not available > pending.
          The sync path never sets these, so its behavior is untouched. */}
      {hasError ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-layout-sm py-layout-xl text-center"
          data-testid="report-sku-mix-error"
          role="alert"
        >
          <h4 className="text-sm font-medium text-foreground">
            Product mix could not be prepared
          </h4>
          <p className="max-w-xs text-sm text-muted-foreground">
            Something went wrong while preparing this report. Try again, or
            contact support if the problem continues.
          </p>
          {errorCorrelationId ? (
            <p className="text-xs text-muted-foreground">
              Reference: {errorCorrelationId}
            </p>
          ) : null}
          {onRetry ? (
            <Button className="min-h-11" onClick={onRetry} variant="outline">
              Retry
            </Button>
          ) : null}
        </div>
      ) : isNotAvailable ? (
        <p
          className="flex flex-1 items-center justify-center py-layout-xl text-sm text-muted-foreground"
          data-testid="report-sku-mix-status"
          role="status"
        >
          Product mix is not available for this store.
        </p>
      ) : renderedData === undefined ? (
        // Nothing has settled for any range yet. The expected first
        // multi-day visit after a data change lands here (R12): a calm,
        // designed status rather than a skeleton. The sync path keeps its
        // render-nothing behavior (isPending is never set there).
        isPending ? (
          <div
            className="flex flex-1 items-center justify-center py-layout-xl"
            data-testid="report-sku-mix-pending"
            role="status"
          >
            <div className="flex max-w-xs flex-col items-center text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              </div>
              <p className="mt-layout-md text-sm font-medium text-foreground">
                {buildingCopy?.title ?? "Preparing product mix"}
              </p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                {buildingCopy?.description ??
                  "Organizing product sales for this period."}
              </p>
            </div>
          </div>
        ) : null
      ) : (
        <>
          {/* Building affordance: the donut itself is the loading variant.
              Nothing here participates in layout — the announcement is
              visually hidden and the visual change is a state applied to
              pixels the chart already owns. The text is stable for a given
              target range, so the polite region announces the transition
              once — polls re-render but never mutate it. */}
          {isBuilding && building ? (
            <p
              className="sr-only"
              data-testid="report-sku-mix-building"
              role="status"
            >
              {buildingCopy?.announcement(
                formatReportDateRange(building.startDate, building.endDate),
              )}
            </p>
          ) : null}
          <div
            className="relative grid flex-1 grid-cols-1 content-center gap-layout-xl"
            data-testid="report-sku-mix-content"
          >
            <div className="relative" ref={chartMotionRef}>
              <ChartContainer
                className={cn(
                  "relative z-10 mx-auto aspect-square w-full max-w-96",
                  // Keep the settled geometry legible while its color recedes
                  // behind the in-place loading label. On release, color eases
                  // back from the current on-screen value; reduced motion
                  // swaps states instantly.
                  "transition-[filter,opacity] duration-300 motion-reduce:transition-none",
                  isBuilding && "opacity-80 saturate-50",
                  (!hasChartData || isAnimationPending) && "invisible",
                )}
                config={chartConfig}
                data-testid="report-sku-mix-graphic"
              >
                <PieChart accessibilityLayer>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(_value, _name, item) => {
                          const row = item.payload as ReportSkuMixRow;
                          return (
                            <div className="grid gap-0.5">
                              <span className="font-medium text-foreground">
                                {rowName(row)}
                              </span>
                              <span className="font-numeric tabular-nums text-muted-foreground">
                                {formatUnits(row.unitsSold)} units ·{" "}
                                {formatShare(row.shareBasisPoints)}
                              </span>
                            </div>
                          );
                        }}
                        hideLabel
                      />
                    }
                  />
                  {isAnimationPending || !hasChartData ? null : (
                    <Pie
                      animationBegin={SKU_MIX_TRANSITION_DELAY_MS}
                      animationDuration={SKU_MIX_TRANSITION_DURATION_MS}
                      animationEasing={SKU_MIX_TRANSITION_EASING}
                      cornerRadius={6}
                      data={rows}
                      dataKey="unitsSold"
                      innerRadius="56%"
                      isAnimationActive={isAnimationActive}
                      nameKey="key"
                      outerRadius="94%"
                      paddingAngle={2}
                      stroke="hsl(var(--surface-raised))"
                      strokeWidth={2}
                    >
                      {rows.map((row, index) => (
                        <Cell fill={rowColor(row, index)} key={row.key} />
                      ))}
                    </Pie>
                  )}
                </PieChart>
              </ChartContainer>
              <AnimatePresence initial={false}>
                {isBuilding &&
                hasChartData &&
                building?.state !== "preparing" ? (
                  <motion.div
                    animate={{ opacity: 1, scale: 1 }}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
                    data-testid="report-sku-mix-building-label"
                    exit={{
                      opacity: 0,
                      scale: shouldReduceMotion ? 1 : 0.96,
                    }}
                    initial={{
                      opacity: 0,
                      scale: shouldReduceMotion ? 1 : 0.96,
                    }}
                    transition={{
                      duration: shouldReduceMotion ? 0.12 : 0.18,
                      ease: [0.23, 1, 0.32, 1],
                    }}
                  >
                    <span className="inline-flex translate-y-12 rounded-full border border-border/70 bg-background/85 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
                      {buildingCopy?.label}
                    </span>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <div
                aria-label={`${formatUnits(renderedData.totalUnitsSold)} ${unitsSoldLabel}`}
                className={cn(
                  "pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center",
                  !hasChartData && "invisible",
                )}
                data-testid="report-sku-mix-total"
                role="status"
              >
                <span className="sr-only">
                  {formatUnits(renderedData.totalUnitsSold)} {unitsSoldLabel}
                </span>
                <span className="font-numeric text-3xl font-semibold leading-none tabular-nums text-foreground">
                  <FlipNumber
                    accessible={false}
                    animateChanges={hasChartData}
                    formatValue={formatUnits}
                    reduceMotion={Boolean(shouldReduceMotion)}
                    testId="report-sku-mix-number"
                    transitionFromZero="fade"
                    value={renderedData.totalUnitsSold}
                  />
                </span>
                <span
                  aria-hidden="true"
                  className="mt-1 text-xs text-muted-foreground"
                >
                  {unitsSoldLabel}
                </span>
              </div>
            </div>

            <ul
              aria-label="Product sales legend"
              className={cn(
                "grid min-h-[18.75rem] grid-rows-6 gap-x-layout-lg gap-y-layout-sm sm:min-h-36 sm:grid-cols-2 sm:grid-rows-3",
                !hasChartData && "invisible",
              )}
              data-exiting={String(isExiting)}
              ref={legendMotionRef}
            >
              {rows.map((row, index) => {
                const content = (
                  <>
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      data-testid={`sku-mix-swatch-${row.key}`}
                      style={{
                        backgroundColor: rowColor(row, index),
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {rowName(row)}
                      </p>
                      {row.identity?.sku &&
                      row.identity.sku !== row.identity.displayName ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {row.identity.sku}
                        </p>
                      ) : null}
                    </div>
                    <span className="font-numeric text-sm tabular-nums text-muted-foreground">
                      {formatShare(row.shareBasisPoints)}
                    </span>
                  </>
                );

                return (
                  <li className="min-w-0" key={row.key}>
                    {row.productSkuId && detailLink ? (
                      <Link
                        className="-mx-2 flex min-w-0 items-center gap-layout-sm rounded-md px-2 py-1 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        params={{
                          orgUrlSlug: detailLink.orgUrlSlug,
                          productSkuId: row.productSkuId,
                          storeUrlSlug: detailLink.storeUrlSlug,
                        }}
                        search={detailLink.search}
                        to="/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="flex min-w-0 items-center gap-layout-sm py-1">
                        {content}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {showEmptyState ? (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center py-layout-xl"
                data-motion="enter"
                data-testid={
                  isBuilding
                    ? "report-sku-mix-empty-building"
                    : "report-sku-mix-empty"
                }
                data-transition-duration={SKU_MIX_EMPTY_ENTRY_DURATION_MS}
                ref={emptyStateRef}
              >
                {isBuilding ? (
                  <div
                    aria-hidden="true"
                    className="flex max-w-xs flex-col items-center text-center"
                  >
                    <div className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-4 animate-spin motion-reduce:animate-none"
                      />
                    </div>
                    <p className="mt-layout-md text-sm font-medium text-foreground">
                      {buildingCopy?.title ?? "Preparing product mix"}
                    </p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      {buildingCopy?.description ??
                        "Organizing product sales for this period."}
                    </p>
                  </div>
                ) : (
                  <EmptyState
                    description={
                      selectedDate
                        ? `No product sales were recorded on ${formatOperatingDate(selectedDate)}.`
                        : "No product sales were recorded in this date range."
                    }
                    title="No products sold"
                  />
                )}
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
