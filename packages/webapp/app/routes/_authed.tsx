import Sidebar from "@/components/Sidebar";
import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { StoreModal } from "@/components/ui/modals/store-modal";
import { AppLayoutProvider } from "@/contexts/AppLayoutContext";
import { getOrganizations } from "@/server-actions/organizations";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ context }) => {
    console.log("context ->", context);
    if (!context.user) {
      throw redirect({ to: "/login" });
    }
  },

  loader: async () => await getOrganizations(),

  component: AuthedComponent,
});

function AuthedComponent() {
  return (
    <div className="flex w-full gap-4 p-4 bg-zinc-50">
      <AppLayoutProvider>
        <Sidebar />
        <div className="flex-grow">
          <StoreModal />
          <OrganizationModal />
          <Outlet />
        </div>
        {/* <ReactQueryDevtools buttonPosition="top-right" /> */}
        {/* <TanStackRouterDevtools position="bottom-right" /> */}
      </AppLayoutProvider>
    </div>
  );
}
