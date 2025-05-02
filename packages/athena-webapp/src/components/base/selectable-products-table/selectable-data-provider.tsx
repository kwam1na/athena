import { createContext, useContext, useState } from "react";
import { Id } from "~/convex/_generated/dataModel";
import { ProductSku } from "~/types";

interface SelectedProductsContextType {
  selectedProductSkus: Set<ProductSku>;
  setSelectedProductSkus: React.Dispatch<React.SetStateAction<Set<ProductSku>>>;
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
    new Set<ProductSku>(new Set())
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
