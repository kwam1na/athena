import { getAllOrganizations } from "@/api/organization";
import Sidebar from "@/components/Sidebar";
import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { StoreModal } from "@/components/ui/modals/store-modal";
import { AppLayoutProvider } from "@/contexts/AppLayoutContext";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ context }) => {
    if (!context.user) {
      // throw redirect({ to: "/login" });
    }
  },

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
