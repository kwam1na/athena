import { useEffect, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import {
  canAccessSolutionCategory,
  filterAccessibleSolutionDocs,
} from "@/lib/docs/access";
import { listSolutionCategories, listSolutionDocs } from "@/lib/docs/content";
import { optionalSearchString } from "@/lib/docs/navigation";
import { LOGIN_PATH } from "@/lib/navigation/appEntryRoutes";
import { cn } from "@/lib/utils";
import { formatCategoryLabel, SolutionDocCard } from "./-docs-shared";

type SolutionsSearch = {
  category?: string;
  q?: string;
};

function SolutionsList() {
  // Both filters live in the URL so leaving for a doc and coming back — or
  // sharing the link — restores exactly what was on screen.
  const { category, q } = Route.useSearch();
  const query = q ?? "";
  const navigate = useNavigate({ from: Route.fullPath });
  const { isLoading, user } = useAuth();
  const isAuthenticated = Boolean(user);
  const docs = filterAccessibleSolutionDocs(
    listSolutionDocs(),
    isAuthenticated,
  );
  const categories = listSolutionCategories().filter(({ category }) =>
    canAccessSolutionCategory(category, isAuthenticated),
  );

  useEffect(() => {
    if (
      !isLoading &&
      category &&
      !canAccessSolutionCategory(category, isAuthenticated)
    ) {
      navigate({ to: LOGIN_PATH });
    }
  }, [category, isAuthenticated, isLoading, navigate]);

  const visibleDocs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return docs.filter((doc) => {
      if (category && doc.category !== category) return false;
      if (!normalizedQuery) return true;
      const haystack = [doc.title, doc.slug, doc.module ?? "", ...doc.tags]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [docs, category, query]);

  // `replace` throughout: typing a six-letter query must not bury the previous
  // page under six history entries. The list keeps one entry, so a single Back
  // press leaves the list rather than rewinding keystrokes.
  const setQuery = (next: string) => {
    navigate({
      search: (previous) => ({
        ...previous,
        q: next.length > 0 ? next : undefined,
      }),
      replace: true,
    });
  };

  const selectCategory = (next: string | undefined) => {
    navigate({
      search: (previous) => ({ ...previous, category: next }),
      replace: true,
    });
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-light leading-tight">
          Solution docs
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          Reusable implementation learnings captured after each delivery.
        </p>
      </header>

      <div className="space-y-4">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by title, module, or tag"
          aria-label="Search solution docs"
          className="max-w-md"
        />
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => selectCategory(undefined)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs transition-colors",
              !category
                ? "border-primary-border bg-primary-soft font-medium text-primary"
                : "border-border/70 bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            All
            <span className="ml-1.5 tabular-nums opacity-70">{docs.length}</span>
          </button>
          {categories.map((entry) => (
            <button
              key={entry.category}
              type="button"
              onClick={() =>
                selectCategory(
                  category === entry.category ? undefined : entry.category,
                )
              }
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs transition-colors",
                category === entry.category
                  ? "border-primary-border bg-primary-soft font-medium text-primary"
                  : "border-border/70 bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {formatCategoryLabel(entry.category)}
              <span className="ml-1.5 tabular-nums opacity-70">
                {entry.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {visibleDocs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-4 py-12 text-center text-sm text-muted-foreground">
          No solution docs match this filter.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleDocs.map((doc) => (
            <SolutionDocCard key={`${doc.category}/${doc.slug}`} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/docs/solutions/")({
  component: SolutionsList,
  validateSearch: (search: Record<string, unknown>): SolutionsSearch => ({
    category: optionalSearchString(search.category),
    q: optionalSearchString(search.q),
  }),
});
