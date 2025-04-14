import { useAction, useQuery } from "convex/react";
// import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useGetActiveOrganization } from "./useGetOrganizations";
import { api } from "~/convex/_generated/api";
import { useEffect, useState } from "react";
import { Store } from "~/types";

export default function useGetActiveStore() {
  const { activeOrganization } = useGetActiveOrganization();

  const [store, setStore] = useState<Store | null>(null);

  const stores = useQuery(
    api.inventory.stores.getAll,
    activeOrganization?._id
      ? {
          organizationId: activeOrganization._id,
        }
      : "skip"
  );

  const getStores = useAction(api.inventory.stores.getAllByOrganization);

  useEffect(() => {
    const fetchStores = async () => {
      if (activeOrganization?._id) {
        const { storesWithReelVersions } = await getStores({
          organizationId: activeOrganization._id,
        });

        setStore(storesWithReelVersions[0]);

        // console.log("s", s);
      }
    };
    fetchStores();
  }, [activeOrganization?._id, getStores]);

  const { storeUrlSlug } = useParams({ strict: false });

  const activeStore = stores?.find((store: any) => store.slug == storeUrlSlug);

  return {
    activeStore: store,
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
