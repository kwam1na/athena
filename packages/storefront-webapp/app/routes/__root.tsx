import {
  Link,
  Outlet,
  ScrollRestoration,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NavigationBar from "@/components/navigation-bar/NavigationBar";
import { StoreProvider } from "@/contexts/StoreContext";
import { Body, Head, Html, Meta, Scripts } from "@tanstack/start";
import { Toaster } from "@/components/ui/sonner";
import { fetchUser } from "@/server-actions/auth";

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
      title: "Athena | Store",
    },
  ],

  loader: async () => {
    const user = await fetchUser();

    return {
      user,
    };
  },

  component: RootComponent,

  notFoundComponent: () => {
    return (
      <div>
        <p>This is the notFoundComponent configured on root route</p>
        <Link to="/">Start Over</Link>
      </div>
    );
  },
});

function RootComponent() {
  return (
    <RootDocument>
      <div className="flex flex-col h-screen">
        <NavigationBar />
        <main className="flex-grow overflow-auto">
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
  const serverData = Route.useLoaderData();

  console.log(serverData);

  return (
    <Html>
      <Head>
        <Meta />
      </Head>
      <Body>
        <QueryClientProvider client={queryClient}>
          <Toaster />
          <StoreProvider>{children}</StoreProvider>
        </QueryClientProvider>
        <ScrollRestoration />
        <Scripts />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.serverData = ${JSON.stringify({
              customerId: serverData?.user?.customerId,
              guestId: serverData?.user?.guestId,
            })};`,
          }}
        />
      </Body>
    </Html>
  );
}
