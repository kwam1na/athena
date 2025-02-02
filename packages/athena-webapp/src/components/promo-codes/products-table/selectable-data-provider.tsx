import { createContext, useContext, useState } from "react";

interface SelectedProductsContextType {
  selectedProductSkus: Set<string>;
  setSelectedProductSkus: React.Dispatch<React.SetStateAction<Set<string>>>;
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
    new Set<string>(new Set())
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
