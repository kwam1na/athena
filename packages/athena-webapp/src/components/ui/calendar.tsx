import * as React from "react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={cn("bg-background p-3", className)}
      classNames={{
        months: "flex flex-col gap-4 sm:flex-row sm:gap-4",
        month: "space-y-4",
        caption: "relative flex items-center justify-center pt-1",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        nav_button: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground w-8 rounded-md text-[0.8rem] font-normal",
        row: "mt-2 flex w-full",
        cell: cn(
          "relative h-8 w-8 p-0 text-center text-sm focus-within:relative focus-within:z-20",
          props.mode === "range"
            ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md [&:has(>.day-range-middle)]:bg-accent"
            : "[&:has([aria-selected])]:bg-accent [&:has([aria-selected])]:rounded-md"
        ),
        day: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-8 w-8 p-0 font-normal aria-selected:opacity-100"
        ),
        day_range_start: "day-range-start",
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside: "text-muted-foreground opacity-50",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "day-range-middle aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ className, orientation, ...iconProps }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon
                className={cn("h-4 w-4", className)}
                {...iconProps}
              />
            );
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("h-4 w-4", className)}
                {...iconProps}
              />
            );
          }

          return (
            <ChevronDownIcon className={cn("h-4 w-4", className)} {...iconProps} />
          );
        },
        ...components,
      }}
      {...props}
    />
  );
}

const CalendarDayButton = Button;

export { Calendar, CalendarDayButton };
