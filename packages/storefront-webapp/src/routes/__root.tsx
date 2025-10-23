import {
  Outlet,
  ScrollRestoration,
  createRootRoute,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NavigationBar from "@/components/navigation-bar/NavigationBar";
import { StoreProvider, useStoreContext } from "@/contexts/StoreContext";
import { Scripts } from "@tanstack/start";
import { Toaster } from "@/components/ui/sonner";
import { z } from "zod";
import NotFound from "@/components/states/not-found/NotFound";
import { MaintenanceMode } from "@/components/states/maintenance/Maintenance";
import { isInMaintenanceMode } from "@/lib/maintenanceUtils";
import { ErrorBoundary } from "@/components/states/error/ErrorBoundary";
import { useAuth } from "@/hooks/useAuth";
import { PostHogProvider } from "posthog-js/react";
import {
  NavigationBarProvider,
  useNavigationBarContext,
} from "@/contexts/NavigationBarProvider";
import { getNavBarWrapperClass } from "@/components/navigation-bar/navBarStyles";

const productsPageSchema = z.object({
  color: z.string().optional(),
  length: z.string().optional(),
  checkoutSessionId: z.string().optional(),
  email: z.string().optional(),
  origin: z.string().optional(),
  utm_source: z.string().optional(),
  reference: z.string().optional(),
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
      },
      {
        title: "Wigclub",
      },
    ],
  }),

  validateSearch: productsPageSchema,

  component: Body,

  errorComponent: ErrorBoundary,

  notFoundComponent: () => {
    return <NotFound />;
  },
});

function RootComponent() {
  const { navBarLayout } = useNavigationBarContext();

  // Use styling utility for navbar wrapper positioning
  const navBarClassname = getNavBarWrapperClass(navBarLayout);

  return (
    <StoreProvider>
      <RootDocument>
        <div className="flex flex-col bg-background">
          <div className={navBarClassname}>
            <NavigationBar />
          </div>
          <main className="flex-grow bg-background">
            <Outlet />
          </main>
        </div>
      </RootDocument>
    </StoreProvider>
  );
}

function Body() {
  return (
    <NavigationBarProvider>
      <RootComponent />
    </NavigationBarProvider>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
    },
  },
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const { store } = useStoreContext();
  const { storeFrontUserId } = useAuth();

  const userIds = [
    "kh7dn0q87d7jj7nxh78vbmhck97g5d6g",
    "md72weypcwt2mgjmxsbayxdpt57jnwze",
  ];

  const canBypassMaintenanceMode =
    storeFrontUserId && userIds.includes(storeFrontUserId as string);

  if (isInMaintenanceMode(store?.config) && !canBypassMaintenanceMode) {
    return <MaintenanceMode />;
  }

  return (
    <div>
      <QueryClientProvider client={queryClient}>
        <Toaster />
        {children}
      </QueryClientProvider>
      <ScrollRestoration />
      <Scripts />
    </div>
  );
}
