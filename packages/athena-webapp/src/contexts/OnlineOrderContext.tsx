import { useParams } from "@tanstack/react-router";
import { createContext, useContext } from "react";
import { OnlineOrder, OnlineOrderItem } from "~/types";
import useGetActiveOnlineOrder from "../components/orders/hooks/useGetActiveOnlineOrder";

interface OnlineOrderContextType {
  // state
  order?: OnlineOrder | null;
  // isLoading: boolean;

  // actions
  // updateOrder: (newOrder: Partial<OnlineOrder>) => void;
  // updateOrderItem: (
  // itemId: string,
  // attributes: Partial<OnlineOrderItem>
  // ) => void;
  // removeOrderItem: (itemId: string) => void;
}

const OnlineOrderContext = createContext<OnlineOrderContextType | undefined>(
  undefined
);

export function OnlineOrderProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const order: OnlineOrder | null | undefined = useGetActiveOnlineOrder();

  return (
    <OnlineOrderContext.Provider value={{ order }}>
      {children}
    </OnlineOrderContext.Provider>
  );
}

export function useOnlineOrder() {
  const context = useContext(OnlineOrderContext);
  if (!context) {
    throw new Error("useOnlineOrder must be used within a OnlineOrderProvider");
  }

  return context;
}
