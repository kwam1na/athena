import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

function formatDeltaPercent(value: number) {
  if (!Number.isFinite(value) || value === 0) return "In line";

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value}%`;
}

function getDeltaPercent(currentValue: number, priorValue: number) {
  if (priorValue === 0) return 0;

  return Math.round(((currentValue - priorValue) / priorValue) * 100);
}

function formatMissingComparisonLabel(priorWindowLabel: string) {
  if (priorWindowLabel === "yesterday") return "No activity yesterday";
  if (priorWindowLabel === "prior day") return "No activity on prior day";

  return `No activity for ${priorWindowLabel}`;
}

export function formatOperationsMetricComparison({
  currentValue,
  deltaPercent,
  missingComparisonLabel,
  priorValue,
  priorWindowLabel,
}: {
  currentValue?: number | null;
  deltaPercent?: number | null;
  missingComparisonLabel?: ReactNode;
  priorValue?: number | null;
  priorWindowLabel: string;
}) {
  if (!priorValue) {
    return (
      missingComparisonLabel ?? formatMissingComparisonLabel(priorWindowLabel)
    );
  }

  const normalizedDeltaPercent =
    deltaPercent ?? getDeltaPercent(currentValue ?? 0, priorValue);
  const hasTrend = normalizedDeltaPercent !== 0;
  const trendClassName = hasTrend
    ? normalizedDeltaPercent > 0
      ? "text-success"
      : "text-destructive"
    : "text-muted-foreground";
  const TrendIcon = normalizedDeltaPercent > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={cn("inline-flex items-baseline gap-1", trendClassName)}>
        {hasTrend ? (
          <TrendIcon
            aria-hidden="true"
            className="h-3 w-3 translate-y-[0.125em]"
          />
        ) : null}
        <span>{formatDeltaPercent(normalizedDeltaPercent)}</span>
      </span>{" "}
      <span>vs {priorWindowLabel}</span>
    </span>
  );
}

export function formatOperationsMetricHelper({
  currentValue,
  detail,
  missingComparisonLabel,
  priorValue,
  priorWindowLabel,
  showComparison = true,
}: {
  currentValue?: number | null;
  detail: ReactNode;
  missingComparisonLabel?: ReactNode;
  priorValue?: number | null;
  priorWindowLabel: string;
  showComparison?: boolean;
}) {
  if (!showComparison) return <span>{detail}</span>;

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
      <span>{detail}</span>
      <span aria-hidden="true" className="text-muted-foreground/70">
        ·
      </span>
      {formatOperationsMetricComparison({
        currentValue,
        missingComparisonLabel,
        priorValue,
        priorWindowLabel,
      })}
    </span>
  );
}
