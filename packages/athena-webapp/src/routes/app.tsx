import { createFileRoute } from "@tanstack/react-router";
import { AppEntryRoute } from "./-app-entry-route";

export const Route = createFileRoute("/app")({
  component: AppEntryRoute,
  head: () => ({
    meta: [{ title: "Athena" }],
  }),
});
