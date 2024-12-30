import { createFileRoute } from "@tanstack/react-router";
import Home from "~/src/components/Home";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/home"
)({
  component: Home,
});
