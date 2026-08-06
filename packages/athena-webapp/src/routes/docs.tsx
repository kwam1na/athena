import { createFileRoute } from "@tanstack/react-router";

import { DocsLayout } from "./-docs-layout";

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
  head: () => ({
    meta: [
      { title: "Athena docs" },
      {
        name: "description",
        content: "Solution docs and delivery reports for the Athena workspace.",
      },
    ],
  }),
});
