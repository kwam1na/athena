import { Building2, Check, ChevronsUpDown, Cog } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Icons } from "./ui/icons";
import { OverlayModal } from "./ui/modals/overlay-modal";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getAllStores } from "@/api/stores";
import { useEffect, useState } from "react";
import { useOrganizationModal } from "@/hooks/useOrganizationModal";
import { Organization } from "~/types";
import { useGetStores } from "../hooks/useGetActiveStore";
// import { Organization } from "@athena/db";

type PopoverTriggerProps = React.ComponentPropsWithoutRef<
  typeof PopoverTrigger
>;

interface OrganizationSwitcherProps extends PopoverTriggerProps {
  items: Organization[];
}

type OrganizationSelectItem = {
  value: string;
  label: string;
  url: string;
};

export default function OrganizationSwitcher({
  className,
  items = [],
}: OrganizationSwitcherProps) {
  const organizationModal = useOrganizationModal();

  const [isSwitching, setIsSwitching] = useState(false);
  const [selectedOrganization, setSelectedOrganization] =
    useState<OrganizationSelectItem | null>(null);
  const [open, setOpen] = useState(false);

  const { orgUrlSlug } = useParams({ strict: false });

  const stores = useGetStores();

  const formattedItems = items.map((item) => ({
    label: item.name,
    value: item._id,
    url: item.slug,
  }));

  const orgMatchedFromParams = items.find((org) => org.slug == orgUrlSlug);

  const currentOrganization = formattedItems.find(
    (item) => item.value === orgMatchedFromParams?._id
  );

  const navigate = useNavigate();

  useEffect(() => {
    if (selectedOrganization && stores) {
      const store = stores[0];

      if (store) {
        navigate({
          to: "/$orgUrlSlug/store/$storeUrlSlug/products",
          params: (prev) => ({
            ...prev,
            orgUrlSlug: selectedOrganization.url,
            storeUrlSlug: store.slug,
          }),
        });
      } else {
        navigate({
          to: "/$orgUrlSlug/store",
          params: (prev) => ({
            ...prev,
            orgUrlSlug: selectedOrganization.url,
          }),
        });
      }
    }
  }, [selectedOrganization, stores]);

  const onOrganizationSelect = async (organization: OrganizationSelectItem) => {
    setSelectedOrganization(organization);
    setOpen(false);
  };

  return (
    <>
      <OverlayModal
        isOpen={isSwitching}
        title={""}
        description={""}
        onClose={() => console.log("nay")}
        withoutHeader={true}
      >
        <div className="flex justify-center items-center">
          <Icons.spinner className="mr-2 h-4 w-4 text-muted-foreground animate-spin" />
          <p className="text-sm text-center text-muted-foreground">
            Switching organizations..
          </p>
        </div>
      </OverlayModal>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label="Select an organization"
            className={cn("justify-between", className)}
          >
            <Building2 className="mr-2 h-4 w-4" />
            {currentOrganization?.label}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[250px] p-0">
          <Command>
            <CommandList>
              {/* <CommandInput placeholder="Search organization..." />
              <CommandEmpty>No organization found.</CommandEmpty> */}
              <CommandGroup heading="Organization">
                {formattedItems.map((organization) => (
                  <CommandItem
                    key={organization.value}
                    onSelect={() => onOrganizationSelect(organization)}
                    className="text-sm"
                  >
                    <Building2 className="mr-2 h-4 w-4" />
                    {organization.label}
                    {/* <Check
                      className={cn(
                        "ml-auto h-4 w-4",
                        currentOrganization?.value === organization.value
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    /> */}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <CommandSeparator />
            <CommandList>
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    navigate({
                      to: "/$orgUrlSlug/settings/organization",
                      params: (prev) => ({
                        ...prev,
                        orgUrlSlug: prev.orgUrlSlug!,
                      }),
                    });
                    setOpen(false);
                  }}
                >
                  {/* <Cog className="mr-2 h-4 w-4 text-muted-foreground" /> */}
                  Organization settings
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
