import { currencyFormatter } from "@/lib/utils";
import { Store, StoreFrontUser } from "@athena/webapp";
import React, { createContext, useContext, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { MaintenanceMode } from "@/components/states/maintenance/Maintenance";
import { useGetStore } from "@/hooks/useGetStore";
import { ORGANIZATION_ID_KEY, STORE_ID_KEY } from "@/lib/constants";
import { Id } from "../../../athena-webapp/convex/_generated/dataModel";
import { useNavigationBarContext } from "./NavigationBarProvider";

type StoreContextType = {
  organizationId: string;
  storeId: string;
  userId?: Id<"storeFrontUser"> | Id<"guest">;
  user?: StoreFrontUser;
  formatter: Intl.NumberFormat;
  store?: Store;
  isNavbarShowing: boolean;
  navBarClassname: string;
  hideNavbar: () => void;
  showNavbar: () => void;
};
const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { data: store, isLoading } = useGetStore();
  const { user, userId, guestId } = useAuth();
  const { activeOverlay, routeState } = useNavigationBarContext();
  const isNavbarShowing =
    routeState.navigationVisible &&
    activeOverlay !== "mobile-menu" &&
    activeOverlay !== "mobile-bag" &&
    activeOverlay !== "mobile-filter";
  const formatter = currencyFormatter(store?.currency || "usd");

  useEffect(() => {
    if (store) {
      localStorage.setItem(ORGANIZATION_ID_KEY, store.organizationId);
      localStorage.setItem(STORE_ID_KEY, store._id);
    }
  }, [store]);
  if (!isLoading && !store) return <MaintenanceMode />;

  return (
    <StoreContext.Provider
      value={{
        organizationId: store?.organizationId as string,
        storeId: store?._id as string,
        formatter,
        store,
        isNavbarShowing,
        navBarClassname: isNavbarShowing
          ? "flex w-full items-center justify-center px-gutter py-layout-sm"
          : "hidden",
        hideNavbar: () => undefined,
        showNavbar: () => undefined,
        userId: userId ?? guestId,
        user,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};
export const useStoreContext = () => {
  const context = useOptionalStoreContext();
  if (!context) throw new Error("useStoreContext must be used within a StoreProvider");
  return context;
};
export const useOptionalStoreContext = () => useContext(StoreContext);
