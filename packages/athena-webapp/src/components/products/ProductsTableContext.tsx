import { createContext, useContext, useState, ReactNode } from "react";

interface ProductsTableContextType {
  productsTableState: TableState;
  updateProductsTableState: (newState: Partial<TableState>) => void;
}

type TableState = {
  subcategorySlug: string | null;
};

const ProductsTableContext = createContext<
  ProductsTableContextType | undefined
>(undefined);

export function ProductsTableProvider({ children }: { children: ReactNode }) {
  const initialTableState: TableState = {
    subcategorySlug: null,
  };

  const [tableState, setTableState] = useState<TableState>(initialTableState);

  const updateProductsTableState = (newState: Partial<TableState>) => {
    setTableState((prevState) => ({ ...prevState, ...newState }));
  };

  // const revertChanges = () => {
  //   if (!activeProduct) return;

  //   updateAppState({ didRevertChanges: true });

  //   setProductData({
  //     ...activeProduct,
  //     skus: undefined, // Exclude skus from productData
  //   });

  //   const variants = activeProduct.skus.map((sku: ProductSku) =>
  //     convertSkuToVariant(sku)
  //   );
  //   updateProductVariants(variants);
  //   setActiveProductVariant(variants[0] || null);

  //   toast.success("Changes reverted");
  // };

  // console.log(productVariants);

  const value = {
    productsTableState: tableState,
    updateProductsTableState,
  };

  return (
    <ProductsTableContext.Provider value={value}>
      {children}
    </ProductsTableContext.Provider>
  );
}

export function useProductsTableState() {
  const context = useContext(ProductsTableContext);
  if (context === undefined) {
    throw new Error(
      "useProductsTableState must be used within a ProductsTableProvider"
    );
  }
  return context;
}
