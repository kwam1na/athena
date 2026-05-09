import { type ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

export type OperationReviewMetadataEntry = {
  label: string;
  value: ReactNode;
};

type OperationReviewItemCardProps = {
  actionSlot?: ReactNode;
  badgeSlot?: ReactNode;
  collapsedMetadataEntries?: OperationReviewMetadataEntry[];
  contextLabel: string;
  description?: string | null;
  itemId: string;
  metadataEntries?: OperationReviewMetadataEntry[];
  selectionSlot?: ReactNode;
  showCollapsedDescription?: boolean;
  title: string;
};

export function OperationReviewItemCard({
  actionSlot,
  badgeSlot,
  collapsedMetadataEntries,
  contextLabel,
  description,
  itemId,
  metadataEntries = [],
  selectionSlot,
  showCollapsedDescription = true,
  title,
}: OperationReviewItemCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasMetadata = metadataEntries.length > 0;
  const summaryEntries =
    collapsedMetadataEntries ?? metadataEntries.slice(0, 4);
  const detailsId = `operation-review-item-details-${itemId.replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  )}`;

  return (
    <article className="rounded-lg border border-border/80 bg-surface-raised p-layout-md shadow-surface transition-[border-color,box-shadow] hover:border-border">
      <div className="flex flex-col gap-layout-md md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-layout-sm">
          {selectionSlot}
          <div className="min-w-0 space-y-layout-xs">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {contextLabel}
              </p>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-layout-md gap-y-layout-xs">
              <p className="font-medium text-foreground">{title}</p>
              {badgeSlot}
              {description && showCollapsedDescription ? (
                <p className="text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
          {actionSlot}
          {hasMetadata ? (
            <Button
              aria-controls={detailsId}
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded((current) => !current)}
              size="sm"
              type="button"
              variant="utility"
            >
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "transition-transform",
                  isExpanded && "rotate-180",
                )}
              />
              {isExpanded ? "Hide details" : "Show details"}
            </Button>
          ) : null}
        </div>
      </div>

      {summaryEntries.length > 0 && !isExpanded ? (
        <dl className="mt-layout-sm grid gap-x-layout-lg gap-y-layout-sm border-t border-border/70 pt-layout-sm text-sm sm:grid-cols-2 lg:grid-cols-4">
          {summaryEntries.map((entry) => (
            <div key={`${itemId}-summary-${entry.label}`} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{entry.label}</dt>
              <dd className="mt-1 truncate font-medium text-foreground">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {description && !showCollapsedDescription && isExpanded ? (
        <p className="mt-layout-sm border-t border-border/70 pt-layout-sm text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}

      {hasMetadata && isExpanded ? (
        <dl
          className={cn(
            "grid gap-layout-md border-t border-border/70 pt-layout-md text-sm md:grid-cols-3",
            description && !showCollapsedDescription
              ? "mt-layout-sm"
              : "mt-layout-md",
          )}
          id={detailsId}
        >
          {metadataEntries.map((entry) => (
            <div key={`${itemId}-${entry.label}`}>
              <dt className="text-xs text-muted-foreground">{entry.label}</dt>
              <dd className="mt-1 font-medium text-foreground">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}
