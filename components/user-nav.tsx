'use client';

import { useRouter } from 'next/navigation';

import {
   CreditCard,
   LogOut,
   Moon,
   PlusCircle,
   Settings,
   Sun,
   User,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuGroup,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuShortcut,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from './theme-toggle';
import { useUser } from '@auth0/nextjs-auth0/client';

export function UserNav() {
   const { user, error, isLoading } = useUser();
   const name = user?.name;
   let fallback;

   const names = name?.split(' ');
   if (names) {
      if (names.length == 1) {
         fallback = names[0].charAt(0);
      } else {
         fallback = names[0].charAt(0) + names[1].charAt(0);
      }
   }

   return (
      <DropdownMenu>
         <DropdownMenuTrigger asChild>
            <Button
               variant="ghost"
               className="relative h-8 w-8 p-4 rounded-full"
            >
               <Avatar className="h-8 w-8">
                  <AvatarImage src={''} alt="@shadcn" />
                  <AvatarFallback>
                     {fallback && fallback.toUpperCase()}
                  </AvatarFallback>
               </Avatar>
            </Button>
         </DropdownMenuTrigger>
         <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal pt-4 pb-4">
               <div className="flex flex-col space-y-2">
                  <p className="text-sm font-medium leading-none">{name}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                     {user?.email}
                  </p>
               </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
               <Sun className="mr-2 h-[1rem] w-[1rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
               <Moon className="mr-2 absolute h-[1rem] w-[1rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
               <span>Theme</span>
               <div className="ml-auto">
                  <ThemeToggle />
               </div>
            </DropdownMenuItem>
            <DropdownMenuItem className="pt-2 pb-2">
               <LogOut className="mr-2 h-4 w-4" />
               <a className="w-full h-full" href="/api/auth/logout">
                  Logout
               </a>
            </DropdownMenuItem>
         </DropdownMenuContent>
      </DropdownMenu>
   );
}
