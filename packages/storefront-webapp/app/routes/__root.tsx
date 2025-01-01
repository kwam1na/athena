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
import { OG_ORGANIZTION_ID } from "@/lib/constants";
import Footer from "@/components/footer/Footer";
import { z } from "zod";
import NotFound from "@/components/states/not-found/NotFound";

const productsPageSchema = z.object({
  color: z.string().optional(),
  length: z.string().optional(),
  checkoutSessionId: z.string().optional(),
});

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
    const user = await fetchUser(OG_ORGANIZTION_ID);

    return {
      user,
    };
  },

  validateSearch: productsPageSchema,

  component: RootComponent,

  notFoundComponent: () => {
    return <NotFound />;
  },
});

function RootComponent() {
  return (
    <RootDocument>
      <div className="flex gap-2 flex-col h-screen">
        <NavigationBar />
        <main className="flex-grow">
          <Outlet />
          {/* <Footer /> */}
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

  return (
    <Html>
      <Head>
        <Meta>
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
          />
        </Meta>
        <link
          href="https://fonts.googleapis.com/css2?family=Lavishly+Yours&display=swap"
          rel="stylesheet"
        />
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
