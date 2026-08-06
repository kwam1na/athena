import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import DocsReportView from "@/components/docs/DocsReportView";
import {
  findDeliveryReport,
  loadDeliveryReportHtml,
  type DeliveryReportMeta,
} from "@/lib/docs/content";
import { DocsBackLink } from "./-docs-back-link";
import { formatDocDate } from "./-docs-shared";

type ReportLoaderData = {
  report: DeliveryReportMeta | null;
  html: string | null;
};

function DeliveryReportPage() {
  const { report, html } = Route.useLoaderData();

  if (!report || html === null) {
    return (
      <div className="space-y-4">
        <p className="text-base text-muted-foreground">
          This delivery report does not exist.
        </p>
        <Link
          to="/docs/reports"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to delivery reports
        </Link>
      </div>
    );
  }

  return (
    <article>
      <div className="mb-10 border-b border-border/70 pb-8">
        <DocsBackLink
          fallbackTarget={{ kind: "reports" }}
          fallbackLabel="Delivery reports"
        />
        <h1 className="mt-5 font-display text-2xl font-light leading-tight sm:text-3xl">
          {report.title}
        </h1>
        {report.date ? (
          <p className="mt-2 text-sm text-muted-foreground">
            <time dateTime={report.date}>{formatDocDate(report.date)}</time>
          </p>
        ) : null}
      </div>
      <DocsReportView html={html} title={report.title} />
    </article>
  );
}

export const Route = createFileRoute("/docs/reports/$slug")({
  component: DeliveryReportPage,
  loader: async ({ params }): Promise<ReportLoaderData> => {
    const report = findDeliveryReport(params.slug);
    if (!report) return { report: null, html: null };
    return { report, html: await loadDeliveryReportHtml(report) };
  },
});
