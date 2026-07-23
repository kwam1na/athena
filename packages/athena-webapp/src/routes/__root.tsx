import {
  Outlet,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";

import { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { DefaultCatchBoundary } from "@/components/auth/DefaultCatchBoundary";
import { NotFoundView } from "@/components/states/not-found/NotFoundView";
import { getRecoveryHomePath } from "@/lib/navigation/appEntryRoutes";
import { rootPageSchema } from "./-root-page-search";

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
  notFoundComponent: RootNotFound,
});

function RootNotFound() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <NotFoundView
      entity="page"
      entityIdentifier="provided"
      homePath={getRecoveryHomePath(pathname)}
    />
  );
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
      {/* <ReactQueryDevtools buttonPosition="top-right" /> */}
      {/* <TanStackRouterDevtools position="bottom-right" /> */}
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useEffect(() => {
    document.title = getAthenaDocumentTitle(pathname);
  }, [pathname]);

  return (
    <div>
      <Toaster expand />
      {children}
    </div>
  );
}

export function getAthenaDocumentTitle(pathname: string) {
  if (pathname === "/landing") {
    return "Athena | Product overview";
  }

  if (pathname === "/walkthrough") {
    return "Request an Athena walkthrough";
  }

  if (pathname === "/privacy") {
    return "Athena walkthrough privacy details";
  }

  if (pathname.includes("/demo")) {
    return "Athena | Demo";
  }

  return "Athena";
}
