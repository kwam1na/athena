import React, { createContext, useContext, useState } from "react";

type SidebarState = "expanded" | "collapsed";

type AppLayoutContextType = {
  isSidebarCollapsed: boolean;
  isSidebarExpanded: boolean;
  sidebarState: SidebarState;
  setSidebarState: (state: SidebarState) => void;
};

const AppLayoutContext = createContext<AppLayoutContextType | undefined>(
  undefined
);

export const AppLayoutProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [sidebarState, setSidebarState] = useState<SidebarState>("expanded");

  return (
    <AppLayoutContext.Provider
      value={{
        isSidebarCollapsed: sidebarState == "collapsed",
        isSidebarExpanded: sidebarState == "expanded",
        sidebarState,
        setSidebarState,
      }}
    >
      {children}
    </AppLayoutContext.Provider>
  );
};

export const useAppLayout = () => {
  const context = useContext(AppLayoutContext);
  if (context === undefined) {
    throw new Error("useAppLayout must be used within a AppLayoutProvider");
  }
  return context;
};
