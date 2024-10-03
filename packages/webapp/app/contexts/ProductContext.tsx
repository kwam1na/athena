import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
  useEffect,
} from "react";
import { ProductVariant } from "@/components/add-product/ProductStock";
import { ImageFile } from "@/components/ui/image-uploader";
import { productSchema } from "@/lib/schemas/product";
import { Product } from "@athena/db";
import { ZodError } from "zod";

interface ProductContextType {
  productData: Partial<Product>;
  updateProductData: (newData: Partial<Product>) => void;
  activeProductVariant: ProductVariant;
  setActiveProductVariant: React.Dispatch<React.SetStateAction<ProductVariant>>;
  productVariants: ProductVariant[];
  updateProductVariants: React.Dispatch<React.SetStateAction<ProductVariant[]>>;
  images: ImageFile[];
  updateImages: React.Dispatch<React.SetStateAction<ImageFile[]>>;
  error: ZodError | null;
  setError: React.Dispatch<React.SetStateAction<ZodError | null>>;
  didProvideRequiredData: () => boolean;
  removeProductVariant: (id: number) => void;
  updateVariantImages: (variantId: number, newImages: ImageFile[]) => void;
  isLoading: boolean;
}

const ProductContext = createContext<ProductContextType | undefined>(undefined);

export function ProductProvider({ children }: { children: ReactNode }) {
  const [productData, setProductData] = useState<Partial<Product>>({
    availability: "draft" as const,
  });

  const [productVariants, updateProductVariants] = useState<ProductVariant[]>([
    {
      id: Date.now(),
      sku: "",
      stock: 0,
      cost: 0,
      price: 0,
      images: [],
    },
  ]);

  const [activeProductVariant, setActiveProductVariant] =
    useState<ProductVariant>(productVariants[0]);

  const [images, updateImages] = useState<ImageFile[]>([]);
  const [error, setError] = useState<ZodError | null>(null);
  const [isLoading] = useState(false);

  const updateProductData = (newData: Partial<Product>) => {
    setProductData((prevData) => ({ ...prevData, ...newData }));
  };

  useEffect(() => {
    if (activeProductVariant) {
      const updatedVariant = productVariants.find(
        (v) => v.id === activeProductVariant.id
      );
      if (
        updatedVariant &&
        JSON.stringify(updatedVariant) !== JSON.stringify(activeProductVariant)
      ) {
        setActiveProductVariant(updatedVariant);
      }
    }
  }, [productVariants, activeProductVariant]);

  const removeProductVariant = useCallback(
    (id: number) => {
      updateProductVariants((prevVariants) => {
        const newVariants = prevVariants.filter((v) => v.id !== id);
        if (activeProductVariant && activeProductVariant.id === id) {
          setActiveProductVariant(newVariants[0] || null);
        }
        return newVariants;
      });
    },
    [activeProductVariant]
  );

  const updateVariantImages = useCallback(
    (variantId: number, newImages: ImageFile[]) => {
      updateProductVariants((prevVariants) =>
        prevVariants.map((variant) =>
          variant.id === variantId ? { ...variant, images: newImages } : variant
        )
      );
    },
    []
  );

  const didProvideRequiredData = () => {
    try {
      productSchema.parse({
        ...productData,
        currency: "usd",
        storeId: 1,
        organizationId: 1,
        images: images.map((file) => file.file?.path || file.preview),
      });
      return true;
    } catch (e) {
      return false;
    }
  };

  console.log(productVariants);

  const value = {
    productData,
    updateProductData,
    activeProductVariant,
    setActiveProductVariant,
    productVariants,
    updateProductVariants,
    images,
    updateImages,
    error,
    setError,
    didProvideRequiredData,
    removeProductVariant,
    updateVariantImages,
    isLoading,
  };

  return (
    <ProductContext.Provider value={value}>{children}</ProductContext.Provider>
  );
}

export function useProduct() {
  const context = useContext(ProductContext);
  if (context === undefined) {
    throw new Error("useProduct must be used within a ProductProvider");
  }
  return context;
}
