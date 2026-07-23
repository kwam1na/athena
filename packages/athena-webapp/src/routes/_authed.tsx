import { createFileRoute } from "@tanstack/react-router";
import { AuthenticatedLayout } from "./-authenticated-layout";

export const Route = createFileRoute("/_authed")({
  component: AuthenticatedLayout,
  head: () => ({
    meta: [{ title: "Athena" }],
  }),
});
