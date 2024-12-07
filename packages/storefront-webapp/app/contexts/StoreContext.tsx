import { getStore } from "@/api/stores";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { currencyFormatter } from "@/lib/utils";
import { Store } from "../../../athena-webapp";
import { useQuery } from "@tanstack/react-query";
import React, { createContext, useContext, useState } from "react";

type StoreContextType = {
  organizationId: string;
  storeId: string;
  formatter: Intl.NumberFormat;
  store?: Store;
  navBarClassname: string;
  showNavbar: () => void;
  hideNavbar: () => void;
};

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const storeCurrency = "usd";

  const { data: store } = useQuery({
    queryKey: ["store"],
    queryFn: () =>
      getStore({ organizationId: OG_ORGANIZTION_ID, storeId: OG_STORE_ID }),
  });

  const hiddenNavClassname =
    "hidden w-full flex flex-col items-center justify-center p-6 lg:px-16 lg:py-6";
  const navClassname =
    "w-full flex flex-col items-center justify-center p-6 lg:px-16 lg:py-6";

  const [activeNavClassname, setActiveClassname] = useState(navClassname);

  const hideNavbar = () => {
    setActiveClassname(hiddenNavClassname);
  };

  const showNavbar = () => {
    setActiveClassname(navClassname);
  };

  const formatter = currencyFormatter(store?.currency || storeCurrency);

  return (
    <StoreContext.Provider
      value={{
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
        formatter,
        store,
        navBarClassname: activeNavClassname,
        showNavbar,
        hideNavbar,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStoreContext = () => {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error("useStoreContext must be used within a StoreProvider");
  }
  return context;
};
