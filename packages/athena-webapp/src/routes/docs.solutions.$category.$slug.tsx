import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import DocsMarkdown from "@/components/docs/DocsMarkdown";
import Spinner from "@/components/ui/spinner";
import { useAuth } from "@/hooks/useAuth";
import { DocsBackLink } from "./-docs-back-link";
import {
  findReportsDeliveredWith,
  loadSolutionDocBody,
  type SolutionDocMeta,
} from "@/lib/docs/content";
import {
  loadSolutionDocPageData,
  stripSolutionDocHeading,
} from "@/lib/docs/solutionPage";
import { LOGIN_PATH } from "@/lib/navigation/appEntryRoutes";
import {
  DeliveredWithReports,
  formatCategoryLabel,
  formatDocDate,
  SeverityIndicator,
} from "./-docs-shared";

function SolutionDocPage() {
  const { doc, body, requiresAuthentication } = Route.useLoaderData();

  if (doc && requiresAuthentication) {
    return <AuthenticatedSolutionDocPage doc={doc} />;
  }

  return <SolutionDocContent body={body} doc={doc} />;
}

function AuthenticatedSolutionDocPage({ doc }: { doc: SolutionDocMeta }) {
  const { isLoading, user } = useAuth();
  const navigate = useNavigate();
  const [body, setBody] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    if (!isLoading && user === null) {
      navigate({ to: LOGIN_PATH });
    }
  }, [isLoading, navigate, user]);

  useEffect(() => {
    if (!user) return;

    let isCurrent = true;
    void loadSolutionDocBody(doc)
      .then((raw) => {
        if (isCurrent) {
          setBody(stripSolutionDocHeading(raw));
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) setLoadError(error);
      });

    return () => {
      isCurrent = false;
    };
  }, [doc, user]);

  if (loadError) throw loadError;

  if (isLoading || !user || body === null) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return <SolutionDocContent body={body} doc={doc} />;
}

function SolutionDocContent({
  body,
  doc,
}: {
  body: string | null;
  doc: SolutionDocMeta | null;
}) {
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
      <DeliveredWithReports reports={findReportsDeliveredWith(doc)} />
    </article>
  );
}

export const Route = createFileRoute("/docs/solutions/$category/$slug")({
  component: SolutionDocPage,
  loader: ({ params }) => loadSolutionDocPageData(params),
});
