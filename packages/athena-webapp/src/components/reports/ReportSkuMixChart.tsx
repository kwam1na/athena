import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate, cubicBezier, utils } from "animejs";
import { useReducedMotion } from "framer-motion";
import { Cell, Pie, PieChart } from "recharts";

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
import { formatOperatingDate, formatUnits } from "./reportFormat";

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

export function ReportSkuMixChart({
  data,
  isRefreshing,
  selectedDate,
}: {
  data: ReportSkuMixData | undefined;
  isRefreshing: boolean;
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
  const showEmptyState = renderedData !== undefined && !hasChartData;
  const isAnimationActive = isPieAnimationArmed && !shouldReduceMotion;
  const isAnimationPending =
    hasChartData &&
    !isPieAnimationArmed &&
    !shouldReduceMotion &&
    typeof IntersectionObserver !== "undefined";
  const unitsSoldLabel =
    renderedData?.totalUnitsSold === 1 ? "unit sold" : "units sold";
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
      aria-busy={isRefreshing}
      aria-labelledby="report-sku-mix-heading"
      className="flex h-full flex-1 flex-col rounded-lg p-layout-md"
      data-animation-active={String(isAnimationActive)}
      data-exiting={String(isExiting)}
      data-testid="report-sku-mix-chart"
      ref={rootRef}
    >
      {renderedData === undefined ? null : (
        <div
          className="relative grid flex-1 grid-cols-1 content-center gap-layout-xl"
          data-testid="report-sku-mix-content"
        >
          <div className="relative" ref={chartMotionRef}>
            <ChartContainer
              className={cn(
                "relative z-10 mx-auto aspect-square h-auto max-h-96 w-full",
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
                  skipAnimationFromZero
                  testId="report-sku-mix-number"
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
              "grid min-h-[18.75rem] gap-x-layout-lg gap-y-layout-sm sm:min-h-36 sm:grid-cols-2",
              !hasChartData && "invisible",
            )}
            data-exiting={String(isExiting)}
            ref={legendMotionRef}
          >
            {rows.map((row, index) => (
              <li
                className="flex min-w-0 items-center gap-layout-sm"
                key={row.key}
              >
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
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {row.identity.sku}
                    </p>
                  ) : null}
                </div>
                <span className="font-numeric text-sm tabular-nums text-muted-foreground">
                  {formatShare(row.shareBasisPoints)}
                </span>
              </li>
            ))}
          </ul>
          {showEmptyState ? (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center py-layout-xl"
              data-motion="enter"
              data-testid="report-sku-mix-empty"
              data-transition-duration={SKU_MIX_EMPTY_ENTRY_DURATION_MS}
              ref={emptyStateRef}
            >
              <EmptyState
                description={
                  selectedDate
                    ? `No product sales were recorded on ${formatOperatingDate(selectedDate)}.`
                    : "No product sales were recorded in this date range."
                }
                title="No products sold"
              />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
