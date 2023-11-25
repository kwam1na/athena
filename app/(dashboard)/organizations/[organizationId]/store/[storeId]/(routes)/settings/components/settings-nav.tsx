'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { Building, CreditCard, List, Store, User } from 'lucide-react';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';

export function SettingsNav({
   className,
   ...props
}: React.HTMLAttributes<HTMLElement>) {
   const pathname = usePathname();
   const baseStoreURL = useGetBaseStoreUrl();

   const routes = [
      {
         href: `${baseStoreURL}/settings/profile`,
         label: 'Profile',
         active: pathname.includes('/settings/profile'),
         icon: <User className="mr-2 h-4 w-4" />,
      },
      {
         href: `${baseStoreURL}/settings/organization`,
         label: 'Organization',
         active: pathname.includes('/settings/organization'),
         icon: <Building className="mr-2 h-4 w-4" />,
      },
      {
         href: `${baseStoreURL}/settings/store`,
         label: 'Store',
         active: pathname.includes('/settings/store'),
         icon: <Store className="mr-2 h-4 w-4" />,
      },
      {
         href: `${baseStoreURL}/settings/preferences`,
         label: 'Preferences',
         active: pathname.includes('/settings/preferences'),
         icon: <List className="mr-2 h-4 w-4" />,
      },
   ];

   return (
      <nav
         className={cn(
            'flex items-center space-x-4 dark:bg-card bg-zinc-100 lg:space-x-6',
            className,
         )}
         {...props}
      >
         {routes.map((route) => (
            <Link
               key={route.href}
               href={route.href}
               className={cn(
                  'text-sm font-medium transition-colors flex hover:text-primary',
                  route.active
                     ? 'text-black dark:text-white bg-background p-2 pr-4 pl-4 rounded-md'
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
