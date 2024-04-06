'use client';

import { usePathname } from 'next/navigation';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { buttonVariants } from './ui/button';
import {
   MAIN_BODY_WIDTH_COLLAPSED,
   MAIN_BODY_WIDTH_EXPANDED,
   SIDE_BAR_WIDTH_COLLAPSED,
   SIDE_BAR_WIDTH_EXPANDED,
} from '@/lib/constants';
import { fadeInAnimation } from '@/lib/animation/constants';
import { SideNavRoute } from '@/lib/types';
import { useEffect } from 'react';

interface SideNavProps {
   className?: string;
   collapsible?: boolean;
   isCollapsed?: boolean;
   routes: SideNavRoute[];
   setSidebarWidth?: (width: number) => void;
   setMainBodyWidth?: (width: number) => void;
   setIsCollapsed?: (collapsed: boolean) => void;
   withAnimation?: boolean;
}

export function SideNav({
   className,
   collapsible,
   isCollapsed,
   routes,
   setIsCollapsed,
   setSidebarWidth,
   setMainBodyWidth,
   withAnimation,
}: SideNavProps) {
   const pathname = usePathname();

   const collapseSidebar = () => {
      setIsCollapsed?.(true);

      setSidebarWidth?.(SIDE_BAR_WIDTH_COLLAPSED);
      setMainBodyWidth?.(MAIN_BODY_WIDTH_COLLAPSED);
   };

   const expandeSidebar = () => {
      setIsCollapsed?.(false);

      setSidebarWidth?.(SIDE_BAR_WIDTH_EXPANDED);
      setMainBodyWidth?.(MAIN_BODY_WIDTH_EXPANDED);
   };

   const animate = withAnimation ? 'hidden' : 'visible';

   return (
      <div
         className={`flex flex-col items-center py-8 ${className}`}
         onMouseEnter={collapsible ? expandeSidebar : undefined}
         onMouseLeave={collapsible ? collapseSidebar : undefined}
      >
         <nav className="flex flex-col w-full gap-4 px-2 group-[[data-collapsed=true]]:justify-center group-[[data-collapsed=true]]:px-2">
            {routes.map((link, index) =>
               isCollapsed ? (
                  <Tooltip key={index} delayDuration={0}>
                     <TooltipTrigger asChild>
                        <Link
                           href={link.href}
                           className={cn(
                              buttonVariants({
                                 variant: 'ghost',
                                 size: 'sm',
                              }),
                              'justify-start flex justify-center',
                              (pathname === link.href ||
                                 pathname.includes(link.href) ||
                                 link.aliases?.includes(pathname)) &&
                                 'bg-muted dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-white',
                           )}
                        >
                           <motion.div
                              variants={fadeInAnimation}
                              initial={animate}
                              animate="visible"
                           >
                              {link.icon && link.icon}
                           </motion.div>
                           <span className="sr-only">{link.label}</span>
                        </Link>
                     </TooltipTrigger>
                     <TooltipContent
                        side="right"
                        className="flex items-center gap-4"
                     >
                        {link.label}
                     </TooltipContent>
                  </Tooltip>
               ) : (
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
                     <motion.div
                        variants={fadeInAnimation}
                        initial={animate}
                        animate="visible"
                     >
                        {link.icon && link.icon}
                     </motion.div>
                     <div className="flex items-center justify-between w-full">
                        <motion.p
                           variants={fadeInAnimation}
                           initial={animate}
                           animate="visible"
                        >
                           {link.label}
                        </motion.p>
                        <p className="text-muted-foreground font-semibold">
                           {link.secondaryLabel}
                        </p>
                     </div>
                  </Link>
               ),
            )}
         </nav>
      </div>
   );
}
