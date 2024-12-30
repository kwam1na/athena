import ProductsView from "@/components/ProductsView";
import { NotFoundView } from "@/components/states/not-found/NotFoundView";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { AppSidebar } from "~/src/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "~/src/components/ui/sidebar";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/"
)({
  // beforeLoad: () => {
  //   const { activeOrganization } = useGetActiveOrganization();
  //   const { activeStore } = useGetActiveStore();

  //   if (!activeOrganization || !activeStore)
  //     throw notFound({
  //       data: {
  //         store: Boolean(activeStore) == false,
  //         org: Boolean(activeOrganization) == false,
  //       },
  //     });
  // },

  component: ProductsView,

  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams();
    const { data: d } = data as Record<string, any>;
    const { org } = d as Record<string, boolean>;

    const entity = org ? "organization" : "store";
    const name = org ? orgUrlSlug : storeUrlSlug;

    return <NotFoundView entity={entity} entityIdentifier={name} />;
  },
});

// export default function Layout() {
//   return (
//     <SidebarProvider>
//       <AppSidebar />
//       <main className="w-full">
//         {/* <SidebarTrigger /> */}
//         <ProductsView />
//       </main>
//     </SidebarProvider>
//   );
// }
