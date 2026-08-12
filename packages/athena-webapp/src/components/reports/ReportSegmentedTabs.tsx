import * as React from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const ReportSegmentedTabsList = React.forwardRef<
  React.ElementRef<typeof TabsList>,
  Omit<React.ComponentPropsWithoutRef<typeof TabsList>, "size">
>(({ className, ...props }, ref) => (
  <TabsList
    className={cn(
      "h-auto flex-wrap justify-start gap-1 border border-border bg-surface-raised p-1 text-muted-foreground shadow-surface",
      className,
    )}
    ref={ref}
    size="sm"
    {...props}
  />
));
ReportSegmentedTabsList.displayName = "ReportSegmentedTabsList";

const ReportSegmentedTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsTrigger>,
  Omit<React.ComponentPropsWithoutRef<typeof TabsTrigger>, "size">
>(({ className, ...props }, ref) => (
  <TabsTrigger
    className={cn(
      "min-h-8 px-3 data-[state=active]:bg-primary-soft data-[state=active]:text-primary data-[state=active]:shadow-none",
      className,
    )}
    ref={ref}
    size="sm"
    {...props}
  />
));
ReportSegmentedTabsTrigger.displayName = "ReportSegmentedTabsTrigger";

export { ReportSegmentedTabsList, ReportSegmentedTabsTrigger };
