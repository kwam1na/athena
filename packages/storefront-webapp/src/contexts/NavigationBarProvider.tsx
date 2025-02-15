import React, { createContext, useContext, useState } from "react";

type NavigationBarConteztType = {
  navBarLayout: "sticky" | "fixed";
  setNavBarLayout: (layout: "sticky" | "fixed") => void;
};

const NavigationBarContext = createContext<
  NavigationBarConteztType | undefined
>(undefined);

export const NavigationBarProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [navBarLayout, setNavBarLayout] = useState<"sticky" | "fixed">(
    "sticky"
  );

  return (
    <NavigationBarContext.Provider
      value={{
        setNavBarLayout,
        navBarLayout,
      }}
    >
      {children}
    </NavigationBarContext.Provider>
  );
};

export const useNavigationBarContext = () => {
  const context = useContext(NavigationBarContext);
  if (context === undefined) {
    throw new Error(
      "useNavigationBarContext must be used within a NavigationBarProvider"
    );
  }
  return context;
};
