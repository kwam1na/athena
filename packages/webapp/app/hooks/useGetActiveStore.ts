import { getAllStores } from "@/api/stores";
import { useQuery } from "@tanstack/react-query";
import { useLoaderData, useParams } from "@tanstack/react-router";
import { useGetActiveOrganization } from "./useGetOrganizations";
import { Store } from "@athena/db";

export default function useGetActiveStore() {
  const { activeOrganization } = useGetActiveOrganization();

  const {
    data: stores,
    isLoading: isLoadingStores,
    isFetching,
  } = useQuery({
    queryKey: ["stores", activeOrganization?.id],
    queryFn: () => getAllStores(activeOrganization!.id),
    enabled: Boolean(activeOrganization),
  });

  const { storeUrlSlug } = useParams({ strict: false });

  const activeStore = stores?.find((store) => store.slug == storeUrlSlug);

  return {
    activeStore,
    isLoadingStores: isLoadingStores || isFetching,
  };
}
