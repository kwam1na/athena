'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { Banknote, LayoutDashboard, Package, Settings } from 'lucide-react';

export function AppNav({
   className,
   ...props
}: React.HTMLAttributes<HTMLElement>) {
   const pathname = usePathname();
   const params = useParams();

   const routes = [
      {
         href: `/${params.storeId}`,
         label: 'Dashboard',
         active: pathname === `/${params.storeId}`,
         icon: <LayoutDashboard className="mr-2 h-4 w-4" />,
      },
      {
         href: `/${params.storeId}/inventory/products`,
         label: 'Inventory',
         active: pathname.includes('/inventory'),
         icon: <Package className="mr-2 h-4 w-4" />,
      },
      {
         href: `/${params.storeId}/transactions`,
         label: 'Transactions',
         active: pathname.includes('/transactions'),
         icon: <Banknote className="mr-2 h-4 w-4" />,
      },
      //   {
      //      href: `/${params.storeId}/inventory/colors`,
      //      label: 'Orders',
      //      active: pathname === `/${params.storeId}/inventory/colors`,
      //   },
      {
         href: `/${params.storeId}/settings/profile`,
         label: 'Settings',
         active: pathname.includes('/settings'),
         icon: <Settings className="mr-2 h-4 w-4" />,
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
                  'text-sm font-medium transition-colors hover:text-primary flex items-center',
                  route.active
                     ? 'text-black dark:text-white p-2 pr-4 pl-4 border-b-2 border-muted-foreground'
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
