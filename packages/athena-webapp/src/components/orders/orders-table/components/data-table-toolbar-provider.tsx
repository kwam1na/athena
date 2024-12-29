import { createContext, useContext, useState } from "react";

interface OrdersTableToolbarContextType {
  selectedStatuses: Set<string>;
  setSelectedStatuses: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedDeliveryMethods: Set<string>;
  setSelectedDeliveryMethods: React.Dispatch<React.SetStateAction<Set<string>>>;
  isFiltersLoaded: boolean;
  setFiltersLoaded: React.Dispatch<React.SetStateAction<boolean>>;
}

const OrdersTableToolbarContext = createContext<
  OrdersTableToolbarContextType | undefined
>(undefined);

export function OrdersTableToolbarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedStatuses, setSelectedStatuses] = useState(
    new Set<string>(new Set())
  );
  const [selectedDeliveryMethods, setSelectedDeliveryMethods] = useState(
    new Set<string>(new Set())
  );

  const [isFiltersLoaded, setFiltersLoaded] = useState(false);

  return (
    <OrdersTableToolbarContext.Provider
      value={{
        selectedStatuses,
        setSelectedStatuses,
        selectedDeliveryMethods,
        setSelectedDeliveryMethods,
        isFiltersLoaded,
        setFiltersLoaded,
      }}
    >
      {children}
    </OrdersTableToolbarContext.Provider>
  );
}

export function useOrdersTableToolbar() {
  const context = useContext(OrdersTableToolbarContext);
  if (!context) {
    throw new Error(
      "useOrdersTableToolbar must be used within a OrdersTableToolbarProvider"
    );
  }

  return context;
}
