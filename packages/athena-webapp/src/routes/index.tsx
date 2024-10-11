import { createFileRoute, redirect } from "@tanstack/react-router";
// import { getOrganizations } from "@/server-actions/organizations";
import OrganizationsView from "@/components/OrganizationsView";
import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { Organization } from "@athena/db";

export const Route = createFileRoute("/")({
  // beforeLoad: async ({ context }) => {
  //   if (context.user) {
  //     // const organizations = await getOrganizations();

  //     const organizations: Organization[] = [];
  //     const store = {};
  //     const product = {};

  //     if (organizations && organizations.length > 1) {
  //       throw redirect({
  //         to: "/$orgUrlSlug",
  //         params: { orgUrlSlug: organizations[0].slug },
  //       });
  //     }
  //   }
  // },

  // loader: async () => await getOrganizations(),

  component: Index,
});

function Index() {
  return (
    <>
      <OrganizationModal />
      <OrganizationsView />
    </>
  );
}
