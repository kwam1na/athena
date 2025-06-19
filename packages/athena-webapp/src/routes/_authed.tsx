import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { StoreModal } from "@/components/ui/modals/store-modal";
import { AppLayoutProvider } from "@/contexts/AppLayoutContext";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "../components/ui/sidebar";
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
  const [defaultOpen, setDefaultOpen] = useState<boolean | null>(null);

  useEffect(() => {
    // Read the sidebar state from cookies
    const cookies = document.cookie.split(";");
    const sidebarCookie = cookies.find((cookie) =>
      cookie.trim().startsWith("sidebar:state=")
    );

    if (sidebarCookie) {
      const sidebarState = sidebarCookie.split("=")[1];
      setDefaultOpen(sidebarState === "true");
    } else {
      // If no cookie exists, default to true (expanded)
      setDefaultOpen(true);
    }
  }, []);

  // Don't render until we've read the cookie
  if (defaultOpen === null) {
    return null; // or a loading spinner if you prefer
  }

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>
        <main className="flex-1">
          <AuthedComponent />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
