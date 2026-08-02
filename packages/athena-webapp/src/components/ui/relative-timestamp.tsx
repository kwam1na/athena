import { cn, formatAbsoluteTimestamp, getRelativeTime } from "@/lib/utils";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

export type RelativeTimestampProps = {
  className?: string;
  fallback?: string;
  precision?: "datetime" | "date";
  prefix?: string;
  value: number | null | undefined;
};

/**
 * Relative time label ("5 minutes ago") that reveals the full date on hover.
 * The machine-readable `dateTime` attribute carries the absolute value.
 */
export function RelativeTimestamp({
  className,
  fallback = "—",
  precision = "datetime",
  prefix,
  value,
}: RelativeTimestampProps) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={className}>{fallback}</span>;
  }

  const relativeTimestamp = getRelativeTime(value);
  const absoluteTimestamp = formatAbsoluteTimestamp(value, precision);
  const label = prefix ? `${prefix} ${relativeTimestamp}` : relativeTimestamp;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <time
            className={cn("cursor-default", className)}
            dateTime={new Date(value).toISOString()}
          >
            {label}
          </time>
        </TooltipTrigger>
        <TooltipContent className="px-2 py-1 text-xs">
          {absoluteTimestamp}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
