import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { api } from "@athena-webapp/convex/_generated/api";
import type { Id } from "@athena-webapp/convex/_generated/dataModel";
import type { Store } from "@athena-webapp/types";

// type Store = {
//   _id: Id<"store">;
//   name: string;
//   organizationId: Id<"organization">;
// };

type StoreContextType = {
  store: Store;
  isLoading: boolean;
};

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({
  children,
  storeName,
}: {
  children: React.ReactNode;
  storeName: string;
}) {
  const { data: store, isLoading } = useSuspenseQuery(
    convexQuery(api.inventory.stores.findByName, {
      name: storeName,
    })
  );

  if (!store) {
    throw new Error("Store not found");
  }

  return (
    <StoreContext.Provider value={{ store, isLoading }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useStore must be used within a StoreProvider");
  }
  return context;
}
