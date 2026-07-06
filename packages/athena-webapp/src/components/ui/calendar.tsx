import * as React from "react"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import {
  DayButton,
  DayPicker,
  getDefaultClassNames,
  type ChevronProps,
  type DayButtonProps,
  type WeekNumberProps,
} from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"

type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: CalendarProps) {
  const defaultClassNames = getDefaultClassNames()
  const resolvedClassNames = {
    root: cn("w-fit", defaultClassNames.root),
    months: cn(
      "relative flex flex-col gap-4 md:flex-row",
      defaultClassNames.months
    ),
    month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
    nav: "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
    button_previous: cn(
      buttonVariants({ variant: buttonVariant }),
      "h-[--cell-size] w-[--cell-size] select-none p-0 aria-disabled:opacity-50"
    ),
    button_next: cn(
      buttonVariants({ variant: buttonVariant }),
      "h-[--cell-size] w-[--cell-size] select-none p-0 aria-disabled:opacity-50"
    ),
    month_caption:
      "flex h-[--cell-size] w-full items-center justify-center px-[--cell-size]",
    dropdowns:
      "flex h-[--cell-size] w-full items-center justify-center gap-1.5 text-sm font-medium",
    dropdown_root:
      "has-focus:border-ring border-input shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] relative rounded-md border",
    dropdown: cn(
      "has-focus:border-ring border-input shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] relative rounded-md border",
      "bg-popover"
    ),
    caption_label: cn(
      "select-none font-medium",
      captionLayout === "label"
        ? "text-sm"
        : "[&>svg]:text-muted-foreground flex h-8 items-center gap-1 rounded-md pl-2 pr-1 text-sm [&>svg]:size-3.5"
    ),
    month_grid: "w-full border-collapse",
    weekdays: "flex",
    weekday:
      "text-muted-foreground flex-1 select-none rounded-md text-[0.8rem] font-normal",
    week: "mt-2 flex w-full",
    week_number: "text-muted-foreground select-none text-[0.8rem]",
    week_number_header: "w-[--cell-size] select-none",
    day: cn(
      buttonVariants({ variant: "ghost" }),
      "data-[selected-single=true]:bg-action-workflow data-[selected-single=true]:text-action-workflow-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-action-workflow data-[range-start=true]:text-action-workflow-foreground data-[range-end=true]:bg-action-workflow data-[range-end=true]:text-action-workflow-foreground flex aspect-square h-auto w-full min-w-[--cell-size] flex-col gap-1 font-normal leading-none data-[range-end=true]:rounded-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md [&>span]:text-xs [&>span]:opacity-70"
    ),
    range_start: "bg-accent rounded-l-md",
    range_middle: "rounded-none",
    range_end: "bg-accent rounded-r-md",
    today:
      "bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none",
    outside: "text-muted-foreground aria-selected:text-muted-foreground",
    disabled: "text-muted-foreground opacity-50",
    hidden: "invisible",
    ...classNames,
  } as NonNullable<CalendarProps["classNames"]>

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-background group/calendar p-3 [--cell-size:2rem] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-nav_button_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-nav_button_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date: Date) =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={resolvedClassNames}
      components={{
        WeekNumber: ({ week, ...props }: WeekNumberProps) => {
          return (
            <th {...props}>
              <div className="flex size-[--cell-size] items-center justify-center text-center">
                {week.weekNumber}
              </div>
            </th>
          )
        },
        DayButton: CalendarDayButton,
        Chevron: CalendarChevron,
        ...components,
      } as CalendarProps["components"]}
      {...props}
    />
  )
}

function CalendarChevron({
  className,
  orientation,
  ...props
}: ChevronProps) {
  if (orientation === "left") {
    return <ChevronLeftIcon className={cn("size-4", className)} {...props} />
  }

  if (orientation === "right") {
    return <ChevronRightIcon className={cn("size-4", className)} {...props} />
  }

  return <ChevronDownIcon className={cn("size-4", className)} {...props} />
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: DayButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      data-day={day?.date?.toLocaleDateString()}
      data-selected-single={
        modifiers?.selected &&
        !modifiers?.range_start &&
        !modifiers?.range_end &&
        !modifiers?.range_middle
      }
      data-range-start={modifiers?.range_start}
      data-range-end={modifiers?.range_end}
      data-range-middle={modifiers?.range_middle}
      className={cn(resolvedDayClassName, className)}
      asChild
    >
      <DayButton day={day} modifiers={modifiers} {...props} />
    </Button>
  )
}

const resolvedDayClassName = cn(
  buttonVariants({ variant: "ghost" }),
  "data-[selected-single=true]:bg-action-workflow data-[selected-single=true]:text-action-workflow-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-action-workflow data-[range-start=true]:text-action-workflow-foreground data-[range-end=true]:bg-action-workflow data-[range-end=true]:text-action-workflow-foreground flex aspect-square h-auto w-full min-w-[--cell-size] flex-col gap-1 font-normal leading-none data-[range-end=true]:rounded-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md [&>span]:text-xs [&>span]:opacity-70"
)

export { Calendar, CalendarDayButton }
