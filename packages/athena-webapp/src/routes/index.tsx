import { createFileRoute } from "@tanstack/react-router";
import { Index } from "./-index-route-view";

export const Route = createFileRoute("/")({
  component: Index,
});
