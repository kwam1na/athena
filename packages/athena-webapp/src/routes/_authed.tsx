import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { StoreModal } from "@/components/ui/modals/store-modal";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  SidebarProvider,
  SidebarInset,
  useSidebar,
} from "../components/ui/sidebar";
import { AppSidebar } from "../components/app-sidebar";
import { useAuth } from "../hooks/useAuth";
import { PermissionsProvider } from "../contexts/PermissionsContext";
import { LogOut, UserCircle } from "lucide-react";
import { AppHeader } from "@/components/Navbar";
import { cn } from "@/lib/utils";
import { useAuthActions } from "@convex-dev/auth/react";
import { LOGGED_IN_USER_ID_KEY } from "@/lib/constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authed")({
  component: Layout,
});

function AuthedComponent() {
  return (
    <>
      <StoreModal />
      <OrganizationModal />
      <Outlet />
    </>
  );
}

function UserMenu({ userEmail }: { userEmail: string }) {
  const navigate = useNavigate();
  const { signOut } = useAuthActions();

  const handleSignOut = async () => {
    await signOut();
    localStorage.removeItem(LOGGED_IN_USER_ID_KEY);
    navigate({ to: "/login" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-layout-xs rounded-md px-layout-xs py-layout-2xs text-sm text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="max-w-[18rem] truncate font-medium">
            {userEmail}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          className="gap-layout-xs"
          onSelect={() => void handleSignOut()}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TopBar({ userEmail }: { userEmail: string }) {
  const { state } = useSidebar();
  const sidebarColumnWidth =
    state === "collapsed"
      ? "var(--sidebar-width-icon)"
      : "var(--sidebar-width)";

  return (
    <header className="relative z-20 flex h-16 shrink-0 border-b border-border/70 bg-background">
      <div
        className={cn(
          "flex h-full shrink-0 items-center px-layout-xl transition-[width] duration-200 ease-linear",
          state === "expanded" && "border-r border-sidebar-border",
        )}
        style={{ width: sidebarColumnWidth }}
      >
        <AppHeader />
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end px-layout-xl">
        <UserMenu userEmail={userEmail} />
      </div>
    </header>
  );
}

export default function Layout() {
  const [defaultOpen, setDefaultOpen] = useState<boolean | null>(true);
  const navigate = useNavigate();
  const { isLoading, user } = useAuth();
  const userEmail = user?.email ?? "";

  // useEffect(() => {
  //   // Read the sidebar state from cookies
  //   const cookies = document.cookie.split(";");
  //   const sidebarCookie = cookies.find((cookie) =>
  //     cookie.trim().startsWith("sidebar:state=")
  //   );

  //   if (sidebarCookie) {
  //     const sidebarState = sidebarCookie.split("=")[1];
  //     setDefaultOpen(sidebarState === "true");
  //   } else {
  //     // If no cookie exists, default to true (expanded)
  //     setDefaultOpen(true);
  //   }
  // }, []);

  // Don't render until we've read the cookie
  useEffect(() => {
    if (!isLoading && user === null) {
      navigate({ to: "/login" });
    }
  }, [isLoading, navigate, user]);

  if (defaultOpen === null || isLoading || user === null) {
    return null; // or a loading spinner if you prefer
  }

  return (
    <PermissionsProvider>
      <SidebarProvider
        className="fixed inset-0 h-svh !min-h-0 flex-col overflow-hidden"
        defaultOpen={defaultOpen}
      >
        <TopBar userEmail={userEmail} />
        <div className="flex h-[calc(100svh-4rem)] !min-h-0 flex-1">
          <AppSidebar />
          <SidebarInset className="h-full !min-h-0 overflow-hidden">
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent p-8">
              <AuthedComponent />
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </PermissionsProvider>
  );
}
