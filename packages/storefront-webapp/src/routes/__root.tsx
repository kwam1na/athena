import { Outlet, createRootRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NavigationBar from "@/components/navigation-bar/NavigationBar";
import Footer from "@/components/footer/Footer";
import { StoreProvider, useStoreContext } from "@/contexts/StoreContext";
import { Toaster } from "@/components/ui/sonner";
import { z } from "zod";
import NotFound from "@/components/states/not-found/NotFound";
import { MaintenanceMode } from "@/components/states/maintenance/Maintenance";
import { isInMaintenanceMode } from "@/lib/maintenanceUtils";
import { ErrorBoundary } from "@/components/states/error/ErrorBoundary";
import {
  NavigationBarProvider,
  useNavigationBarContext,
} from "@/contexts/NavigationBarProvider";
import { StorefrontObservabilityProvider } from "@/contexts/StorefrontObservabilityProvider";
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
  head: () => ({ meta: [{ charSet: "utf-8" }, { title: "Wigclub" }] }),
  validateSearch: productsPageSchema,
  component: Body,
  errorComponent: ErrorBoundary,
  notFoundComponent: () => <NotFound />,
});
function RootComponent() {
  const { navBarLayout, routeState } = useNavigationBarContext();
  return (
    <StoreProvider>
      <RootDocument>
        <StorefrontObservabilityProvider>
          <div className="flex min-h-dvh flex-col bg-background">
            <a
              href="#storefront-main"
              className="sr-only z-skipLink bg-surface p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
            >
              Skip to content
            </a>
            {routeState.navigationVisible && (
              <div className={getNavBarWrapperClass(navBarLayout)}>
                <NavigationBar />
              </div>
            )}
            <main id="storefront-main" tabIndex={-1} className="flex-grow">
              <Outlet />
            </main>
            {routeState.location === "shop" && <Footer />}
          </div>
        </StorefrontObservabilityProvider>
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
  defaultOptions: { queries: { staleTime: Infinity } },
});
function RootDocument({ children }: { children: React.ReactNode }) {
  const { store } = useStoreContext();
  if (isInMaintenanceMode(store?.config)) return <MaintenanceMode />;
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      {children}
    </QueryClientProvider>
  );
}
