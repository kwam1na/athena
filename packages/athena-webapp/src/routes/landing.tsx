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
        content: "Follow one day in an owner-led store — opening, sales, cash, and close — then walk the same day yourself in the live demo.",
      },
    ],
  }),
});
