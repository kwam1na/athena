import { createFileRoute } from "@tanstack/react-router";
import { UserView } from "~/src/components/users/UserView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
)({
  component: UserView,
});
