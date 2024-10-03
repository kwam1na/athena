import View from "./View";
import { useLoaderData, useNavigate, useParams } from "@tanstack/react-router";
import { EmptyState } from "./states/empty/empty-state";
import { StoreIcon } from "lucide-react";
import { Button } from "./ui/button";
import { PlusIcon } from "@radix-ui/react-icons";
import { useStoreModal } from "@/hooks/use-store-modal";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";
import { useEffect } from "react";
import { Product, Store } from "@athena/db";

export default function StoreView() {
  const Navigation = () => {
    return (
      <div className="flex gap-2 h-[40px]">
        <div className="flex items-center"></div>
      </div>
    );
  };

  const storeModal = useStoreModal();

  const navigate = useNavigate();

  const { activeOrganization } = useGetActiveOrganization();

  const { storeUrlSlug } = useParams({ strict: false });

  const url = storeUrlSlug
    ? "/_authed/$orgUrlSlug/store/$storeUrlSlug/"
    : "/_authed/$orgUrlSlug/store/";

  const data: { store: Store; products: Product[] } | { stores: Store[] } =
    useLoaderData({
      from: url,
    });

  const { stores } = data as { stores: Store[] };
  const { store } = data as { store: Store };

  useEffect(() => {
    if ((stores && stores.length > 0) || store) {
      const s = stores?.[0] || store;

      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/products",
        params: (prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: s.slug,
        }),
      });
    }
  }, [stores, store]);

  const noStoresPresent = (stores && stores.length == 0) || !store;

  return (
    <View className="bg-background" header={<Navigation />}>
      {noStoresPresent && (
        <EmptyState
          icon={<StoreIcon className="w-16 h-16 text-muted-foreground" />}
          text={
            <div className="flex gap-1 text-sm">
              <p className="text-muted-foreground">No stores for</p>
              <p className="font-medium">{activeOrganization?.name}</p>
            </div>
          }
          cta={
            <Button variant={"outline"} onClick={() => storeModal.onOpen()}>
              <PlusIcon className="w-3 h-3 mr-2" />
              Add store
            </Button>
          }
        />
      )}
    </View>
  );
}
