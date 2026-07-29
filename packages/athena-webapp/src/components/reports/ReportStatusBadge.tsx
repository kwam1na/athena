import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReportDayStatus } from "~/shared/reportsContract";
import { reportDayStatusPresentation } from "./reportFormat";

// Tone → class mapping follows the same bg/10-text convention used for
// status pills elsewhere in the app (see registerSessionColumns.tsx /
// RegisterSessionView.tsx's `getStatusBadgeClass`).
const TONE_CLASS_NAME: Record<string, string> = {
  neutral: "border-transparent bg-muted text-muted-foreground",
  notice: "border-transparent bg-warning/15 text-warning",
  warning: "border-transparent bg-destructive/10 text-destructive",
  positive: "border-transparent bg-success/10 text-success",
};

export function ReportDayStatusBadge({
  status,
  className,
}: {
  status: ReportDayStatus;
  className?: string;
}) {
  const presentation = reportDayStatusPresentation(status);
  return (
    <Badge
      className={cn(TONE_CLASS_NAME[presentation.tone], className)}
      size="sm"
      variant="outline"
    >
      {presentation.label}
    </Badge>
  );
}
