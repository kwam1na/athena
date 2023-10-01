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
import { useUser } from '@auth0/nextjs-auth0/client';
import { Card, CardContent } from './ui/card';
import {
   Tooltip,
   TooltipContent,
   TooltipProvider,
   TooltipTrigger,
} from './ui/tooltip';
import { Skeleton } from './ui/skeleton';
import { useWrappedUser } from '@/providers/wrapped-user-provider';

export function UserInfo() {
   const { user, error, isLoading } = useUser();
   const { wrappedUser, isLoading: isLoadingWrappedUser } = useWrappedUser();

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
      <Card className="col-span-4 h-40 bg-background">
         <CardContent className="flex gap-4 py-10 w-full justify-between">
            <div className="flex gap-4">
               <Avatar className="h-8 w-8">
                  <AvatarImage src={''} alt="@shadcn" />
                  <AvatarFallback>
                     {fallback && fallback.toUpperCase()}
                  </AvatarFallback>
               </Avatar>

               <div className="flex flex-col gap-4">
                  <div className="space-y-2 pl-2">
                     {isLoadingWrappedUser ? (
                        <>
                           <Skeleton className="h-4 w-[100px]" />
                           <Skeleton className="h-4 w-[80px]" />
                        </>
                     ) : (
                        <>
                           <p className="text-sm font-medium leading-none">
                              {name}
                           </p>
                           <p className="text-xs leading-none text-muted-foreground">
                              {wrappedUser?.email}
                           </p>
                        </>
                     )}
                  </div>

                  <a
                     className="flex items-center gap-2 w-full h-full text-sm bg-card px-4 py-2 rounded-md transition-colors hover:text-primary text-muted-foreground"
                     href="/api/auth/logout"
                  >
                     Logout
                     <LogOut className="mr-2 h-4 w-4" />
                  </a>
               </div>
            </div>
         </CardContent>
      </Card>
   );
}
