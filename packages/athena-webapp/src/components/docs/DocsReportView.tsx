import { useMemo } from "react";

import { DocsReportQuiz } from "./DocsReportQuiz";
import { parseReportDocument } from "@/lib/docs/reportContract";

import "./docs-prose.css";
import "./docs-report.css";

/**
 * Renders a contract-v2 delivery report as a themed page: pills and metadata,
 * prose sections through the shared docs styling, and a hydrated quiz.
 *
 * Falls back to an isolated frame for a non-v2 file. The presentation sensor
 * fails the build on one of those, so this path exists for safety, not use.
 */
export function DocsReportView({ html, title }: { html: string; title: string }) {
  const report = useMemo(() => parseReportDocument(html), [html]);

  if (!report) {
    return (
      <iframe
        title={title}
        srcDoc={html}
        sandbox="allow-scripts"
        className="min-h-[75vh] w-full flex-1 rounded-lg border border-border/70 bg-white"
      />
    );
  }

  return (
    <div>
      {report.pills.length > 0 ? (
        <ul className="report-pills">
          {report.pills.map((pill) => (
            <li key={pill}>{pill}</li>
          ))}
        </ul>
      ) : null}
      {report.meta.length > 0 ? (
        <dl className="report-meta">
          {report.meta.map((entry) => (
            <div key={entry.label} className="contents">
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div
        className="docs-prose"
        // Report markup is repo-authored, sensor-enforced, and sanitized
        // again in parseReportDocument.
        dangerouslySetInnerHTML={{ __html: report.sectionsHtml }}
      />
      {report.quiz ? <DocsReportQuiz quiz={report.quiz} /> : null}
    </div>
  );
}

export default DocsReportView;
