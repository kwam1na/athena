'use client';

import * as React from 'react';
import {
   Building,
   Check,
   ChevronsUpDown,
   PlusCircle,
   Store,
} from 'lucide-react';

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

export default function OrganizationSwitcher({
   className,
   items = [],
}: StoreSwitcherProps) {
   const [isSwitching, setIsSwitching] = React.useState(false);
   const storeModal = useStoreModal();
   const params = useParams();
   const router = useRouter();

   const formattedItems = items.map((item) => ({
      label: item.name,
      value: item.id,
   }));

   // const currentOrganization = formattedItems.find(
   //    (item) => item.value === params.storeId,
   // );
   const currentOrganization = formattedItems[0];

   const [open, setOpen] = React.useState(false);

   const onOrganizationSelect = async (organization: {
      value: string;
      label: string;
   }) => {
      setIsSwitching(true);

      try {
         const res = await axios.get(
            `/api/v1/organizations/${organization.value}`,
         );
      } catch (error) {
         console.error(error);
      } finally {
         router.push(`/${organization.value}`);
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
                  aria-label="Select a store"
                  className={cn('justify-between', className)}
               >
                  <Building className="mr-2 h-4 w-4" />
                  {currentOrganization?.label}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
               </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[250px] p-0">
               <Command>
                  <CommandList>
                     {/* <CommandInput placeholder="Search organization..." />
                     <CommandEmpty>No organization found.</CommandEmpty> */}
                     <CommandGroup heading="Organizations">
                        {formattedItems.map((organization) => (
                           <CommandItem
                              key={organization.value}
                              // onSelect={() =>
                              //    onOrganizationSelect(organization)
                              // }
                              className="text-sm"
                           >
                              <Building className="mr-2 h-4 w-4" />
                              {organization.label}
                              <Check
                                 className={cn(
                                    'ml-auto h-4 w-4',
                                    currentOrganization?.value ===
                                       organization.value
                                       ? 'opacity-100'
                                       : 'opacity-0',
                                 )}
                              />
                           </CommandItem>
                        ))}
                     </CommandGroup>
                  </CommandList>
                  {/* <CommandSeparator />
                  <CommandList>
                     <CommandGroup>
                        <CommandItem
                           onSelect={() => {
                              setOpen(false);
                              storeModal.onOpen();
                           }}
                        >
                           <PlusCircle className="mr-2 h-4 w-4" />
                           Create organization
                        </CommandItem>
                     </CommandGroup>
                  </CommandList> */}
               </Command>
            </PopoverContent>
         </Popover>
      </>
   );
}
