import { Link } from "@tanstack/react-router";

import type { DeliveryReportMeta, SolutionDocMeta } from "@/lib/docs/content";
import { cn } from "@/lib/utils";

export function formatCategoryLabel(category: string): string {
  return category.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function formatDocDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Only the dot carries the severity hue. The label stays muted and inherits
// the surrounding text size so severity reads as one more metadata field
// rather than as the loudest thing on the card.
const SEVERITY_DOT_CLASS: Record<string, string> = {
  critical: "bg-danger",
  high: "bg-warning",
  medium: "bg-primary/60",
  low: "bg-muted-foreground/40",
};

export function SeverityIndicator({ severity }: { severity: string | null }) {
  if (!severity) return null;
  return (
    <span className="inline-flex items-center gap-1.5 capitalize text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          SEVERITY_DOT_CLASS[severity] ?? SEVERITY_DOT_CLASS.low,
        )}
      />
      {severity}
    </span>
  );
}

export function SolutionDocCard({ doc }: { doc: SolutionDocMeta }) {
  return (
    <Link
      to="/docs/solutions/$category/$slug"
      params={{ category: doc.category, slug: doc.slug }}
      className="group block rounded-lg border border-border/70 bg-card px-5 py-4 transition-colors hover:border-primary-border hover:bg-primary-soft/40"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-primary">
          {formatCategoryLabel(doc.category)}
        </span>
        {doc.date ? (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={doc.date}>{formatDocDate(doc.date)}</time>
          </>
        ) : null}
        <span className="ml-auto">
          <SeverityIndicator severity={doc.severity} />
        </span>
      </div>
      <h3 className="mt-2.5 text-sm font-medium leading-6 text-foreground group-hover:text-primary">
        {doc.title}
      </h3>
    </Link>
  );
}

export function DeliveryReportCard({ report }: { report: DeliveryReportMeta }) {
  return (
    <Link
      to="/docs/reports/$slug"
      params={{ slug: report.slug }}
      className="group block rounded-lg border border-border/70 bg-card px-5 py-4 transition-colors hover:border-primary-border hover:bg-primary-soft/40"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {report.date ? (
          <time dateTime={report.date}>{formatDocDate(report.date)}</time>
        ) : null}
      </div>
      <h3 className="mt-2.5 text-sm font-medium leading-6 text-foreground group-hover:text-primary">
        {report.title}
      </h3>
    </Link>
  );
}
