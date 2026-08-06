import type { MouseEvent, ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import type { DocsTarget } from "@/lib/docs/navigation";
import { useDocsOrigin } from "./-docs-origin";

const LINK_CLASS =
  "inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary";

type TargetLinkProps = {
  target: DocsTarget;
  children: ReactNode;
  className: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/** Renders the typed router Link that addresses `target`. */
function TargetLink({ target, children, ...rest }: TargetLinkProps) {
  switch (target.kind) {
    case "overview":
      return (
        <Link to="/docs" {...rest}>
          {children}
        </Link>
      );
    case "solutions":
      return (
        <Link
          to="/docs/solutions"
          search={target.category ? { category: target.category } : {}}
          {...rest}
        >
          {children}
        </Link>
      );
    case "reports":
      return (
        <Link to="/docs/reports" {...rest}>
          {children}
        </Link>
      );
    case "solutionDoc":
      return (
        <Link
          to="/docs/solutions/$category/$slug"
          params={{ category: target.category, slug: target.slug }}
          {...rest}
        >
          {children}
        </Link>
      );
    case "report":
      return (
        <Link to="/docs/reports/$slug" params={{ slug: target.slug }} {...rest}>
          {children}
        </Link>
      );
  }
}

/**
 * Points back at wherever the reader arrived from, falling back to the page's
 * own section when the URL was opened directly.
 *
 * With a recorded origin the click is served by `history.back()` rather than by
 * the link's own navigation: pushing a new entry for a backward move would
 * leave the browser's back button pointing at the page just left, and would
 * lose the origin's restored scroll position. The href stays on the anchor so
 * the destination is still visible on hover and openable in a new tab.
 */
export function DocsBackLink({
  fallbackTarget,
  fallbackLabel,
}: {
  fallbackLabel: string;
  fallbackTarget: DocsTarget;
}) {
  const origin = useDocsOrigin();
  const router = useRouter();

  const target = origin?.target ?? fallbackTarget;
  const label = origin?.label ?? fallbackLabel;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Leave modified clicks (new tab, new window, download) to the browser.
    if (
      !origin ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    router.history.back();
  };

  return (
    <TargetLink target={target} className={LINK_CLASS} onClick={handleClick}>
      <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
      {/* min-w-0 lets the label shrink below its content width so `truncate`
          can take effect — a doc title is long enough to need it. */}
      <span className="min-w-0 truncate">{label}</span>
    </TargetLink>
  );
}
