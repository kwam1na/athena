export const InnerHeader = ({ children }: { children: React.ReactNode }) => {
   return (
      <div className="ml-4 w-full h-12 flex items-center py-8 pr-24 bg-background fixed top-16 z-30">
         {children}
      </div>
   );
};
