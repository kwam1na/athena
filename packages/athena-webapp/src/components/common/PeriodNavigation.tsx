import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

/** Shared controls; callers own period arithmetic, labels, and availability. */
export function PeriodNavigation({
  compact = false,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  previousDisabled = false,
  nextDisabled = false,
}: {
  compact?: boolean;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  const buttonClassName = cn(
    "shrink-0 active:bg-accent active:transition-none",
    compact ? "h-8 w-8" : "h-10 w-10",
  );

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        aria-label={previousLabel}
        className={buttonClassName}
        disabled={previousDisabled}
        onClick={onPrevious}
        size="icon"
        type="button"
        variant="outline"
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
      </Button>
      <Button
        aria-label={nextLabel}
        className={buttonClassName}
        disabled={nextDisabled}
        onClick={onNext}
        size="icon"
        type="button"
        variant="outline"
      >
        <ChevronRight aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );
}
