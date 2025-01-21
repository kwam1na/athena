import { getStore } from "@/api/stores";
import { OG_ORGANIZATION_ID, OG_STORE_ID } from "@/lib/constants";
import { currencyFormatter } from "@/lib/utils";
import { Store, StoreFrontUser } from "@athena/webapp";
import { useQuery } from "@tanstack/react-query";
import React, { createContext, useContext, useState } from "react";
import { getActiveUser } from "@/api/storeFrontUser";
import { useAuth } from "@/hooks/useAuth";

type StoreContextType = {
  organizationId: string;
  storeId: string;
  userId: string | null;
  user?: StoreFrontUser;
  formatter: Intl.NumberFormat;
  store?: Store;
  navBarClassname: string;
  isNavbarShowing: boolean;
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
      getStore({ organizationId: OG_ORGANIZATION_ID, storeId: OG_STORE_ID }),
  });

  // const userId =
  //   typeof window == "object" ? window.serverData?.userId : undefined;

  // const { data: user } = useQuery({
  //   queryKey: ["user"],
  //   queryFn: () =>
  //     getActiveUser({
  //       organizationId: OG_ORGANIZATION_ID,
  //       storeId: OG_STORE_ID,
  //       userId: userId!,
  //     }),
  //   enabled: !!userId,
  // });

  const { user, userId, guestId } = useAuth();

  const hiddenNavClassname =
    "hidden w-full flex flex-col items-center justify-center py-2";
  const navClassname =
    "w-full flex flex-col items-center justify-center py-3 px-6 xl:px-0";

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
        organizationId: OG_ORGANIZATION_ID,
        storeId: OG_STORE_ID,
        formatter,
        store,
        isNavbarShowing: activeNavClassname == navClassname,
        navBarClassname: activeNavClassname,
        showNavbar,
        hideNavbar,
        userId: userId ?? guestId,
        user,
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
