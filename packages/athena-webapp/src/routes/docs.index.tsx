import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import {
  canAccessSolutionCategory,
  filterAccessibleSolutionDocs,
} from "@/lib/docs/access";
import {
  listDeliveryReports,
  listSolutionCategories,
  listSolutionDocs,
} from "@/lib/docs/content";
import {
  DeliveryReportCard,
  formatCategoryLabel,
  SolutionDocCard,
} from "./-docs-shared";

function DocsOverview() {
  const { user } = useAuth();
  const isAuthenticated = Boolean(user);
  const solutions = filterAccessibleSolutionDocs(
    listSolutionDocs(),
    isAuthenticated,
  );
  const reports = listDeliveryReports();
  const categories = listSolutionCategories().filter(({ category }) =>
    canAccessSolutionCategory(category, isAuthenticated),
  );

  return (
    <div className="space-y-16">
      <header>
        <h1 className="font-display text-3xl font-light leading-tight sm:text-4xl">
          Documentation
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          Implementation learnings and delivery history for Athena:{" "}
          {solutions.length} solution docs across {categories.length} categories,
          and {reports.length} delivery reports.
        </p>
      </header>

      <section aria-labelledby="recent-solutions">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 id="recent-solutions" className="text-lg font-medium">
            Recent solution docs
          </h2>
          <Link
            to="/docs/solutions"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {solutions.slice(0, 6).map((doc) => (
            <SolutionDocCard key={`${doc.category}/${doc.slug}`} doc={doc} />
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-2.5">
          {categories.map(({ category, count }) => (
            <Link
              key={category}
              to="/docs/solutions"
              search={{ category }}
              className="rounded-full border border-border/70 bg-card px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary-border hover:text-primary"
            >
              {formatCategoryLabel(category)}
              <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-reports">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 id="recent-reports" className="text-lg font-medium">
            Recent delivery reports
          </h2>
          <Link
            to="/docs/reports"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {reports.slice(0, 6).map((report) => (
            <DeliveryReportCard key={report.slug} report={report} />
          ))}
        </div>
      </section>
    </div>
  );
}

export const Route = createFileRoute("/docs/")({
  component: DocsOverview,
});
