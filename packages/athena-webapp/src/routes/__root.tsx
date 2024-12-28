import {
  Link,
  Outlet,
  ScrollRestoration,
  createRootRouteWithContext,
  redirect,
} from "@tanstack/react-router";
import {
  Body,
  createServerFn,
  Head,
  Html,
  Meta,
  Scripts,
} from "@tanstack/start";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Sidebar from "../components/Sidebar";
import { StoreModal } from "@/components/ui/modals/store-modal";
import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { organizationsRepository } from "@athena/db";
import { Toaster } from "@/components/ui/sonner";
import { useAppSession } from "@/utils/session";
import { DefaultCatchBoundary } from "@/components/auth/DefaultCatchBoundary";
import NotFound from "@/components/states/not-found/NotFound";
import { getCookie } from "vinxi/http";
import { NotFoundView } from "@/components/states/not-found/NotFoundView";
import Navbar from "../components/Navbar";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  meta: () => [
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

  beforeLoad: async () => {
    const user = {};

    return {
      user,
    };
  },

  component: RootComponent,

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
      <Navbar />
      <div className="p-8">
        <Outlet />
      </div>
      {/* <div className="h-screen"> */}
      {/* <Navbar />
        <Outlet /> */}
      {/* <div className="flex gap-4 h-screen p-4 bg-zinc-50"> */}
      {/* <ReactQueryDevtools buttonPosition="top-right" /> */}
      {/* <TanStackRouterDevtools position="bottom-right" /> */}
      {/* </div> */}
      {/* </div> */}
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <Html>
      <Head>
        <Meta />
      </Head>
      <Body>
        <Toaster expand />
        {children}
        <ScrollRestoration />
        <Scripts />
      </Body>
    </Html>
  );
}
