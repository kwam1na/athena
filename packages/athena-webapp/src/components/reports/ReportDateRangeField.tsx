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
import {
  dateRangeForOverviewWindow,
  REPORT_DATE_RANGE_PRESET_WINDOWS,
  REPORT_OVERVIEW_WINDOW_LABELS,
} from "./reportPeriodKeys";

type DateRangeValue = { startDate: string; endDate: string };

function getDateRangePresets(today: Date) {
  const endDate = getLocalOperatingDate(today);
  return REPORT_DATE_RANGE_PRESET_WINDOWS.map((window) => ({
    label: REPORT_OVERVIEW_WINDOW_LABELS[window],
    range: dateRangeForOverviewWindow(window, endDate),
  })) satisfies Array<{ label: string; range: DateRangeValue }>;
}

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
  const presets = getDateRangePresets(new Date());

  const applyRange = (range: DateRangeValue) => {
    onSelect(range);
    setIsOpen(false);
  };

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
        <div>
          <ReportCalendar
            defaultMonth={selectedRange.from}
            mode="range"
            onSelect={(range) => {
              if (!range) return;
              setDraftRange(range);
              if (!range.from || !range.to) return;
              applyRange({
                startDate: getLocalOperatingDate(range.from),
                endDate: getLocalOperatingDate(range.to),
              });
            }}
            selected={draftRange}
          />
          <div
            aria-label="Preset date ranges"
            className="grid grid-cols-2 gap-1 border-t border-border p-2"
            role="group"
          >
            {presets.map((preset) => {
              const isSelected =
                preset.range.startDate === startDate &&
                preset.range.endDate === endDate;

              return (
                <Button
                  aria-pressed={isSelected}
                  className="justify-start px-2.5 text-xs"
                  key={preset.label}
                  onClick={() => applyRange(preset.range)}
                  size="sm"
                  type="button"
                  variant={isSelected ? "primary-soft" : "ghost"}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
