import { createFileRoute } from "@tanstack/react-router";
import { AppEntryRoute } from "./-app-entry-route";

export const Route = createFileRoute("/")({
  component: AppEntryRoute,
  head: () => ({
    meta: [{ title: "Athena | Workspace" }],
  }),
});
