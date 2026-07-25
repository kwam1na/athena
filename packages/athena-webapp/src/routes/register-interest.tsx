import { createFileRoute } from "@tanstack/react-router";

import { WalkthroughPage } from "./-walkthrough-page";

export const Route = createFileRoute("/register-interest")({
  component: WalkthroughPage,
  head: () => ({
    meta: [
      { title: "Register interest in Athena" },
      {
        name: "description",
        content: "Tell Athena what you need to see across sales and inventory.",
      },
    ],
  }),
});
