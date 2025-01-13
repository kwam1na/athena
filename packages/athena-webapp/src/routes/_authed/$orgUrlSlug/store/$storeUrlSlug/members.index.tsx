import { createFileRoute } from "@tanstack/react-router";
import { OrganizationMembersView } from "~/src/components/organization-members";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/members/"
)({
  component: () => <OrganizationMembersView />,
});
