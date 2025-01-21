import {
  Outlet,
  ScrollRestoration,
  createRootRoute,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NavigationBar from "@/components/navigation-bar/NavigationBar";
import { StoreProvider } from "@/contexts/StoreContext";
import { Scripts } from "@tanstack/start";
import { Toaster } from "@/components/ui/sonner";
import { z } from "zod";
import NotFound from "@/components/states/not-found/NotFound";
import { MaintenanceMode } from "@/components/states/maintenance/Maintenance";
import { useAuth } from "@/hooks/useAuth";

const productsPageSchema = z.object({
  color: z.string().optional(),
  length: z.string().optional(),
  checkoutSessionId: z.string().optional(),
  email: z.string().optional(),
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Wigclub",
      },
    ],
  }),

  validateSearch: productsPageSchema,

  component: RootComponent,

  notFoundComponent: () => {
    return <NotFound />;
  },
});

function RootComponent() {
  return (
    <RootDocument>
      <div className="flex flex-col h-screen bg-background">
        <NavigationBar />
        <main className="flex-grow bg-background">
          <Outlet />
        </main>
      </div>
    </RootDocument>
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
  const { user, guestId } = useAuth();

  const allowed = [
    "nn74pawp5hap116qtv8f5hp1th78m3k0",
    "md7craj8j61apsnhrwgg4apqm178tthf",
    "md755963ag0sdd03q9zr2r8ahd78vnrn",
    "kh7013cspvmvgjb7tthev4vs0h78jrzj",
    "kh79wgd0degj02g3dn5gm5gcgd78vs3g",
  ];

  const id = user?._id || guestId;

  const isAllowed = id && allowed.includes(id);

  if (!isAllowed) {
    return <MaintenanceMode />;
  }

  return (
    <div>
      <QueryClientProvider client={queryClient}>
        <Toaster />
        <StoreProvider>{children}</StoreProvider>
      </QueryClientProvider>
      <ScrollRestoration />
      <Scripts />
    </div>
  );
}
