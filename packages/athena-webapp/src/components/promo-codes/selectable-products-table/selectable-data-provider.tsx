import { createContext, useContext, useState } from "react";
import { Id } from "~/convex/_generated/dataModel";
import { ProductSku } from "~/types";

interface SelectedProductsContextType {
  selectedProductSkus: Set<Id<"productSku">>;
  setSelectedProductSkus: React.Dispatch<
    React.SetStateAction<Set<Id<"productSku">>>
  >;
}

const SelectedProductsContext = createContext<
  SelectedProductsContextType | undefined
>(undefined);

export function SelectedProductsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedProductSkus, setSelectedProductSkus] = useState(
    new Set<Id<"productSku">>(new Set())
  );

  return (
    <SelectedProductsContext.Provider
      value={{
        selectedProductSkus,
        setSelectedProductSkus,
      }}
    >
      {children}
    </SelectedProductsContext.Provider>
  );
}

export function useSelectedProducts() {
  const context = useContext(SelectedProductsContext);
  if (!context) {
    throw new Error(
      "useSelectedProducts must be used within a SelectedProductsProvider"
    );
  }

  return context;
}
