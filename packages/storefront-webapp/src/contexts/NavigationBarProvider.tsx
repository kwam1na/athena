import React, { createContext, useContext, useState } from "react";

type NavigationBarConteztType = {
  navBarLayout: "sticky" | "fixed";
  setNavBarLayout: (layout: "sticky" | "fixed") => void;
  appLocation: AppLocation;
  setAppLocation: (location: AppLocation) => void;
};

const NavigationBarContext = createContext<
  NavigationBarConteztType | undefined
>(undefined);

type AppLocation = "homepage" | "shop" | null;

export const NavigationBarProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [navBarLayout, setNavBarLayout] = useState<"sticky" | "fixed">(
    "sticky"
  );

  const [location, setLocation] = useState<AppLocation>(null);

  return (
    <NavigationBarContext.Provider
      value={{
        appLocation: location,
        setAppLocation: setLocation,
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
