import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import {
  MutationCache,
  notifyManager,
  QueryClient,
} from "@tanstack/react-query";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { ConvexProvider } from "convex/react";
import { routeTree } from "./routeTree.gen";
import { toast } from "sonner";
import NotFound from "./components/states/not-found/NotFound";

// const queryClient = new QueryClient({
//   defaultOptions: {
//     queries: {
//       staleTime: Infinity,
//     },
//   },
// });

// export function createRouter() {
//   const router = createTanStackRouter({
//     routeTree,
//     context: { queryClient },
//   });

//   return router;
// }

export function createRouter() {
  if (typeof document !== "undefined") {
    notifyManager.setScheduler(window.requestAnimationFrame);
  }

  // const CONVEX_URL = (import.meta as any).env.VITE_CONVEX_URL!;

  const CONVEX_URL = "https://jovial-wildebeest-179.convex.cloud";
  if (!CONVEX_URL) {
    console.error("missing envar CONVEX_URL");
  }
  const convexQueryClient = new ConvexQueryClient(CONVEX_URL);

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
    mutationCache: new MutationCache({
      onError: (error) => {
        toast(error.message, { className: "bg-red-500 text-white" });
      },
    }),
  });
  convexQueryClient.connect(queryClient);

  const router = routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      defaultPreload: "intent",
      // defaultErrorComponent: DefaultCatchBoundary,
      // defaultNotFoundComponent: () => <NotFound />,
      context: { queryClient },
      Wrap: ({ children }) => (
        <ConvexProvider client={convexQueryClient.convexClient}>
          {children}
        </ConvexProvider>
      ),
    }),
    queryClient
  );

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
