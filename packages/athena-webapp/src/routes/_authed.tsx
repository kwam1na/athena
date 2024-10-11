import { getAllOrganizations } from "@/api/organization";
import Sidebar from "@/components/Sidebar";
import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { StoreModal } from "@/components/ui/modals/store-modal";
import { AppLayoutProvider } from "@/contexts/AppLayoutContext";
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { useEffect } from "react";

export const Route = createFileRoute("/_authed")({
  component: AuthedComponent,
});

function AuthedComponent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate({ to: "/login" });
    }
  }, [isLoading, isAuthenticated]);

  if (isLoading && !isAuthenticated) {
    return null;
  }

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
