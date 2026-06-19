import { createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";

import { routeTree } from "./routeTree.gen";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
    },
  },
});

export const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export const convex = new ConvexReactClient(
  import.meta.env.VITE_CONVEX_URL as string,
);
