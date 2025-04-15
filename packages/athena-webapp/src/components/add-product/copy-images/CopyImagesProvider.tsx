import { createContext, useContext, useState } from "react";
import { ProductVariant } from "../ProductStock";

type CopyImagesProviderStore = {
  source: ProductVariant | null;
  destination: ProductVariant | null;
  setSourceVariant: (variant: ProductVariant | null) => void;
  setDestinationVariant: (variant: ProductVariant | null) => void;
};

const CopyImagesContext = createContext<CopyImagesProviderStore | null>(null);

export const useCopyImages = () => {
  const context = useContext(CopyImagesContext);
  if (!context) {
    throw new Error("useSheet must be used within a SheetProvider");
  }
  return context;
};

export const CopyImagesProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [source, setSourceVariant] = useState<ProductVariant | null>(null);
  const [destination, setDestinationVariant] = useState<ProductVariant | null>(
    null
  );
  return (
    <CopyImagesContext.Provider
      value={{ source, destination, setSourceVariant, setDestinationVariant }}
    >
      {children}
    </CopyImagesContext.Provider>
  );
};
