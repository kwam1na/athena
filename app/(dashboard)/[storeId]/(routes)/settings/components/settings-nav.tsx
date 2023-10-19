'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { CreditCard, List, Store, User } from 'lucide-react';

export function SettingsNav({
   className,
   ...props
}: React.HTMLAttributes<HTMLElement>) {
   const pathname = usePathname();
   const params = useParams();

   const routes = [
      {
         href: `/${params.storeId}/settings/profile`,
         label: 'Profile',
         active: pathname === `/${params.storeId}/settings/profile`,
         icon: <User className="mr-2 h-4 w-4" />,
      },
      {
         href: `/${params.storeId}/settings/store`,
         label: 'Store',
         active: pathname === `/${params.storeId}/settings/store`,
         icon: <Store className="mr-2 h-4 w-4" />,
      },
      // {
      //    href: `/${params.storeId}/settings/billing`,
      //    label: 'Billing',
      //    active: pathname === `/${params.storeId}/settings/billing`,
      //    icon: <CreditCard className="mr-2 h-4 w-4" />,
      // },
      {
         href: `/${params.storeId}/settings/preferences`,
         label: 'Preferences',
         active: pathname === `/${params.storeId}/settings/preferences`,
         icon: <List className="mr-2 h-4 w-4" />,
      },
   ];

   return (
      <nav
         className={cn('flex items-center space-x-4 lg:space-x-6', className)}
         {...props}
      >
         {routes.map((route) => (
            <Link
               key={route.href}
               href={route.href}
               className={cn(
                  'flex flex-cols items-center text-sm font-medium transition-colors hover:text-primary',
                  route.active
                     ? 'text-black dark:text-white bg-muted p-2 pr-4 pl-4 rounded-md'
                     : 'text-muted-foreground',
               )}
            >
               {route.icon}
               {route.label}
            </Link>
         ))}
      </nav>
   );
}
