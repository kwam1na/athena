import { createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";

import { routeTree } from "./routeTree.gen";
export { convex } from "./lib/convexClient";

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
