'use client';

import React, { useState } from 'react';
import { SideNav } from './side-nav';
import {
   ResizableHandle,
   ResizablePanel,
   ResizablePanelGroup,
} from './ui/resizable';
import { TooltipProvider } from './ui/tooltip';
import {
   DEFAULT_MAIN_BODY_WIDTH,
   DEFAULT_SIDE_BAR_WIDTH,
   MAIN_BODY_WIDTH_COLLAPSED,
   SIDE_BAR_WIDTH_COLLAPSED,
} from '@/lib/constants';
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
   collapsible,
   defaultCollapsed,
   hideWhenOnRoutes = [],
   routes,
   sideNavClassName,
   withAnimation,
}: SibebarProps) => {
   const [sidebarWidth, setSidebarWidth] = useState(
      defaultCollapsed ? SIDE_BAR_WIDTH_COLLAPSED : DEFAULT_SIDE_BAR_WIDTH,
   );
   const [mainBodyWidth, setMainBodyWidth] = useState(
      defaultCollapsed ? MAIN_BODY_WIDTH_COLLAPSED : DEFAULT_MAIN_BODY_WIDTH,
   );
   const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

   const pathname = usePathname();
   const shouldHideSideNav = hideWhenOnRoutes.some((route) =>
      pathname.includes(route),
   );

   return (
      <TooltipProvider delayDuration={0}>
         <ResizablePanelGroup direction="horizontal" className="h-screen">
            {!shouldHideSideNav && (
               <ResizablePanel
                  defaultSize={sidebarWidth}
                  maxSize={sidebarWidth}
                  minSize={sidebarWidth}
                  className="transition-width ease-in-out duration-500"
               >
                  <SideNav
                     className={sideNavClassName}
                     collapsible={collapsible}
                     withAnimation={withAnimation}
                     routes={routes}
                     isCollapsed={isCollapsed}
                     setIsCollapsed={setIsCollapsed}
                     setMainBodyWidth={setMainBodyWidth}
                     setSidebarWidth={setSidebarWidth}
                  />
               </ResizablePanel>
            )}
            <ResizableHandle />
            <ResizablePanel
               defaultSize={mainBodyWidth}
               className="transition-width ease-in-out duration-500"
            >
               {children}
            </ResizablePanel>
         </ResizablePanelGroup>
      </TooltipProvider>
   );
};
