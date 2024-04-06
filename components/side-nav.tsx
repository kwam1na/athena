'use client';

import { usePathname } from 'next/navigation';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { buttonVariants } from './ui/button';
import { SideNavRoute } from '@/lib/types';

interface SideNavProps {
   className?: string;
   routes: SideNavRoute[];
}

export function SideNav({ className, routes }: SideNavProps) {
   const pathname = usePathname();

   return (
      <div className={`flex flex-col items-center py-8 ${className}`}>
         <nav className="z-90 flex flex-col w-full gap-4 px-2 group-[[data-collapsed=true]]:justify-center group-[[data-collapsed=true]]:px-2">
            {routes.map((link, index) => (
               <Link
                  key={index}
                  href={link.href}
                  className={cn(
                     buttonVariants({ size: 'sm', variant: 'ghost' }),
                     'justify-start flex',
                     (pathname === link.href ||
                        pathname.includes(link.href) ||
                        link.aliases?.includes(pathname)) &&
                        'bg-muted dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-white',
                  )}
               >
                  <div>{link.icon && link.icon}</div>
                  <div className="flex items-center justify-between w-full">
                     <p>{link.label}</p>
                     <p className="text-muted-foreground font-semibold">
                        {link.secondaryLabel}
                     </p>
                  </div>
               </Link>
            ))}
         </nav>
      </div>
   );
}
