import { Link, useNavigate } from "@tanstack/react-router";
import View from "./View";
import { Button } from "./ui/button";
import {
  ArrowLeftIcon,
  CheckCircledIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { ZodError } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import {
  createProduct,
  createProductSku,
  deleteProduct,
  deleteProductSku,
  updateProduct,
  updateProductSku,
} from "@/api/product";
import { LoadingButton } from "./ui/loading-button";
import { useState } from "react";
import { deleteFiles, uploadProductImages } from "@/lib/imageUtils";
import { AlertModal } from "./ui/modals/alert-modal";
import { ActionModal } from "./ui/modals/action-modal";
import ProductPage from "./ProductPage";
import { ProductProvider, useProduct } from "@/contexts/ProductContext";
import { productSchema } from "@athena/api";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import useGetActiveProduct from "@/hooks/useGetActiveProduct";

function ProductViewContent() {
  const {
    productData,
    didProvideRequiredData,
    productVariants,
    updateProductVariants,
  } = useProduct();

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [failedToUploadUrls, setFailedToUploadUrls] = useState<string[]>([]);
  const [isDeletingImages, setIsDeletingImages] = useState(false);

  const [_productId, setProductId] = useState<number | null>(null);

  const navigate = useNavigate();

  const { activeStore } = useGetActiveStore();
  const { activeProduct } = useGetActiveProduct();

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
    if (!activeProduct?.id || !activeStore)
      throw new Error("Missing data required to delete product");
    await deleteProduct({
      organizationId: activeStore.organizationId,
      storeId: activeStore.id,
      productId: activeProduct.id,
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
  //   if (!activeStore) {
  //     throw new Error("Missing store data required to save product");
  //   }

  //   try {
  //     const mainProductData = {
  //       ...productData,
  //       currency: activeStore.currency,
  //       storeId: activeStore.id,
  //       organizationId: activeStore.organizationId,
  //     };

  //     const validatedProductData = productSchema.parse(mainProductData);

  //     const product = await createProduct({
  //       data: { ...validatedProductData, skus: [], createdByUserId: 1 },
  //       organizationId: activeStore.organizationId,
  //       storeId: activeStore.id,
  //     });

  //     for (const variant of productVariants) {
  //       const sku = await createProductSku({
  //         data: {
  //           productId: product.id,
  //           sku: variant.sku,
  //           price: variant.price || 0,
  //           inventoryCount: variant.stock || 0,
  //           unitCost: variant.cost || 0,
  //           images: [],
  //           length: variant.length || null,
  //           size: variant.size || null,
  //           color: variant.color || null,
  //           attributes: {},
  //         },
  //         organizationId: activeStore.organizationId,
  //         storeId: activeStore.id,
  //         productId: product.id,
  //       });
  //       // Upload and update SKU images
  //       if (variant.images && variant.images.length > 0) {
  //         const { imageUrls } = await uploadProductImages(
  //           variant.images,
  //           activeStore.id,
  //           product.id
  //         );
  //         await updateProductSku({
  //           data: { images: imageUrls },
  //           organizationId: activeStore.organizationId,
  //           storeId: activeStore.id,
  //           productId: product.id,
  //           skuId: sku.id,
  //         });
  //       }
  //     }

  //     return product;
  //   } catch (error) {
  //     console.error("Error saving product:", (error as ZodError).message);
  //     // setError(error);
  //     throw error;
  //   }
  // };

  const saveProduct = async () => {
    if (!activeStore) {
      throw new Error("Missing store data required to save product");
    }

    try {
      const mainProductData = {
        ...productData,
        currency: activeStore.currency,
        storeId: activeStore.id,
        organizationId: activeStore.organizationId,
      };

      const validatedProductData = productSchema.parse(mainProductData);

      const product = await createProduct({
        data: { ...validatedProductData, skus: [], createdByUserId: 1 },
        organizationId: activeStore.organizationId,
        storeId: activeStore.id,
      });

      await Promise.all(
        productVariants.map((variant) => createVariantSku(product.id, variant))
      );

      return product;
    } catch (error) {
      console.error("Error saving product:", (error as ZodError).message);
      throw error;
    }
  };

  const modifyProduct = async () => {
    if (!activeProduct?.id || !activeStore) {
      throw new Error("Missing data required to save product");
    }

    try {
      const updatedProductData = productSchema.parse({
        ...productData,
        currency: activeStore.currency,
        storeId: activeStore.id,
        organizationId: activeStore.organizationId,
      });

      await updateProduct({
        data: updatedProductData,
        organizationId: activeStore.organizationId,
        storeId: activeStore.id,
        productId: activeProduct.id,
      });

      await Promise.all(
        productVariants.map((variant) => {
          if (variant.id) {
            return variant.markedForDeletion
              ? deleteProductSku({
                  organizationId: activeStore.organizationId,
                  storeId: activeStore.id,
                  productId: activeProduct.id,
                  skuId: variant.id,
                })
              : updateVariantSku(activeProduct.id, variant);
          } else {
            return createVariantSku(activeProduct.id, variant);
          }
        })
      );

      // Remove variants marked for deletion from the state
      updateProductVariants((prevVariants) =>
        prevVariants.filter((variant) => !variant.markedForDeletion)
      );

      return activeProduct;
    } catch (error) {
      console.error("Error modifying product:", (error as ZodError).message);
      throw error;
    }
  };

  // const modifyProduct = async () => {
  //   const pid = activeProduct?.id || _productId;

  //   if (!pid || !activeStore)
  //     throw new Error("Missing data required to save product");

  //   // updateError(null);

  //   // const { imageUrls, failedDeleteUrls } = await uploadProductImages(
  //   //   images,
  //   //   activeStore.id,
  //   //   pid
  //   // );

  //   // if (failedDeleteUrls.length > 0) {
  //   //   setFailedToUploadUrls(failedDeleteUrls);
  //   //   setIsActionModalOpen(true);
  //   //   throw new Error("ahhhh");
  //   // }

  //   try {
  //     // const data = productSchema.parse({
  //     //   ...productData,
  //     //   currency: "usd",
  //     //   storeId: activeStore.id,
  //     //   organizationId: activeStore.organizationId,
  //     //   images: imageUrls,
  //     // });
  //     // return await updateProduct({
  //     //   data,
  //     //   organizationId: activeStore.organizationId,
  //     //   storeId: activeStore.id,
  //     //   productId: pid,
  //     // });
  //   } catch (error) {
  //     // updateError(error as ZodError);

  //     throw error;
  //   }
  // };

  const createVariantSku = async (productId: number, variant: any) => {
    const sku = await createProductSku({
      data: {
        productId,
        sku: variant.sku,
        price: variant.price || 0,
        inventoryCount: variant.stock || 0,
        unitCost: variant.cost || 0,
        images: [],
        length: variant.length || null,
        size: variant.size || null,
        color: variant.color || null,
        attributes: {},
      },
      organizationId: activeStore!.organizationId,
      storeId: activeStore!.id,
      productId,
    });

    if (variant.images && variant.images.length > 0) {
      const { imageUrls } = await uploadProductImages(
        variant.images,
        activeStore!.id,
        productId
      );
      await updateProductSku({
        data: { images: imageUrls },
        organizationId: activeStore!.organizationId,
        storeId: activeStore!.id,
        productId,
        skuId: sku.id,
      });
    }
  };

  const updateVariantSku = async (productId: number, variant: any) => {
    await updateProductSku({
      data: {
        sku: variant.sku,
        price: variant.price || 0,
        inventoryCount: variant.stock || 0,
        unitCost: variant.cost || 0,
        length: variant.length || null,
        size: variant.size || null,
        color: variant.color || null,
        attributes: {},
      },
      organizationId: activeStore!.organizationId,
      storeId: activeStore!.id,
      productId,
      skuId: variant.id,
    });

    if (variant.images && variant.images.length > 0) {
      const { imageUrls } = await uploadProductImages(
        variant.images,
        activeStore!.id,
        productId
      );
      await updateProductSku({
        data: { images: imageUrls },
        organizationId: activeStore!.organizationId,
        storeId: activeStore!.id,
        productId,
        skuId: variant.id,
      });
    }
  };

  const onSubmit = () => {
    if (activeProduct?.id || _productId) updateMutation.mutate();
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

  // const isValid = didProvideRequiredData();
  const isValid = true;

  const Navigation = () => {
    const header = activeProduct ? "Edit Product" : "Add New Product";
    const ctaText = activeProduct ? "Save Product" : "Add Product";

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
          {activeProduct && (
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
            {ctaText}
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
