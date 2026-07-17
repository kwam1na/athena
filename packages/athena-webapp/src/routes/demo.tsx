import { createFileRoute } from "@tanstack/react-router";
import { SharedDemoEntry } from "./-shared-demo-entry";

export const Route = createFileRoute("/demo")({
  component: SharedDemoEntry,
  head: () => ({ meta: [{ title: "Athena | Demo" }] }),
});
