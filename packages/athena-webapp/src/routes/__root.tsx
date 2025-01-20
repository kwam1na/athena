import {
  Outlet,
  ScrollRestoration,
  createRootRoute,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { Scripts } from "@tanstack/start";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { QueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { DefaultCatchBoundary } from "@/components/auth/DefaultCatchBoundary";
import { NotFoundView } from "@/components/states/not-found/NotFoundView";
import { z } from "zod";

const rootPageSchema = z.object({
  o: z.string().optional(),
  variant: z.string().optional(),
});

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    title: "Athena",
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Athena | Manage",
      },
    ],
  }),

  component: RootComponent,

  validateSearch: rootPageSchema,

  errorComponent: (props) => {
    return (
      <RootDocument>
        <DefaultCatchBoundary {...props} />
      </RootDocument>
    );
  },
  notFoundComponent: () => (
    <NotFoundView entity="page" entityIdentifier="provided" />
  ),
});

function RootComponent() {
  return (
    <RootDocument>
      <div className="p-8 bg-background">
        <Outlet />
      </div>
      {/* <ReactQueryDevtools buttonPosition="top-right" /> */}
      {/* <TanStackRouterDevtools position="bottom-right" /> */}
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <Toaster position="top-right" expand />
      {children}
      <ScrollRestoration />
      <Scripts />
    </main>
  );
}
