import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";

import {
  getLocalDateFromOperatingDate,
  getOperatingClockNow,
} from "@/lib/operations/operatingDate";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { PeriodNavigation } from "./PeriodNavigation";

function formatDate(date?: Date, fallback = "Not available") {
  return (
    date?.toLocaleDateString([], {
      day: "numeric",
      month: "long",
      weekday: "long",
      year: "numeric",
    }) ?? fallback
  );
}

export interface OperatingDatePickerProps {
  /** ISO calendar date (YYYY-MM-DD); the caller owns navigation and data loading. */
  operatingDate: string;
  onChange?: (date: Date) => void;
  disabled?: boolean;
  /** Inclusive upper bound, defaulting to today. */
  latestSelectableDate?: Date;
  className?: string;
}

/** A controlled calendar picker with adjacent-day navigation. */
export function OperatingDatePicker({
  className,
  disabled = false,
  latestSelectableDate: latestSelectableDateProp,
  operatingDate,
  onChange,
}: OperatingDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = getLocalDateFromOperatingDate(operatingDate);
  const today = getOperatingClockNow();
  const latestSelectableDate =
    latestSelectableDateProp ??
    new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const previousDate = selectedDate
    ? new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate() - 1,
      )
    : undefined;
  const nextDate = selectedDate
    ? new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate() + 1,
      )
    : undefined;
  const navigationDisabled = disabled || !onChange || !selectedDate;
  const canMoveNext = Boolean(nextDate && nextDate <= latestSelectableDate);

  return (
    <div
      aria-label="Operating date navigation"
      className={cn("flex min-w-0 items-center gap-1", className)}
      role="group"
    >
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            aria-label={`Change operating date, currently ${formatDate(selectedDate, operatingDate)}`}
            className="h-auto min-w-0 flex-1 justify-start rounded-lg px-layout-md py-layout-sm text-sm font-normal text-muted-foreground shadow-surface sm:flex-initial"
            disabled={disabled || !onChange}
            type="button"
            variant="outline"
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            <span className="shrink-0">Operating date</span>
            <span className="min-w-0 truncate font-medium text-foreground">
              {formatDate(selectedDate, operatingDate)}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            defaultMonth={selectedDate ?? latestSelectableDate}
            disabled={{ after: latestSelectableDate }}
            mode="single"
            onSelect={(date) => {
              if (!date) return;

              onChange?.(date);
              setIsOpen(false);
            }}
            selected={selectedDate}
          />
        </PopoverContent>
      </Popover>
      <PeriodNavigation
        previousLabel={`Previous day, ${formatDate(previousDate)}`}
        previousDisabled={navigationDisabled || !previousDate}
        onPrevious={() => previousDate && onChange?.(previousDate)}
        nextLabel={
          canMoveNext
            ? `Next day, ${formatDate(nextDate)}`
            : "Next day unavailable"
        }
        nextDisabled={navigationDisabled || !canMoveNext}
        onNext={() => nextDate && onChange?.(nextDate)}
      />
    </div>
  );
}
