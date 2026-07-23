import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "./-privacy-page";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Athena privacy details" },
      {
        name: "description",
        content: "How Athena handles information submitted with a walkthrough request.",
      },
    ],
  }),
});
