import View from "./View";
import { useGetOrganizations } from "@/hooks/useGetOrganizations";
import { EmptyState } from "./states/empty/empty-state";
import { BuildingIcon, PlusIcon } from "lucide-react";
import { Button } from "./ui/button";
import { useLoaderData, useNavigate } from "@tanstack/react-router";
import { useOrganizationModal } from "@/hooks/useOrganizationModal";
import { useStoreModal } from "@/hooks/use-store-modal";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAllOrganizations } from "@/api/organization";

export default function OrganizationsView() {
  const Navigation = () => {
    return <div className="flex gap-2 h-[40px]"></div>;
  };

  const { data: organizations } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => getAllOrganizations(),
  });

  const organizationModal = useOrganizationModal();

  const navigate = useNavigate();

  useEffect(() => {
    const organization = organizations?.[0];

    if (organization) {
      navigate({
        to: "/$orgUrlSlug/store",
        params: { orgUrlSlug: organization.slug },
      });
    }
  }, [organizations]);

  return (
    <View className="bg-background" header={<Navigation />}>
      {organizations?.length == 0 && (
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
