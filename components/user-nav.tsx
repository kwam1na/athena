'use client';

import { useParams, useRouter } from 'next/navigation';

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
import { useWrappedUser } from '@/providers/wrapped-user-provider';
import Link from 'next/link';

export function UserNav() {
   const params = useParams();
   const { wrappedUser, isLoading } = useWrappedUser();

   const name = wrappedUser?.name;
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
                     {wrappedUser?.email}
                  </p>
               </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
               <Link href={`/${params.storeId}/settings/profile`}>
                  <DropdownMenuItem className="pt-2 pb-2">
                     <User className="mr-2 h-4 w-4" />
                     <span>Profile</span>
                     <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
                  </DropdownMenuItem>
               </Link>
               {/* <DropdownMenuItem className="pt-2 pb-2">
                  <CreditCard className="mr-2 h-4 w-4" />
                  <span>Billing</span>
                  <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
               </DropdownMenuItem>
               <DropdownMenuItem className="pt-2 pb-2">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                  <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
               </DropdownMenuItem>
               <DropdownMenuItem className="pt-2 pb-2">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  <span>New Team</span>
               </DropdownMenuItem> */}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />

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
