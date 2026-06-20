import { Link } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

type OperationsSummaryMetricLink = {
  ariaLabel: string;
  orgUrlSlug: string;
  search?: Record<string, string>;
  storeUrlSlug: string;
  to: string;
};

function buildParams(
  orgUrlSlug: string,
  storeUrlSlug: string,
  params?: Record<string, string>,
) {
  return {
    ...(params ?? {}),
    orgUrlSlug,
    storeUrlSlug,
  };
}

function formatDeltaPercent(value: number) {
  if (!Number.isFinite(value) || value === 0) return "In line";

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value}%`;
}

function getDeltaPercent(currentValue: number, priorValue: number) {
  if (priorValue === 0) return 0;

  return Math.round(((currentValue - priorValue) / priorValue) * 100);
}

export function formatOperationsMetricComparison({
  currentValue,
  priorValue,
  priorWindowLabel,
}: {
  currentValue?: number | null;
  priorValue?: number | null;
  priorWindowLabel: string;
}) {
  if (!priorValue) return `None ${priorWindowLabel}`;

  const deltaPercent = getDeltaPercent(currentValue ?? 0, priorValue);
  const hasTrend = deltaPercent !== 0;
  const trendClassName = hasTrend
    ? deltaPercent > 0
      ? "text-success"
      : "text-destructive"
    : "text-muted-foreground";
  const TrendIcon = deltaPercent > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={cn("inline-flex items-center gap-1", trendClassName)}>
        {hasTrend ? <TrendIcon aria-hidden="true" className="h-3 w-3" /> : null}
        <span>{formatDeltaPercent(deltaPercent)}</span>
      </span>{" "}
      <span>vs {priorWindowLabel}</span>
    </span>
  );
}

export function formatOperationsMetricHelper({
  currentValue,
  detail,
  priorValue,
  priorWindowLabel,
}: {
  currentValue?: number | null;
  detail: ReactNode;
  priorValue?: number | null;
  priorWindowLabel: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
      <span>{detail}</span>
      <span aria-hidden="true" className="text-muted-foreground/70">
        ·
      </span>
      {formatOperationsMetricComparison({
        currentValue,
        priorValue,
        priorWindowLabel,
      })}
    </span>
  );
}

export function OperationsSummaryMetric({
  className,
  helper,
  helperClassName,
  label,
  labelClassName,
  link,
  tone = "default",
  value,
  valueClassName,
}: {
  className?: string;
  helper?: ReactNode;
  helperClassName?: string;
  label: string;
  labelClassName?: string;
  link?: OperationsSummaryMetricLink;
  tone?: "default" | "quiet";
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface shadow-surface",
        tone === "quiet"
          ? "px-layout-md py-layout-md"
          : "px-layout-md py-layout-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-layout-sm">
        <p
          className={cn(
            "font-medium uppercase text-muted-foreground",
            tone === "quiet"
              ? "text-[11px] tracking-[0.16em]"
              : "text-xs tracking-wide",
            labelClassName,
          )}
        >
          {label}
        </p>
        {link ? (
          <Button
            asChild
            aria-label={link.ariaLabel}
            className="-mr-1 -mt-1 h-7 w-7"
            size="icon"
            variant="ghost"
          >
            <Link
              params={buildParams(link.orgUrlSlug, link.storeUrlSlug)}
              search={link.search}
              to={link.to}
            >
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-1 tabular-nums text-foreground",
          tone === "quiet"
            ? "text-base font-medium leading-7"
            : "font-numeric text-2xl",
          valueClassName,
        )}
      >
        {value}
      </p>
      {helper ? (
        <p
          className={cn(
            "mt-1 text-xs leading-5 text-muted-foreground",
            helperClassName,
          )}
        >
          {helper}
        </p>
      ) : null}
    </div>
  );
}
