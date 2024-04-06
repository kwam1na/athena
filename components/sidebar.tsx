'use client';

import React from 'react';
import { SideNav } from './side-nav';
import { SideNavRoute } from '@/lib/types';
import { usePathname } from 'next/navigation';

interface SibebarProps {
   children: React.ReactNode;
   collapsible?: boolean;
   defaultCollapsed?: boolean;
   routes: SideNavRoute[];
   sideNavClassName?: string;
   hideWhenOnRoutes?: string[];
   withAnimation?: boolean;
}

export const Sidebar = ({
   children,
   hideWhenOnRoutes = [],
   routes,
   sideNavClassName,
}: SibebarProps) => {
   const pathname = usePathname();

   const isOnMainPath = routes.some(
      (route) =>
         route.href === pathname ||
         route.aliases?.some((alias) => alias === pathname),
   );

   const shouldHideSideNav =
      hideWhenOnRoutes.some((route) => pathname.includes(route)) ||
      !isOnMainPath;

   return (
      <>
         {!shouldHideSideNav && (
            <SideNav className={sideNavClassName} routes={routes} />
         )}
         <div
            className={`${shouldHideSideNav ? 'px-32' : 'pl-80'} pt-24 pb-32`}
         >
            {children}
         </div>
      </>
   );
};
