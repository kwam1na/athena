import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Cell, Pie, PieChart } from "recharts";

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
import { formatUnits } from "./reportFormat";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
] as const;

const OTHER_SKUS_COLOR = "hsl(var(--muted-foreground) / 0.15)";

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
  return row.identity
    ? capitalizeWords(row.identity.displayName)
    : row.label;
}

export function ReportSkuMixChart({
  data,
  isRefreshing,
}: {
  data: ReportSkuMixData | undefined;
  isRefreshing: boolean;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const hasEnteredViewportRef = useRef(false);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const rows = data?.rows ?? [];
  const isAnimationActive = hasEnteredViewport && !shouldReduceMotion;
  const isAnimationPending =
    !hasEnteredViewport &&
    !shouldReduceMotion &&
    typeof IntersectionObserver !== "undefined";
  const chartConfig = Object.fromEntries(
    rows.map((row, index) => [
      row.key,
      {
        label: rowName(row),
        color: rowColor(row, index),
      },
    ]),
  ) satisfies ChartConfig;

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

  return (
    <section
      aria-busy={isRefreshing}
      aria-labelledby="report-sku-mix-heading"
      className="flex h-full flex-1 flex-col rounded-lg p-layout-md"
      data-animation-active={String(isAnimationActive)}
      data-testid="report-sku-mix-chart"
      ref={rootRef}
    >
      {data === undefined ? null : rows.length === 0 ? (
        <div className="py-layout-xl">
          <EmptyState
            description="No product sales were recorded in this date range."
            title="No products sold"
          />
        </div>
      ) : (
        <div
          className="grid flex-1 grid-cols-1 content-center gap-layout-xl"
          data-testid="report-sku-mix-content"
        >
          <div className="relative">
            <ChartContainer
              className={cn(
                "relative z-10 mx-auto aspect-square h-auto max-h-96 w-full",
                isAnimationPending && "invisible",
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
                <Pie
                  cornerRadius={6}
                  data={rows}
                  dataKey="unitsSold"
                  innerRadius="56%"
                  isAnimationActive={isAnimationActive}
                  key={isAnimationActive ? "animated" : "static"}
                  nameKey="key"
                  outerRadius="94%"
                  paddingAngle={2}
                  stroke="hsl(var(--surface-raised))"
                  strokeWidth={2}
                >
                  {rows.map((row, index) => (
                    <Cell
                      fill={rowColor(row, index)}
                      key={row.key}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div
              className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center"
              data-testid="report-sku-mix-total"
            >
              <span className="font-numeric text-3xl font-semibold tabular-nums text-foreground">
                {formatUnits(data.totalUnitsSold)}
              </span>
              <span className="text-xs text-muted-foreground">units sold</span>
            </div>
          </div>

          <ul
            aria-label="Product sales legend"
            className="grid gap-x-layout-lg gap-y-layout-sm sm:grid-cols-2"
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
        </div>
      )}
    </section>
  );
}
