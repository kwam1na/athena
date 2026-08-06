import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { findSolutionDoc } from "@/lib/docs/content";
import { resolveSolutionDocLink } from "@/lib/docs/parsing";

import "./docs-prose.css";

const REMARK_PLUGINS = [remarkGfm];

const UNRESOLVED_LINK_TITLE =
  "This reference points outside the docs section, or to a document that no longer exists.";

export function DocsMarkdown({
  markdown,
  category,
}: {
  /** Category of the doc being rendered; relative links resolve against it. */
  category: string;
  markdown: string;
}) {
  const components = useMemo<Components>(
    () => ({
      a({ node, href, children, ...props }) {
        // `node` (the mdast node) must stay out of `...props` — it isn't a
        // valid DOM attribute — but nothing else here needs it.
        void node;
        const target = href ? resolveSolutionDocLink(href, category) : null;

        // Cross-references between solution docs route client-side, so
        // following one keeps the docs shell and its scroll position.
        if (target && findSolutionDoc(target.category, target.slug)) {
          return (
            <Link to="/docs/solutions/$category/$slug" params={target}>
              {children}
            </Link>
          );
        }

        if (href && /^https?:\/\//i.test(href)) {
          return (
            <a href={href} target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          );
        }

        // In-page anchors work natively against the rendered headings.
        if (href?.startsWith("#")) {
          return (
            <a href={href} {...props}>
              {children}
            </a>
          );
        }

        // A reference this section cannot address: a doc outside
        // docs/solutions/, or a target that no longer exists. Render the text
        // rather than a link that would dead-end on the not-found page.
        return (
          <span className="docs-prose-unlinked" title={UNRESOLVED_LINK_TITLE}>
            {children}
          </span>
        );
      },
    }),
    [category],
  );

  return (
    <div className="docs-prose">
      <Markdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {markdown}
      </Markdown>
    </div>
  );
}

export default DocsMarkdown;
