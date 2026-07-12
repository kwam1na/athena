import { createFileRoute } from "@tanstack/react-router";
import { AppEntryRoute } from "./app";

export const Route = createFileRoute("/")({
  component: AppEntryRoute,
  head: () => ({
    meta: [{ title: "Athena | Workspace" }],
  }),
});
