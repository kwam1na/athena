import { useQuery } from "convex/react";
// import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useGetActiveOrganization } from "./useGetOrganizations";
import { api } from "~/convex/_generated/api";

export default function useGetActiveStore() {
  const { activeOrganization } = useGetActiveOrganization();

  const stores = useQuery(
    api.inventory.stores.getAll,
    activeOrganization?._id
      ? {
          organizationId: activeOrganization._id,
        }
      : "skip"
  );

  const { storeUrlSlug } = useParams({ strict: false });

  const activeStore = stores?.find((store: any) => store.slug == storeUrlSlug);

  return {
    activeStore,
    isLoadingStores: false,
  };
}

export function useGetStores() {
  const { activeOrganization } = useGetActiveOrganization();

  const stores = useQuery(
    api.inventory.stores.getAll,
    activeOrganization?._id
      ? {
          organizationId: activeOrganization._id,
        }
      : "skip"
  );

  return stores;
}
