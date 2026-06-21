import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
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
        ) : (
          <span aria-hidden="true" className="-mr-1 -mt-1 h-7 w-7 shrink-0" />
        )}
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
