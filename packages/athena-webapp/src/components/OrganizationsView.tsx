import View from "./View";
import { useGetOrganizations } from "@/hooks/useGetOrganizations";
import { EmptyState } from "./states/empty/empty-state";
import { BuildingIcon, PlusIcon } from "lucide-react";
import { Button } from "./ui/button";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useOrganizationModal } from "@/hooks/useOrganizationModal";
import { useEffect } from "react";
import { useGetStores } from "../hooks/useGetActiveStore";

export default function OrganizationsView() {
  const Navigation = () => {
    return <div className="flex gap-2 h-[40px]"></div>;
  };

  const organizations = useGetOrganizations();

  const organizationModal = useOrganizationModal();

  const navigate = useNavigate();

  const stores = useGetStores();

  const { orgUrlSlug } = useParams({ strict: false });

  useEffect(() => {
    if (stores && stores.length > 0 && orgUrlSlug) {
      const store = stores[0];

      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/products",
        params: (prev) => ({
          ...prev,
          orgUrlSlug,
          storeUrlSlug: store.slug,
        }),
      });
    }
  }, [stores, orgUrlSlug]);

  return (
    <View className="bg-background" header={<Navigation />}>
      {organizations && organizations?.length == 0 && (
        <EmptyState
          icon={<BuildingIcon className="w-16 h-16 text-muted-foreground" />}
          text={
            <div className="flex gap-1 text-sm">
              <p className="text-muted-foreground">No organizations</p>
            </div>
          }
          cta={
            <Button
              variant={"outline"}
              onClick={() => organizationModal.onOpen()}
            >
              <PlusIcon className="w-3 h-3 mr-2" />
              Create organization
            </Button>
          }
        />
      )}
    </View>
  );
}
