import { createFileRoute } from "@tanstack/react-router";
import { Index } from "./-index-route-view";

export const Route = createFileRoute("/landing")({
  component: Index,
  head: () => ({
    meta: [
      {
        title: "Athena | Product overview",
      },
      {
        name: "description",
        content: "See today's sales, understand what moved, and keep the history behind your business close.",
      },
    ],
  }),
});
