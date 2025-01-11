import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { StoreModal } from "@/components/ui/modals/store-modal";
import { AppLayoutProvider } from "@/contexts/AppLayoutContext";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider } from "../components/ui/sidebar";
import { AppSidebar } from "../components/app-sidebar";
import { useAuth } from "../hooks/useAuth";

export const Route = createFileRoute("/_authed")({
  component: Layout,
});

function AuthedComponent() {
  const navigate = useNavigate();

  const { user } = useAuth();

  useEffect(() => {
    if (user === null) {
      navigate({ to: "/login" });
    }
  }, [user]);

  return (
    <AppLayoutProvider>
      <StoreModal />
      <OrganizationModal />
      <Outlet />
    </AppLayoutProvider>
  );
}

export default function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="w-full">
        <AuthedComponent />
      </main>
    </SidebarProvider>
  );
}
