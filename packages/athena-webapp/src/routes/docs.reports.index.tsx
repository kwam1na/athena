import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Input } from "@/components/ui/input";
import { listDeliveryReports } from "@/lib/docs/content";
import { optionalSearchString } from "@/lib/docs/navigation";
import { DeliveryReportCard } from "./-docs-shared";

type ReportsSearch = {
  q?: string;
};

function ReportsList() {
  // Kept in the URL so opening a report and coming back restores the search.
  const { q } = Route.useSearch();
  const query = q ?? "";
  const navigate = useNavigate({ from: Route.fullPath });
  const reports = listDeliveryReports();

  // `replace` so each keystroke rewrites the list entry instead of stacking
  // one history entry per character.
  const setQuery = (next: string) => {
    navigate({
      search: () => (next.length > 0 ? { q: next } : {}),
      replace: true,
    });
  };

  const visibleReports = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return reports;
    return reports.filter((report) =>
      `${report.title} ${report.slug}`.toLowerCase().includes(normalizedQuery),
    );
  }, [reports, query]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-light leading-tight">
          Delivery reports
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          The report published with each landed change, newest first.
        </p>
      </header>

      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search reports"
        aria-label="Search delivery reports"
        className="max-w-md"
      />

      {visibleReports.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-4 py-12 text-center text-sm text-muted-foreground">
          No delivery reports match this search.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleReports.map((report) => (
            <DeliveryReportCard key={report.slug} report={report} />
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/docs/reports/")({
  component: ReportsList,
  validateSearch: (search: Record<string, unknown>): ReportsSearch => ({
    q: optionalSearchString(search.q),
  }),
});
