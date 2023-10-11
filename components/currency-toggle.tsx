'use client';

import * as React from 'react';

import { Check, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
   Command,
   CommandGroup,
   CommandInput,
   CommandItem,
} from '@/components/ui/command';
import {
   Popover,
   PopoverContent,
   PopoverTrigger,
} from '@/components/ui/popover';

import { currencies } from '@/lib/constants';

export function CurrencyToggle({
   currency,
   setCurrency,
}: {
   currency: string;
   setCurrency: (currency: string) => void;
}) {
   const [open, setOpen] = React.useState(false);

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <Button
               variant="outline"
               role="combobox"
               aria-expanded={open}
               className="w-[200px] justify-between"
            >
               <span>{currency.toUpperCase()}</span>
               <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
         </PopoverTrigger>
         <PopoverContent className="w-[200px] p-0">
            <Command>
               <CommandGroup>
                  {currencies.map((t) => (
                     <CommandItem
                        key={t.value}
                        onSelect={() => {
                           setCurrency(t.value);
                           setOpen(false);
                        }}
                     >
                        <Check
                           className={cn(
                              'mr-2 h-4 w-4',
                              currency === t.value
                                 ? 'opacity-100'
                                 : 'opacity-0',
                           )}
                        />
                        {t.label}
                     </CommandItem>
                  ))}
               </CommandGroup>
            </Command>
         </PopoverContent>
      </Popover>
   );
}
