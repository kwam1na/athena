import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
} from "@/lib/operations/operatingDate";
import { formatReportDateRange } from "./reportFormat";
import { ReportCalendar } from "./ReportCalendar";

/** A compact, atomic date-range control shared by report views. */
export function ReportDateRangeField({
  align = "end",
  endDate,
  label = "Date range",
  onSelect,
  startDate,
}: {
  align?: "start" | "center" | "end";
  endDate: string;
  label?: string;
  onSelect: (next: { startDate: string; endDate: string }) => void;
  startDate: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedStart = getLocalDateFromOperatingDate(startDate) ?? new Date();
  const selectedEnd = getLocalDateFromOperatingDate(endDate) ?? selectedStart;
  const selectedRange = { from: selectedStart, to: selectedEnd };
  const [draftRange, setDraftRange] = useState<DateRange>(selectedRange);
  const rangeLabel = formatReportDateRange(startDate, endDate);

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setIsOpen(nextOpen);
        if (nextOpen) setDraftRange(selectedRange);
      }}
      open={isOpen}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={`Change ${label.toLowerCase()}, currently ${rangeLabel}`}
          className="h-auto justify-start gap-2 px-layout-sm py-layout-xs text-sm font-normal text-muted-foreground shadow-surface"
          variant="outline"
        >
          <CalendarIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="shrink-0">{label}</span>
          <span className="font-medium text-foreground">{rangeLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0">
        <ReportCalendar
          defaultMonth={selectedRange.from}
          mode="range"
          onSelect={(range) => {
            if (!range) return;
            setDraftRange(range);
            if (!range.from || !range.to) return;
            onSelect({
              startDate: getLocalOperatingDate(range.from),
              endDate: getLocalOperatingDate(range.to),
            });
            setIsOpen(false);
          }}
          selected={draftRange}
        />
      </PopoverContent>
    </Popover>
  );
}
