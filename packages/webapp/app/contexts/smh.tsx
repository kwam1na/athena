import React, {
  createContext,
  Dispatch,
  SetStateAction,
  useContext,
  useState,
} from "react";
import { ZodError } from "zod";
import { ImageFile } from "@/components/ui/image-uploader";
import { Product, productRequestSchema } from "@athena/db";
import { ProductVariant } from "@/components/add-product/ProductStock";

type ProductContextType = {
  // activeProductVariant: ProductVariant | null;
  // setActiveProductVariant: (variant: ProductVariant) => void;
  // productVariants: ProductVariant[];
  // updateProductVariants: (newVariants: ProductVariant[]) => void;
  error: ZodError | null;
  isLoading: boolean;
  didProvideRequiredData: () => boolean;
  updateError: (error: ZodError | null) => void;
  images: ImageFile[];
  updateImages: Dispatch<SetStateAction<ImageFile[]>>;
  productData: Partial<Product>;
  updateProductData: (newData: Partial<Product>) => void;
};

const ProductContext = createContext<ProductContextType | undefined>(undefined);

export const ProductProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [productData, setProductData] = useState<Partial<Product>>({
    availability: "draft" as const,
  });

  const [activeProductVariant, setActiveProductVariant] =
    useState<ProductVariant | null>(null);

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

  const [error, setError] = useState<ZodError | null>(null);

  const [images, updateImages] = useState<ImageFile[]>([]);

  const updateProductData = (newData: Partial<Product>) => {
    setProductData((prevData) => ({ ...prevData, ...newData }));
  };

  const updateError = (error: ZodError | null) => {
    setError(error);
  };

  const didProvideRequiredData = () => {
    try {
      productRequestSchema.parse({
        ...productData,
        currency: "usd",
        storeId: 1,
        organizationId: 1,
        images: images.map((file) => file.file?.path || file.preview),
      });
      return true;
    } catch (e) {
      // console.log((e as ZodError).message);
      return false;
    }
  };

  // const { product } = useGetStoreData();

  // const { productId } = useParams({ strict: false });

  // const { activeStore } = useGetActiveStore();

  // const { data: product, isLoading } = useQuery({
  //   queryKey: ["product", productId],
  //   queryFn: () =>
  //     getProduct({
  //       organizationId: activeStore!.organizationId,
  //       storeId: activeStore!.id,
  //       productId: productId!,
  //     }),
  //   enabled: Boolean(productId && activeStore),
  // });

  // useEffect(() => {
  //   if (product) {
  //     updateProductData(product);

  //     const t = product.images.map((url) => ({ preview: url }));
  //     updateImages(t);
  //   }
  // }, [product]);

  const isLoading = false;

  return (
    <ProductContext.Provider
      value={{
        // activeProductVariant,
        // setActiveProductVariant,
        // productVariants,
        // updateProductVariants,
        images,
        updateImages,
        isLoading,
        didProvideRequiredData,
        productData,
        updateProductData,
        error,
        updateError,
      }}
    >
      {children}
    </ProductContext.Provider>
  );
};

export const useProductContext = () => {
  const context = useContext(ProductContext);
  if (context === undefined) {
    throw new Error("useProductContext must be used within a ProductProvider");
  }
  return context;
};
