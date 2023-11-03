'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, PlusCircle, Store } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
   CommandSeparator,
} from '@/components/ui/command';
import {
   Popover,
   PopoverContent,
   PopoverTrigger,
} from '@/components/ui/popover';
import { useStoreModal } from '@/hooks/use-store-modal';
import { useParams, useRouter } from 'next/navigation';
import { useStoreCurrency } from '@/providers/currency-provider';
import { ActionModal } from './modals/action-modal';
import { OverlayModal } from './modals/overlay-modal';
import { Icons } from './ui/icons';
import axios from 'axios';
import { set } from 'date-fns';

type PopoverTriggerProps = React.ComponentPropsWithoutRef<
   typeof PopoverTrigger
>;

interface StoreSwitcherProps extends PopoverTriggerProps {
   items: Record<string, any>[];
}

export default function StoreSwitcher({
   className,
   items = [],
}: StoreSwitcherProps) {
   const [isSwitching, setIsSwitching] = React.useState(false);
   const storeModal = useStoreModal();
   const params = useParams();
   const router = useRouter();
   const { setStoreCurrency } = useStoreCurrency();

   const formattedItems = items.map((item) => ({
      label: item.name,
      value: item.id,
   }));

   const currentStore = formattedItems.find(
      (item) => item.value === parseInt(params.storeId),
   );

   const [open, setOpen] = React.useState(false);

   const onStoreSelect = async (store: { value: string; label: string }) => {
      setIsSwitching(true);

      try {
         const res = await axios.get(`/api/v1/stores/${store.value}`);
         const { currency } = res?.data || {};
         setStoreCurrency(currency);
      } catch (error) {
         console.error(error);
      } finally {
         router.push(`/${store.value}`);
         setOpen(false);
         setIsSwitching(false);
      }
   };

   return (
      <>
         <OverlayModal
            isOpen={isSwitching}
            title={''}
            description={''}
            onClose={() => console.log('nay')}
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
                  className={cn('justify-between', className)}
               >
                  <Store className="mr-2 h-4 w-4" />
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
                              <Store className="mr-2 h-4 w-4" />
                              {store.label}
                              <Check
                                 className={cn(
                                    'ml-auto h-4 w-4',
                                    currentStore?.value === store.value
                                       ? 'opacity-100'
                                       : 'opacity-0',
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
