'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

export function InventoryNav({
   className,
   ...props
}: React.HTMLAttributes<HTMLElement>) {
   const pathname = usePathname();
   const params = useParams();

   const routes = [
      {
         href: `/${params.storeId}/inventory/products`,
         label: 'Products',
         active: pathname === `/${params.storeId}/inventory/products`,
      },
      {
         href: `/${params.storeId}/inventory/categories`,
         label: 'Categories',
         active: pathname === `/${params.storeId}/inventory/categories`,
      },
      {
         href: `/${params.storeId}/inventory/subcategories`,
         label: 'Subcategories',
         active: pathname === `/${params.storeId}/inventory/subcategories`,
      },
      {
         href: `/${params.storeId}/inventory/colors`,
         label: 'Colors',
         active: pathname === `/${params.storeId}/inventory/colors`,
      },
      {
         href: `/${params.storeId}/inventory/sizes`,
         label: 'Sizes',
         active: pathname === `/${params.storeId}/inventory/sizes`,
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
                  'text-sm font-medium transition-colors hover:text-primary',
                  route.active
                     ? 'text-black dark:text-white'
                     : 'text-muted-foreground',
               )}
            >
               {route.label}
            </Link>
         ))}
      </nav>
   );
}
