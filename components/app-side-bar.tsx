'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { Banknote, LayoutDashboard, Package, Settings } from 'lucide-react';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';
import { AthenLogo } from '@/app/assets/athena-logo';

export function AppSideBar({
   className,
   ...props
}: React.HTMLAttributes<HTMLElement>) {
   const pathname = usePathname();
   const baseStoreURL = useGetBaseStoreUrl();

   const routes = [
      {
         href: `${baseStoreURL}`,
         label: 'Dashboard',
         active: pathname === `${baseStoreURL}`,
         icon: <LayoutDashboard className="mr-2 h-6 w-6" />,
      },
      {
         href: `${baseStoreURL}/inventory/products`,
         label: 'Inventory',
         active: pathname.includes('/inventory'),
         icon: <Package className="mr-2 h-6 w-6" />,
      },
      {
         href: `${baseStoreURL}/transactions`,
         label: 'Transactions',
         active: pathname.includes('/transactions'),
         icon: <Banknote className="mr-2 h-6 w-6" />,
      },
      {
         href: `${baseStoreURL}/settings/profile`,
         label: 'Settings',
         active: pathname.includes('/settings'),
         icon: <Settings className="mr-2 h-6 w-6" />,
      },
   ];

   return (
      <div className={cn('flex flex-col px-4 space-y-12 h-full', className)}>
         <div className="w-[64px] h-[64px]">
            <AthenLogo />
         </div>

         {/* <p className="text-4xl">athena</p> */}
         <nav
            className="flex flex-col items-center justify-center gap-6"
            {...props}
         >
            {routes.map((route) => (
               <Link
                  key={route.href}
                  href={route.href}
                  className={cn(
                     'w-full text-sm font-medium transition-colors hover:text-primary h-[40px] flex gap-3 items-center',
                     route.active
                        ? 'text-black dark:text-white rounded-lg'
                        : 'text-muted-foreground',
                  )}
               >
                  {route.icon}
                  {route.label}
               </Link>
            ))}
         </nav>
      </div>
   );
}
