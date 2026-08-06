import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import DocsMarkdown from "@/components/docs/DocsMarkdown";
import { DocsBackLink } from "./-docs-back-link";
import {
  findSolutionDoc,
  loadSolutionDocBody,
  stripFrontmatter,
  type SolutionDocMeta,
} from "@/lib/docs/content";
import {
  formatCategoryLabel,
  formatDocDate,
  SeverityIndicator,
} from "./-docs-shared";

type SolutionDocLoaderData = {
  doc: SolutionDocMeta | null;
  body: string | null;
};

function SolutionDocPage() {
  const { doc, body } = Route.useLoaderData();

  if (!doc || body === null) {
    return (
      <div className="space-y-4">
        <p className="text-base text-muted-foreground">
          This solution doc does not exist.
        </p>
        <Link
          to="/docs/solutions"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to solution docs
        </Link>
      </div>
    );
  }

  return (
    <article>
      <div className="mb-10 border-b border-border/70 pb-8">
        <DocsBackLink
          fallbackTarget={{ kind: "solutions", category: doc.category }}
          fallbackLabel={formatCategoryLabel(doc.category)}
        />
        <h1 className="mt-5 font-display text-2xl font-light leading-tight sm:text-3xl">
          {doc.title}
        </h1>
        <div className="mt-5 flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
          {doc.date ? (
            <time dateTime={doc.date}>{formatDocDate(doc.date)}</time>
          ) : null}
          {doc.module ? (
            <>
              {doc.date ? <span aria-hidden="true">·</span> : null}
              <span>{doc.module}</span>
            </>
          ) : null}
          {doc.severity && (doc.date || doc.module) ? (
            <span aria-hidden="true">·</span>
          ) : null}
          <SeverityIndicator severity={doc.severity} />
        </div>
        {doc.tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {doc.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted/70 px-3 py-1 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <DocsMarkdown markdown={body} category={doc.category} />
    </article>
  );
}

export const Route = createFileRoute("/docs/solutions/$category/$slug")({
  component: SolutionDocPage,
  loader: async ({ params }): Promise<SolutionDocLoaderData> => {
    const doc = findSolutionDoc(params.category, params.slug);
    if (!doc) return { doc: null, body: null };
    const raw = await loadSolutionDocBody(doc);
    // The page header already shows the title, so drop a leading H1 that
    // repeats it.
    const body = stripFrontmatter(raw).replace(/^\s*#\s[^\n]+\n+/, "");
    return { doc, body };
  },
});
