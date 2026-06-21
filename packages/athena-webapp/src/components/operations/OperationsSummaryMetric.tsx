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
  ariaPressed,
  className,
  disabled,
  helper,
  helperClassName,
  label,
  labelClassName,
  link,
  onClick,
  tone = "default",
  value,
  valueClassName,
}: {
  ariaPressed?: boolean;
  className?: string;
  disabled?: boolean;
  helper?: ReactNode;
  helperClassName?: string;
  label: string;
  labelClassName?: string;
  link?: OperationsSummaryMetricLink;
  onClick?: () => void;
  tone?: "default" | "quiet";
  value: ReactNode;
  valueClassName?: string;
}) {
  const content = (
    <>
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
            "mt-1 whitespace-nowrap text-xs leading-5 text-muted-foreground [&>span]:flex-nowrap",
            helperClassName,
          )}
        >
          {helper}
        </p>
      ) : null}
    </>
  );
  const rootClassName = cn(
    "min-w-max rounded-lg border border-border bg-surface shadow-surface",
    tone === "quiet" ? "px-layout-md py-layout-md" : "px-layout-md py-layout-sm",
    onClick
      ? "block w-full text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default disabled:hover:bg-surface"
      : null,
    className,
  );

  if (onClick) {
    return (
      <button
        aria-pressed={ariaPressed}
        className={rootClassName}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div className={rootClassName}>
      {content}
    </div>
  );
}
