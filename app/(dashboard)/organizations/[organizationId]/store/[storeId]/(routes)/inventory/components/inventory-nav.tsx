'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import useGetBaseStoreUrl from '@/hooks/use-get-base-store-url';

export function InventoryNav({
   className,
   ...props
}: React.HTMLAttributes<HTMLElement>) {
   const pathname = usePathname();
   const baseStoreURL = useGetBaseStoreUrl();

   const routes = [
      {
         href: `${baseStoreURL}/inventory/products`,
         label: 'Products',
         active: pathname.includes('/inventory/products'),
      },
      {
         href: `${baseStoreURL}/inventory/categories`,
         label: 'Categories',
         active: pathname.includes('/inventory/categories'),
      },
      {
         href: `${baseStoreURL}/inventory/subcategories`,
         label: 'Subcategories',
         active: pathname.includes('/inventory/subcategories'),
      },
      {
         href: `${baseStoreURL}/inventory/colors`,
         label: 'Colors',
         active: pathname.includes('/inventory/colors'),
      },
      {
         href: `${baseStoreURL}/inventory/sizes`,
         label: 'Sizes',
         active: pathname.includes('/inventory/sizes'),
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
                     ? 'text-black dark:text-white bg-muted p-2 pr-4 pl-4 rounded-md'
                     : 'text-muted-foreground',
               )}
            >
               {route.label}
            </Link>
         ))}
      </nav>
   );
}
