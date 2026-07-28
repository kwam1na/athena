import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReportDayStatus } from "~/shared/reportsContract";
import { reportDayStatusPresentation } from "./reportFormat";

const TONE_CLASS_NAME: Record<string, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  notice: "bg-warning/10 text-warning-foreground border-warning/40",
  warning: "bg-destructive/10 text-destructive border-destructive/20",
  positive: "bg-success/10 text-success border-success/40",
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
      className={cn("border-transparent", TONE_CLASS_NAME[presentation.tone], className)}
      variant="outline"
    >
      {presentation.label}
    </Badge>
  );
}
