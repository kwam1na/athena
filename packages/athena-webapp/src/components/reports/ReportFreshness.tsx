import { Clock3 } from "lucide-react";

const reportUpdatedAtFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
});

export function ReportFreshness({
  updatedAt,
}: {
  updatedAt: number | null | undefined;
}) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 text-xs leading-5 text-muted-foreground"
      data-testid="report-freshness"
    >
      <Clock3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span>Report totals update about every 5 minutes</span>
      {updatedAt !== null && updatedAt !== undefined ? (
        <>
          <span aria-hidden="true">·</span>
          <span>
            Last updated{" "}
            <time
              className="tabular-nums"
              dateTime={new Date(updatedAt).toISOString()}
            >
              {reportUpdatedAtFormatter.format(updatedAt)}
            </time>
          </span>
        </>
      ) : null}
    </p>
  );
}
