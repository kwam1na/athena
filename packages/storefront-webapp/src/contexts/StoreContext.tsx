import { currencyFormatter } from "@/lib/utils";
import { Store, StoreFrontUser } from "@athena/webapp";
import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { MaintenanceMode } from "@/components/states/maintenance/Maintenance";
import { useGetStore } from "@/hooks/useGetStore";
import { ORGANIZATION_ID_KEY, STORE_ID_KEY } from "@/lib/constants";
import { Id } from "../../../athena-webapp/convex/_generated/dataModel";

type StoreContextType = {
  organizationId: string;
  storeId: string;
  userId?: Id<"storeFrontUser"> | Id<"guest">;
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

  const { data: store, isLoading } = useGetStore();

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

  useEffect(() => {
    if (store) {
      localStorage.setItem(ORGANIZATION_ID_KEY, store.organizationId);
      localStorage.setItem(STORE_ID_KEY, store._id);
    }
  }, [store]);

  if (!isLoading && !store) {
    return <MaintenanceMode />;
  }

  return (
    <StoreContext.Provider
      value={{
        organizationId: store?.organizationId as string,
        storeId: store?._id as string,
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
