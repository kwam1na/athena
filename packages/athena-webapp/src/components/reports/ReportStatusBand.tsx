import { AlertCircle, CheckCircle2, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  getReportStatusPresentation,
  type ReportStatusKind,
} from "./reportPresentation";

export function ReportStatusBand({ kind }: { kind: ReportStatusKind }) {
  const presentation = getReportStatusPresentation({ kind });
  const Icon =
    presentation.tone === "warning"
      ? AlertCircle
      : presentation.tone === "neutral"
        ? CheckCircle2
        : Info;

  return (
    <section
      aria-live={presentation.tone === "warning" ? "polite" : undefined}
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-surface-raised px-layout-md py-layout-sm text-sm",
        presentation.tone === "warning" && "border-warning/40",
      )}
      role={presentation.tone === "warning" ? "status" : undefined}
    >
      <Icon
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
      />
      <div>
        <p className="font-medium text-foreground">{presentation.title}</p>
        <p className="mt-1 text-muted-foreground">{presentation.description}</p>
      </div>
    </section>
  );
}
