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
import Navbar from "../components/Navbar";
import { SidebarProvider } from "../components/ui/sidebar";
import { AppSidebar } from "../components/app-sidebar";

export const Route = createFileRoute("/_authed")({
  component: Layout,
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
    <AppLayoutProvider>
      {/* <Sidebar /> */}
      {/* <div className="flex-grow bg-red-50"> */}
      {/* <StoreModal /> */}
      {/* <OrganizationModal /> */}
      {/* </div> */}
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
        {/* <SidebarTrigger /> */}
        <AuthedComponent />
      </main>
    </SidebarProvider>
  );
}
