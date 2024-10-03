import { NotFoundView } from "@/components/states/not-found/NotFoundView";
import StoreView from "@/components/StoreView";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";
// import { getOrganization } from '@/server-actions/organizations'
// import { getStores } from '@/server-actions/stores'
import { createFileRoute, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/$orgUrlSlug/store/")({
  // beforeLoad: () => {
  //   const { activeOrganization } = useGetActiveOrganization();

  //   if (!activeOrganization) throw notFound();
  // },

  // loader: async ({ params: { orgUrlSlug } }) => {
  //   // const org = await getOrganization(orgUrlSlug)

  //   // const organiztions = useGetOrganizations();

  //   const { activeOrganization } = useGetActiveOrganization()

  //   const org = {};
  //   const stores = {};
  //   const product = {};

  //   if (!activeOrganization) throw notFound();

  //   // const stores = await getStores(org.id)

  //   return {
  //     org,
  //     stores,
  //   };
  // },

  component: StoreView,

  notFoundComponent: () => {
    const { orgUrlSlug } = Route.useParams();
    return <NotFoundView entity="organization" entityIdentifier={orgUrlSlug} />;
  },
});
