import type { ComponentProps } from "react";

import { Calendar } from "@/components/ui/calendar";

type CalendarProps = ComponentProps<typeof Calendar>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type ReportCalendarProps = DistributiveOmit<CalendarProps, "endMonth">;

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function clampToToday(value: Date | undefined, today: Date): Date | undefined {
  return value && value > today ? today : value;
}

/** Reports never include dates after the operator's current calendar day. */
export function ReportCalendar({
  defaultMonth,
  disabled,
  month,
  ...props
}: ReportCalendarProps) {
  const today = startOfLocalDay(new Date());
  const futureDates = { after: today };
  const disabledDates = disabled
    ? Array.isArray(disabled)
      ? [...disabled, futureDates]
      : [disabled, futureDates]
    : futureDates;
  const calendarProps = {
    ...props,
    defaultMonth: clampToToday(defaultMonth, today),
    disabled: disabledDates,
    endMonth: today,
    month: clampToToday(month, today),
  } as CalendarProps;

  return <Calendar {...calendarProps} />;
}
