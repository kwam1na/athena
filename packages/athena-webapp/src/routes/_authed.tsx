import { createFileRoute } from "@tanstack/react-router";
import Layout from "./-authed-layout";

export const Route = createFileRoute("/_authed")({
  component: Layout,
});
