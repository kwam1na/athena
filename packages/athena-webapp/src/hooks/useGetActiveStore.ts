import { useQuery } from "convex/react";
// import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useGetActiveOrganization } from "./useGetOrganizations";
import { api } from "~/convex/_generated/api";
import { Store } from "~/types";

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

  const activeStore = (stores?.find(
    (store: Store) => store.slug === storeUrlSlug,
  ) ?? null) as Store | null;

  return {
    activeStore,
    isLoadingStores: Boolean(activeOrganization?._id && stores === undefined),
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
