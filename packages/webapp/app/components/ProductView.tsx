import { Link, useNavigate } from "@tanstack/react-router";
import View from "./View";
import { Button } from "./ui/button";
import {
  ArrowLeftIcon,
  CheckCircledIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { productSchema } from "@/lib/schemas/product";
import { ZodError } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import {
  createProduct,
  createProductSku,
  deleteProduct,
  updateProduct,
  updateProductSku,
} from "@/api/product";
import { LoadingButton } from "./ui/loading-button";
import { useState } from "react";
import { deleteFiles, uploadProductImages } from "@/lib/imageUtils";
import { AlertModal } from "./ui/modals/alert-modal";
import { ActionModal } from "./ui/modals/action-modal";
import { useGetStoreData } from "./add-product/hooks/useGetStoreData";
import ProductPage from "./ProductPage";
import { ProductProvider, useProduct } from "@/contexts/ProductContext";

function ProductViewContent() {
  const { images, productData, didProvideRequiredData } = useProduct();

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [failedToUploadUrls, setFailedToUploadUrls] = useState<string[]>([]);
  const [isDeletingImages, setIsDeletingImages] = useState(false);

  const [_productId, setProductId] = useState<number | null>(null);

  const navigate = useNavigate();

  const { product, store } = useGetStoreData();

  const createMutation = useMutation({
    mutationFn: () => saveProduct(),
    onSuccess: () => {
      toast(`Product '${productData.name}' created`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });

      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/products",
        params: (prev) => ({
          ...prev,
          storeUrlSlug: prev.storeUrlSlug!,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    },
    onError: (e) => {
      if (e instanceof ZodError) return;
      toast("Something went wrong", {
        description: e.message,
        icon: <Ban className="w-4 h-4" />,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => modifyProduct(),
    onSuccess: (data) => {
      toast(`Product '${productData.name}' updated`, {
        // description: <p className="text-destructive">{data?.warning}</p>,
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });

      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/products",
        params: (prev) => ({
          ...prev,
          storeUrlSlug: prev.storeUrlSlug!,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    },

    onError: (e) => {
      if (e instanceof ZodError) return;

      toast("Something went wrong", {
        description: e.message,
        icon: <Ban className="w-4 h-4" />,
      });
    },
  });

  const deleteItem = async () => {
    if (!product?.id || !store)
      throw new Error("Missing data required to delete product");
    await deleteProduct({
      organizationId: store.organizationId,
      storeId: store.id,
      productId: product.id,
    });
  };

  const deleteMutation = useMutation({
    mutationFn: deleteItem,
    onSuccess: () => {
      toast(`Product '${productData.name}' deleted`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });

      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/products",
        params: (prev) => ({
          ...prev,
          storeUrlSlug: prev.storeUrlSlug!,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    },
    onError: (e) => {
      toast("Something went wrong", {
        description: e.message,
        icon: <Ban className="w-4 h-4" />,
      });
    },
  });

  // const saveProduct = async () => {
  //   if (!store) {
  //     throw new Error("Missing data required to save product");
  //   }

  //   try {
  //     const data = productSchema.parse({
  //       ...productData,
  //       currency: "usd",
  //       storeId: store.id,
  //       organizationId: store.organizationId,
  //       images: [],
  //     });

  //     const product = await createProduct({
  //       data: { ...data, createdByUserId: 1, skus: [] },
  //       organizationId: store.organizationId,
  //       storeId: store.id,
  //     });

  //     setProductId(product.id);

  //     const { imageUrls } = await uploadProductImages(
  //       images,
  //       store.id,
  //       product.id
  //     );

  //     return await updateProduct({
  //       data: { images: imageUrls },
  //       organizationId: store.organizationId,
  //       storeId: store.id,
  //       productId: product.id,
  //     });
  //   } catch (error) {
  //     // TODO: problematic
  //     // updateError(error as ZodError);
  //     throw error;
  //   }
  // };

  const saveProduct = async () => {
    const { productData, productVariants, images, setError } = useProduct();

    if (!store) {
      throw new Error("Missing store data required to save product");
    }

    try {
      const mainProductData = {
        ...productData,
        currency: store.currency,
        storeId: store.id,
        organizationId: store.organizationId,
      };

      // Validate the main product data
      const validatedProductData = productSchema.parse(mainProductData);

      // Create the main product
      // const product = await createProduct({
      //   data: validatedProductData,
      //   organizationId: store.organizationId,
      //   storeId: store.id,
      // });

      // Upload and update main product images
      // if (images.length > 0) {
      //   const { imageUrls } = await uploadProductImages(
      //     images,
      //     store.id,
      //     product.id
      //   );

      //   await updateProduct({
      //     data: { images: imageUrls },
      //     organizationId: store.organizationId,
      //     storeId: store.id,
      //     productId: product.id,
      //   });
      // }

      // Create SKUs for the product
      // for (const variant of productVariants) {
      //   const sku = await createProductSku({
      //     data: {
      //       productId: product.id,
      //       sku: variant.sku,
      //       price: variant.price || 0,
      //       inventoryCount: variant.stock || 0,
      //       unitCost: variant.cost || 0,
      //       images: [],
      //       attributes: {}, // Add any additional attributes here
      //     },
      //     organizationId: store.organizationId,
      //     storeId: store.id,
      //     productId: product.id,
      //   });

      //   // Upload and update SKU images
      //   if (variant.images && variant.images.length > 0) {
      //     const { imageUrls } = await uploadProductImages(
      //       variant.images,
      //       store.id,
      //       product.id
      //     );

      //     await updateProductSku({
      //       data: { images: imageUrls },
      //       organizationId: store.organizationId,
      //       storeId: store.id,
      //       productId: product.id,
      //       skuId: sku.id,
      //     });
      //   }
      // }

      return product;
    } catch (error) {
      console.error("Error saving product:", error);
      // setError(error);
      throw error;
    }
  };

  const modifyProduct = async () => {
    const pid = product?.id || _productId;

    if (!pid || !store)
      throw new Error("Missing data required to save product");

    // updateError(null);

    const { imageUrls, failedDeleteUrls } = await uploadProductImages(
      images,
      store.id,
      pid
    );

    if (failedDeleteUrls.length > 0) {
      setFailedToUploadUrls(failedDeleteUrls);
      setIsActionModalOpen(true);
      throw new Error("ahhhh");
    }

    try {
      const data = productSchema.parse({
        ...productData,
        currency: "usd",
        storeId: store.id,
        organizationId: store.organizationId,
        images: imageUrls,
      });

      return await updateProduct({
        data,
        organizationId: store.organizationId,
        storeId: store.id,
        productId: pid,
      });
    } catch (error) {
      // updateError(error as ZodError);
      throw error;
    }
  };

  const onSubmit = () => {
    if (product?.id || _productId) updateMutation.mutate();
    else createMutation.mutate();
  };

  const retryDeletingImages = async () => {
    setIsDeletingImages(true);
    const res = await deleteFiles(failedToUploadUrls);
    setIsDeletingImages(false);

    if (res.failedDeleteKeys.length > 0) {
      setFailedToUploadUrls(res.failedDeleteUrls);
      setIsActionModalOpen(true);
      return;
    }
  };

  const isValid = didProvideRequiredData();

  const Navigation = () => {
    const header = product ? "Edit Product" : "Add Product";

    return (
      <div className="flex gap-2 h-[40px] justify-between">
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/products"
          params={(prev) => ({
            ...prev,
            storeUrlSlug: prev.storeUrlSlug!,
            orgUrlSlug: prev.orgUrlSlug!,
          })}
          className="flex items-center gap-2"
        >
          <Button variant="ghost" className="h-8 px-2 lg:px-3 ">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          <p className="text-sm">{header}</p>
        </Link>

        <div className="flex space-x-2">
          {product && (
            <LoadingButton
              isLoading={deleteMutation.isPending}
              variant={"outline"}
              className="text-destructive"
              onClick={() => setIsDeleteModalOpen(true)}
            >
              <TrashIcon className="w-4 h-4" />
            </LoadingButton>
          )}
          <LoadingButton
            disabled={!isValid}
            isLoading={createMutation.isPending || updateMutation.isPending}
            onClick={onSubmit}
          >
            Save
          </LoadingButton>
        </div>
      </div>
    );
  };

  return (
    <View className="bg-background" header={<Navigation />}>
      <AlertModal
        title="Delete product?"
        isOpen={isDeleteModalOpen}
        loading={deleteMutation.isPending}
        onClose={() => {
          setIsDeleteModalOpen(false);
        }}
        onConfirm={() => {
          deleteMutation.mutate();
        }}
      />
      <ActionModal
        isOpen={isActionModalOpen}
        loading={isDeletingImages}
        title="Error deleting product images"
        description=""
        declineText="Cancel"
        confirmText="Try again"
        onConfirm={retryDeletingImages}
        onClose={() => setIsActionModalOpen(false)}
      >
        <div className="grid grid-cols-4 space-y-2">
          {failedToUploadUrls.map((key, index) => (
            <img
              key={index}
              alt="Uploaded image"
              className={`aspect-square w-full w-[64px] h-[64px] rounded-md object-cover`}
              src={key}
            />
          ))}
        </div>
      </ActionModal>
      <ProductPage />
    </View>
  );
}

export default function ProductView() {
  return (
    <ProductProvider>
      <ProductViewContent />
    </ProductProvider>
  );
}
