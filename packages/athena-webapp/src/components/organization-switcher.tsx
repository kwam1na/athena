import { Building, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { ComponentPropsWithoutRef } from "react";
import { useEffect, useState } from "react";
import type { Organization } from "~/types";
import { useGetStores } from "../hooks/useGetActiveStore";

type PopoverTriggerProps = ComponentPropsWithoutRef<typeof PopoverTrigger>;

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
    (item) => item.value === orgMatchedFromParams?._id,
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
  }, [navigate, selectedOrganization, stores]);

  const onOrganizationSelect = async (organization: OrganizationSelectItem) => {
    setSelectedOrganization(organization);
    setOpen(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label="Select an organization"
            className={cn(
              "w-fit min-w-0 max-w-[14rem] justify-start",
              className,
            )}
          >
            <Building className="mr-2 h-4 w-4" />
            <span className="min-w-0 truncate">
              {currentOrganization?.label}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[250px] p-0">
          <Command>
            <CommandList>
              {/* <CommandInput placeholder="Search organization..." />
              <CommandEmpty>No organization found</CommandEmpty> */}
              <CommandGroup heading="Organization">
                {formattedItems.map((organization) => (
                  <CommandItem
                    key={organization.value}
                    onSelect={() => onOrganizationSelect(organization)}
                    className="text-sm"
                  >
                    <Building className="mr-2 h-4 w-4" />
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
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
