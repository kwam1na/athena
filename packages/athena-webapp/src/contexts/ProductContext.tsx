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
import { ZodError } from "zod";
import useGetActiveProduct from "@/hooks/useGetActiveProduct";
import { Product, ProductSku } from "~/types";
import { productSchema } from "../lib/schemas/product";
import { toast } from "sonner";

interface ProductContextType {
  activeProductVariant: ProductVariant;
  error: ZodError | null;
  images: ImageFile[];
  productData: Partial<Product>;
  productVariants: ProductVariant[];
  setActiveProductVariant: React.Dispatch<React.SetStateAction<ProductVariant>>;
  setError: React.Dispatch<React.SetStateAction<ZodError | null>>;
  updateImages: React.Dispatch<React.SetStateAction<ImageFile[]>>;
  updateProductVariants: React.Dispatch<React.SetStateAction<ProductVariant[]>>;
  didProvideRequiredData: () => boolean;
  removeProductVariant: (id: string) => void;
  revertChanges: () => void;
  updateProductData: (newData: Partial<Product>) => void;
  updateProductVariant: (
    variantId: string,
    attributes: Partial<ProductVariant>
  ) => void;
  isLoading: boolean;
  updateVariantImages: (variantId: string, newImages: ImageFile[]) => void;
  updateAppState: (newState: Partial<AppState>) => void;

  // actions
  appState: AppState;
}

interface AppState {
  isInitialLoad: boolean;
  didRevertChanges: boolean;
}

const ProductContext = createContext<ProductContextType | undefined>(undefined);

export function ProductProvider({ children }: { children: ReactNode }) {
  const [productData, setProductData] = useState<Partial<Product>>({
    availability: "draft" as const,
  });

  const [productVariants, updateProductVariants] = useState<ProductVariant[]>([
    {
      id: Date.now().toString(),
      sku: "",
      stock: 0,
      quantityAvailable: 0,
      cost: 0,
      price: 0,
      images: [],
    },
  ]);

  const initialAppState: AppState = {
    isInitialLoad: false,
    didRevertChanges: false,
  };

  const [appState, setAppState] = useState<AppState>(initialAppState);

  const [activeProductVariant, setActiveProductVariant] =
    useState<ProductVariant>(productVariants[0]);

  const [images, updateImages] = useState<ImageFile[]>([]);
  const [error, setError] = useState<ZodError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { activeProduct } = useGetActiveProduct();

  const updateAppState = (newState: Partial<AppState>) => {
    setAppState((prevState) => ({ ...prevState, ...newState }));
  };

  const removeProductVariant = useCallback(
    (id: string) => {
      updateProductVariants((prevVariants) => {
        if (activeProduct) {
          // If there's an active product, mark the variant for deletion
          // Check if the variant exists in the active product
          const variantExistsInActiveProduct = activeProduct.skus.some(
            (v: any) => v._id === id
          );

          if (variantExistsInActiveProduct) {
            // If the variant exists in the active product, mark it for deletion
            return prevVariants.map((variant) =>
              variant.id === id
                ? { ...variant, markedForDeletion: true }
                : variant
            );
          } else {
            // If it's a newly added variant during edit, remove it

            const updated = prevVariants.filter((v) => v.id !== id);

            const index = prevVariants.findIndex(
              (v) => v.id == activeProductVariant.id
            );

            if (index == prevVariants.length - 1) {
              const lastVariant = updated.at(-1);
              lastVariant && setActiveProductVariant(lastVariant);
            }

            return updated;
          }
        } else {
          // If there's no active product, remove the variant
          const newVariants = prevVariants.filter((v) => v.id !== id);
          if (activeProductVariant && activeProductVariant.id === id) {
            setActiveProductVariant(newVariants[0] || null);
          }
          return newVariants;
        }
      });
    },
    [activeProduct, activeProductVariant]
  );

  const updateVariantImages = useCallback(
    (variantId: string, newImages: ImageFile[]) => {
      updateProductVariants((prevVariants) =>
        prevVariants.map((variant) =>
          variant.id === variantId ? { ...variant, images: newImages } : variant
        )
      );
    },
    []
  );

  const updateProductVariant = (
    variantId: string,
    attributes: Partial<ProductVariant>
  ) => {
    updateProductVariants((prevVariants) =>
      prevVariants.map((variant) =>
        variant.id === variantId ? { ...variant, ...attributes } : variant
      )
    );
  };

  const didProvideRequiredData = () => {
    try {
      productSchema.parse({
        ...productData,
        images: images.map((file) => file.file?.path || file.preview),
      });
      return true;
    } catch (e) {
      return false;
    }
  };

  const convertSkuToVariant = (sku: ProductSku): ProductVariant => ({
    existsInDB: true,
    id: sku._id,
    sku: sku.sku,
    stock: sku.inventoryCount,
    quantityAvailable: sku.quantityAvailable,
    cost: sku.unitCost,
    price: sku.price,
    netPrice: sku.netPrice,
    size: sku.size || undefined,
    color: sku.color || undefined,
    length: sku.length || undefined,
    weight: sku.weight || undefined,
    images: sku.images.map((imageUrl) => ({
      preview: imageUrl,
      file: undefined,
    })),
  });

  const updateProductData = (newData: Partial<Product>) => {
    setProductData((prevData) => ({ ...prevData, ...newData }));
  };

  const revertChanges = () => {
    if (!activeProduct) return;

    updateAppState({ didRevertChanges: true });

    setProductData({
      ...activeProduct,
      skus: undefined, // Exclude skus from productData
    });

    const variants = activeProduct.skus.map((sku: ProductSku) =>
      convertSkuToVariant(sku)
    );
    updateProductVariants(variants);
    setActiveProductVariant(variants[0] || null);

    toast.success("Changes reverted");
  };

  useEffect(() => {
    if (activeProduct) {
      setProductData({
        ...activeProduct,
        skus: undefined, // Exclude skus from productData
      });

      const variants = activeProduct.skus.map((sku: any) =>
        convertSkuToVariant(sku)
      );
      updateProductVariants(variants);
      setActiveProductVariant(variants[0] || null);

      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  }, [activeProduct]);

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

  // console.log(productVariants);

  const value = {
    appState,
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
    revertChanges,
    updateVariantImages,
    updateProductVariant,
    updateAppState,
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
