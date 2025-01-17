"use client";

import * as React from "react";
import {
  Building,
  Check,
  ChevronsUpDown,
  PlusCircle,
  Store,
} from "lucide-react";

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
import { useStoreModal } from "@/hooks/use-store-modal";
import { OverlayModal } from "./ui/modals/overlay-modal";
import { useStoreCurrency } from "./providers/currency-provider";
import { StoreResponse } from "@/lib/schemas/store";
import { useUserContext } from "@/contexts/UserContext";

type PopoverTriggerProps = React.ComponentPropsWithoutRef<
  typeof PopoverTrigger
>;

interface StoreSwitcherProps extends PopoverTriggerProps {
  items: StoreResponse[];
}

export default function StoreSwitcher({
  className,
  items = [],
}: StoreSwitcherProps) {
  const [isSwitching, setIsSwitching] = React.useState(false);
  const storeModal = useStoreModal();
  const { setStoreCurrency } = useStoreCurrency();
  const { user, setActiveStore } = useUserContext();

  const formattedItems = items.map((item) => ({
    label: item.storeName,
    value: item.id,
  }));

  const currentStore = formattedItems.find(
    (item) => item.value === user.activeStoreId
  );

  const [open, setOpen] = React.useState(false);

  const onStoreSelect = async (store: { value: string; label: string }) => {
    // setIsSwitching(true);

    setActiveStore(store.value);

    try {
      // const res = await axios.get(`/api/v1/stores/${store.value}`);
      // const { currency } = res?.data || {};
      // setStoreCurrency(currency);
    } catch (error) {
      console.error(error);
    } finally {
      // router.push(`/${store.value}/services`);
      setOpen(false);
      // setIsSwitching(false);
    }
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
            Switching stores..
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
            aria-label="Select a store"
            className={cn("justify-between", className)}
          >
            <Building className="mr-2 h-4 w-4" />
            {currentStore?.label}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[250px] p-0">
          <Command>
            <CommandList>
              <CommandInput placeholder="Search store..." />
              <CommandEmpty>No store found.</CommandEmpty>
              <CommandGroup heading="Stores">
                {formattedItems.map((store) => (
                  <CommandItem
                    key={store.value}
                    onSelect={() => onStoreSelect(store)}
                    className="text-sm"
                  >
                    <Building className="mr-2 h-4 w-4" />
                    {store.label}
                    <Check
                      className={cn(
                        "ml-auto h-4 w-4",
                        currentStore?.value === store.value
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <CommandSeparator />
            <CommandList>
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    setOpen(false);
                    storeModal.onOpen();
                  }}
                >
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Create store
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
