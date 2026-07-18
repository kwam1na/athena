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
  className?: string;
  collapsedMetadataEntries?: OperationReviewMetadataEntry[];
  combinedHeading?: ReactNode;
  contextIcon?: ReactNode;
  contextLabel: string;
  contextLabelClassName?: string;
  description?: string | null;
  detailsSlot?: ReactNode;
  headerActionSlot?: ReactNode;
  itemId: string;
  metadataEntries?: OperationReviewMetadataEntry[];
  presentation?: "card" | "list";
  selectionSlot?: ReactNode;
  showCollapsedDescription?: boolean;
  stackDescription?: boolean;
  title: ReactNode;
};

export function OperationReviewItemCard({
  actionSlot,
  badgeSlot,
  className,
  collapsedMetadataEntries,
  combinedHeading,
  contextIcon,
  contextLabel,
  contextLabelClassName,
  description,
  detailsSlot,
  headerActionSlot,
  itemId,
  metadataEntries = [],
  presentation = "card",
  selectionSlot,
  showCollapsedDescription = true,
  stackDescription = false,
  title,
}: OperationReviewItemCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDetails = metadataEntries.length > 0 || Boolean(detailsSlot);
  const summaryEntries =
    collapsedMetadataEntries ?? metadataEntries.slice(0, 4);
  const detailsId = `operation-review-item-details-${itemId.replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  )}`;
  const detailsToggle = hasDetails ? (
    <Button
      aria-controls={detailsId}
      aria-expanded={isExpanded}
      className={cn(
        presentation === "list" &&
          "border-transparent bg-transparent px-2 text-muted-foreground transition-[color,background-color,transform] duration-fast ease-standard active:scale-[0.98] hover:bg-background hover:text-foreground motion-reduce:transform-none motion-reduce:transition-none",
      )}
      onClick={() => setIsExpanded((current) => !current)}
      size="sm"
      type="button"
      variant="utility"
    >
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "transition-transform duration-fast ease-standard motion-reduce:transition-none",
          isExpanded && "rotate-180",
        )}
      />
      {isExpanded ? "Hide details" : "Show details"}
    </Button>
  ) : null;

  return (
    <article
      className={cn(
        "relative overflow-hidden",
        presentation === "card" &&
          "rounded-lg border border-border/80 bg-surface-raised p-layout-md shadow-surface transition-[border-color,box-shadow] duration-standard ease-standard hover:border-border",
        presentation === "list" &&
          cn(
            "border-b border-border/70 px-layout-md py-layout-lg transition-colors duration-fast ease-standard last:border-b-0",
            isExpanded
              ? "bg-muted/20"
              : "bg-transparent hover:bg-muted/15",
          ),
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-col md:flex-row md:justify-between",
          presentation === "card"
            ? "gap-layout-md md:items-start"
            : "gap-layout-sm md:items-center",
        )}
      >
        <div className="flex min-w-0 gap-layout-sm">
          {selectionSlot}
          <div className="min-w-0 flex-1 space-y-layout-xs">
            {combinedHeading ? null : (
              <div className="flex flex-wrap items-center gap-2">
                {contextIcon}
                <p
                  className={cn(
                    "text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground",
                    contextLabelClassName,
                  )}
                >
                  {contextLabel}
                </p>
              </div>
            )}
            <div
              className={cn(
                "flex gap-y-layout-xs",
                stackDescription
                  ? "flex-col items-start"
                  : "flex-wrap items-baseline gap-x-layout-md",
              )}
            >
              <p className="font-medium leading-6 text-foreground">
                {combinedHeading ?? title}
              </p>
              {description && showCollapsedDescription ? (
                <p className="text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            {actionSlot ? (
              <div className="flex flex-wrap items-center gap-2 pt-layout-xs">
                {actionSlot}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
          {badgeSlot}
          {headerActionSlot}
          {detailsToggle}
        </div>
      </div>

      {summaryEntries.length > 0 && !isExpanded ? (
        <dl
          className={cn(
            "grid gap-x-layout-lg gap-y-layout-sm border-t border-border/60 text-sm sm:grid-cols-2 lg:grid-cols-4",
            presentation === "list"
              ? "mt-layout-md pt-layout-md"
              : "mt-layout-sm pt-layout-sm",
          )}
        >
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

      {metadataEntries.length > 0 && isExpanded ? (
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

      {detailsSlot && isExpanded ? (
        <div className="mt-layout-md border-t border-border/70 pt-layout-md">
          {detailsSlot}
        </div>
      ) : null}
    </article>
  );
}
