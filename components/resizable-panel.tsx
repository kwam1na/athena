const ResizablePanelGroup = ({ children }: { children: React.ReactNode }) => {
   return <div className="flex w-full bg-green-400">{children}</div>;
};

const ResizablePanel = ({
   defaultSize,
   children,
}: {
   defaultSize: number;
   children: React.ReactNode;
}) => {
   return (
      <div
         className={`w-[${defaultSize}%] transition-width ease-in-out duration-500 bg-red-400`}
      >
         {children}
      </div>
   );
};

export { ResizablePanelGroup, ResizablePanel };

// const PanelGroup = ({ children }: { children: React.ReactNode }) => {
//    return <div className="flex h-screen">{children}</div>;
// };

// const Panel = ({
//    width,
//    children,
//    className,
// }: {
//    width: number;
//    children: React.ReactNode;
//    className?: string;
// }) => {
//    return (
//       <motion.div
//          className={cn(`flex`, className)}
//          animate={{ width: `${width}%` }}
//          transition={{ duration: 0.2 }}
//       >
//          {children}
//       </motion.div>
//    );
// };

// export const Sidebar = ({ children }: { children: React.ReactNode }) => {
//    const [sidebarWidth, setSidebarWidth] = useState(SIDE_BAR_WIDTH_COLLAPSED);
//    const [mainBodyWidth, setMainBodyWidth] = useState(
//       MAIN_BODY_WIDTH_COLLAPSED,
//    );
//    const [isCollapsed, setIsCollapsed] = useState(true);

//    return (
//       <TooltipProvider delayDuration={0}>
//          <PanelGroup>
//             <Panel width={sidebarWidth} className="border-r">
//                <SideNav
//                   isCollapsed={isCollapsed}
//                   setIsCollapsed={setIsCollapsed}
//                   setMainBodyWidth={setMainBodyWidth}
//                   setSidebarWidth={setSidebarWidth}
//                />
//             </Panel>

//             <Panel width={mainBodyWidth}>{children}</Panel>
//          </PanelGroup>
//       </TooltipProvider>
//    );
// };
