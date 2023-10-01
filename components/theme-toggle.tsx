'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Check, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
} from '@/components/ui/command';
import {
   Popover,
   PopoverContent,
   PopoverTrigger,
} from '@/components/ui/popover';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { capitalizeWord } from '@/lib/utils';

export function ThemeToggle() {
   const { theme, setTheme } = useTheme();
   const [open, setOpen] = React.useState(false);
   const [value, setValue] = React.useState('');

   const themes = [
      {
         label: 'Light',
         value: 'light',
      },
      {
         label: 'Dark',
         value: 'dark',
      },
      {
         label: 'System',
         value: 'system',
      },
   ];

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <Button
               variant="outline"
               role="combobox"
               aria-expanded={open}
               className="w-[200px] justify-between"
            >
               <span>{capitalizeWord(theme || 'system')}</span>
               <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
         </PopoverTrigger>
         <PopoverContent className="w-[200px] p-0">
            <Command>
               <CommandGroup>
                  {themes.map((t) => (
                     <CommandItem
                        key={t.value}
                        onSelect={() => {
                           setTheme(t.value);
                           setOpen(false);
                        }}
                     >
                        <Check
                           className={cn(
                              'mr-2 h-4 w-4',
                              theme === t.value ? 'opacity-100' : 'opacity-0',
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
