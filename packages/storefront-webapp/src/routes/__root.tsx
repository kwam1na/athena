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
import { useAuth } from "@/hooks/useAuth";
import {
  NavigationBarProvider,
  useNavigationBarContext,
} from "@/contexts/NavigationBarProvider";

const productsPageSchema = z.object({
  color: z.string().optional(),
  length: z.string().optional(),
  checkoutSessionId: z.string().optional(),
  email: z.string().optional(),
  origin: z.string().optional(),
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1.0",
      },
      {
        title: "Wigclub",
      },
    ],
  }),

  validateSearch: productsPageSchema,

  component: Body,

  notFoundComponent: () => {
    return <NotFound />;
  },
});

function RootComponent() {
  const { navBarLayout } = useNavigationBarContext();

  const navBarClassname =
    navBarLayout == "sticky" ? "absolute w-full sticky z-50 top-0" : "";

  return (
    <StoreProvider>
      <RootDocument>
        <div className="flex flex-col h-screen bg-background">
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

  const { inMaintenanceMode } = store?.config?.availability || {};

  if (inMaintenanceMode) {
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
