import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import View from "../View";
import { CheckCircledIcon, TrashIcon } from "@radix-ui/react-icons";
import { ZodError } from "zod";
import { toast } from "sonner";
import {
  Ban,
  Eye,
  EyeOff,
  Plus,
  PlusIcon,
  RotateCcw,
  Save,
} from "lucide-react";
import { LoadingButton } from "../ui/loading-button";
import { useState } from "react";
import { convertImagesToWebp, getUploadImagesData } from "@/lib/imageUtils";
import { AlertModal } from "../ui/modals/alert-modal";
import ProductPage from "./ProductPage";
import { ProductProvider, useProduct } from "@/contexts/ProductContext";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import useGetActiveProduct from "@/hooks/useGetActiveProduct";
import { useAction, useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { toSlug } from "../../lib/utils";
import { Id } from "~/convex/_generated/dataModel";
import { productSchema } from "../../lib/schemas/product";
import { useAuth } from "../../hooks/useAuth";
import { ComposedPageHeader } from "../common/PageHeader";
import { PAYSTACK_PROCESSING_FEE } from "~/src/lib/constants";
import { Tooltip, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Badge } from "../ui/badge";
import { ProductStatus } from "../product/ProductStatus";

function ProductViewContent() {
  const { productData, revertChanges, productVariants, updateProductVariants } =
    useProduct();

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isMakeProductVisibleModalOpen, setIsMakeProductVisibleModalOpen] =
    useState(false);
  const [isUpdatingProductVisibility, setIsUpdatingProductVisibility] =
    useState(false);

  const [failedToUploadUrls, setFailedToUploadUrls] = useState<string[]>([]);
  const [isDeletingImages, setIsDeletingImages] = useState(false);
  const [productId, setProductid] = useState<Id<"product"> | null>(null);

  const [isCreateMutationPending, setIsCreateMutationPending] = useState(false);
  const [isUpdateMutationPending, setIsUpdateMutationPending] = useState(false);
  const [isDeleteMutationPending, setIsDeleteMutationPending] = useState(false);

  const navigate = useNavigate();

  const { activeStore } = useGetActiveStore();
  const { activeProduct } = useGetActiveProduct();
  const { user } = useAuth();

  const createProduct = useMutation(api.inventory.products.create);
  const createSku = useMutation(api.inventory.products.createSku);
  const updateProduct = useMutation(api.inventory.products.update);
  const deleteProduct = useAction(api.inventory.products.clear);
  const deleteSku = useMutation(api.inventory.products.removeSku);
  const updateSku = useMutation(api.inventory.products.updateSku);

  const uploadProductSkuImages = useAction(
    api.inventory.productSku.uploadImages
  );

  const deleteProductSkuImages = useAction(
    api.inventory.productSku.deleteImages
  );

  const updateProductSku = useMutation(api.inventory.productSku.update);

  const { o } = useSearch({ strict: false });

  const deleteActiveProduct = async () => {
    if (!activeProduct?._id || !activeStore)
      throw new Error("Missing data required to delete product");

    try {
      setIsDeleteMutationPending(true);
      await deleteProduct({ id: activeProduct._id, storeId: activeStore._id });

      toast(`Product '${activeProduct.name}' deleted`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });

      if (o) {
        navigate({ to: decodeURIComponent(o) });
      }

      // navigate({
      //   to: "/$orgUrlSlug/store/$storeUrlSlug/products",
      //   params: (prev) => ({
      //     ...prev,
      //     storeUrlSlug: prev.storeUrlSlug!,
      //     orgUrlSlug: prev.orgUrlSlug!,
      //   }),
      // });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsDeleteMutationPending(false);
    }
  };

  const saveProduct = async () => {
    if (!activeStore || !user) {
      throw new Error("Missing store data required to save product");
    }

    try {
      setIsCreateMutationPending(true);

      const mainProductData = {
        ...productData,
        currency: activeStore.currency,
        storeId: activeStore._id,
        organizationId: activeStore.organizationId,
      };

      const validatedProductData = productSchema.parse(mainProductData);

      const product = await createProduct({
        ...validatedProductData,
        slug: toSlug(validatedProductData.name),
        createdByUserId: user._id,
        organizationId:
          validatedProductData.organizationId as Id<"organization">,
        storeId: validatedProductData.storeId as Id<"store">,
        categoryId: validatedProductData.categoryId as Id<"category">,
        subcategoryId: validatedProductData.subcategoryId as Id<"subcategory">,
        inventoryCount: 0,
        attributes: validatedProductData.attributes || {},
        isVisible: true,
      });

      if (product) setProductid(product?._id);

      await Promise.all(
        productVariants.map((variant) =>
          createVariantSku(product!._id, variant)
        )
      );

      toast.success(`Product created`);

      if (o) {
        navigate({ to: decodeURIComponent(o) });
      }
    } catch (error) {
      console.error("Error saving product:", (error as Error).message);

      toast.error("Something went wrong", {
        description: (error as Error).message,
      });
    } finally {
      setIsCreateMutationPending(false);
    }
  };

  const modifyProduct = async () => {
    const _productId = activeProduct?._id || productId;
    if (!_productId || !activeStore) {
      throw new Error("Missing data required to save product");
    }

    try {
      setIsUpdateMutationPending(true);
      const data = {
        ...productData,
        organizationId: activeStore.organizationId,
        storeId: activeStore._id,
        description: productData.description || undefined,
        currency: activeStore.currency,
      };

      const { organizationId, storeId, ...updatedProductData } =
        productSchema.parse(data);

      await updateProduct({
        ...updatedProductData,
        slug: toSlug(updatedProductData.name),
        id: _productId,
        categoryId: updatedProductData.categoryId as Id<"category">,
        subcategoryId: updatedProductData.subcategoryId as Id<"subcategory">,
      });

      // console.log("variants in flow:", productVariants);

      const res = await Promise.all(
        productVariants.map((variant) => {
          if (variant.existsInDB) {
            return variant.markedForDeletion
              ? deleteSku({ id: variant.id as Id<"productSku"> })
              : updateVariantSku(variant.id, variant);
          } else {
            return createVariantSku(_productId, variant);
          }
        })
      );

      // Remove variants marked for deletion from the state
      updateProductVariants((prevVariants) =>
        prevVariants.filter((variant) => !variant.markedForDeletion)
      );

      if (res.some((r: any) => r === false)) {
        return;
      }

      toast.success("Changes saved");

      if (o) {
        navigate({ to: decodeURIComponent(o) });
      }

      // navigate({
      //   to: "/$orgUrlSlug/store/$storeUrlSlug/products",
      //   params: (prev) => ({
      //     ...prev,
      //     storeUrlSlug: prev.storeUrlSlug!,
      //     orgUrlSlug: prev.orgUrlSlug!,
      //   }),
      // });
    } catch (error) {
      console.error("Error modifying product:", (error as ZodError).message);

      toast.error("Something went wrong", {
        description: (error as Error).message,
      });
    } finally {
      setIsUpdateMutationPending(false);
    }
  };

  const createVariantSku = async (productId: Id<"product">, variant: any) => {
    let images: string[] = [];

    if (variant.images && variant.images.length > 0) {
      try {
        const { newImages } = getUploadImagesData(variant.images);

        const imageBuffers = await convertImagesToWebp(newImages);

        const { images: imageUrls } = await uploadProductSkuImages({
          images: imageBuffers,
          storeId: activeStore!._id,
          productId,
        });

        if (imageUrls.length == 0 && newImages.length > 0) {
          // error uploading images
          toast.error("Error uploading images");
        }

        images = imageUrls;
      } catch (e) {
        toast.error("Error processing images");
      }
    }

    const processingFee =
      ((variant.netPrice || 0) * PAYSTACK_PROCESSING_FEE) / 100;

    const price = productData.areProcessingFeesAbsorbed
      ? variant.netPrice
      : Math.round(variant.netPrice + processingFee);

    return await createSku({
      productId,
      sku: variant.sku,
      price: price || 0,
      netPrice: variant.netPrice || 0,
      inventoryCount: variant.stock || 0,
      quantityAvailable: variant.quantityAvailable || 0,
      unitCost: variant.cost || 0,
      length: variant.length ? parseInt(variant.length) : undefined,
      size: variant.size,
      color: variant.color,
      weight: variant.weight,
      attributes: variant.attributes || {},
      storeId: activeStore!._id,
      images,
    });
  };

  const updateVariantSku = async (skuId: string, variant: any) => {
    if (variant.images && variant.images.length > 0) {
      try {
        const { updatedImageUrls, imageUrlsToDelete, newImages } =
          getUploadImagesData(variant.images);

        if (imageUrlsToDelete.length > 0) {
          await deleteProductSkuImages({ imageUrls: imageUrlsToDelete });
        }

        const imageBuffers = await convertImagesToWebp(newImages);

        const { images } = await uploadProductSkuImages({
          images: imageBuffers,
          storeId: activeStore!._id,
          productId: activeProduct!._id,
        });

        const imageUrls = [...updatedImageUrls, ...images];

        if (images.length == 0 && newImages.length > 0) {
          // error uploading images
          toast.error("Error uploading images");
        }

        await updateProductSku({
          id: skuId as Id<"productSku">,
          update: { images: imageUrls },
        });
      } catch (e) {
        toast.error("Error processing images");
      }
    }

    const processingFee =
      ((variant.netPrice || 0) * PAYSTACK_PROCESSING_FEE) / 100;

    const price = productData.areProcessingFeesAbsorbed
      ? variant.netPrice
      : Math.round(variant.netPrice + processingFee);

    const res: any = await updateSku({
      id: skuId as Id<"productSku">,
      sku: variant.sku,
      price: price || 0,
      netPrice: variant.netPrice || 0,
      inventoryCount: variant.stock || 0,
      quantityAvailable: variant.quantityAvailable || 0,
      unitCost: variant.cost || 0,
      isVisible: variant.isVisible,
      length: variant.length ? parseInt(variant.length) : undefined,
      size: variant.size,
      color: variant.color,
      weight: variant.weight,
      attributes: variant.attributes || {},
    });

    if (res?.success === false) {
      toast.error(res?.error);
      return false;
    }

    return true;
  };

  const onSubmit = async () => {
    if (activeProduct?._id || productId) await modifyProduct();
    else await saveProduct();
  };

  // const retryDeletingImages = async () => {
  //   setIsDeletingImages(true);
  //   const res = await deleteFiles(failedToUploadUrls);
  //   setIsDeletingImages(false);

  //   if (res.failedDeleteKeys.length > 0) {
  //     setFailedToUploadUrls(res.failedDeleteUrls);
  //     setIsActionModalOpen(true);
  //     return;
  //   }
  // };

  // const isValid = didProvideRequiredData();
  const isValid = true;

  const Navigation = () => {
    const { productSlug } = useParams({ strict: false });

    const { activeProduct } = useGetActiveProduct();

    const header = productSlug ? "Edit Product" : "Add New Product";

    const ctaIcon = !productSlug ? (
      <PlusIcon className="w-3.5 h-3.5" />
    ) : (
      <Save className="w-3.5 h-3.5" />
    );

    const updateProductVisibility = async ({
      isVisible,
    }: {
      isVisible: boolean;
    }) => {
      if (!activeProduct || !activeStore) return;

      setIsUpdatingProductVisibility(true);
      try {
        const data = {
          ...productData,
          organizationId: activeStore.organizationId,
          storeId: activeStore._id,
          description: productData.description || undefined,
          currency: activeStore.currency,
        };

        const { organizationId, storeId, ...updatedProductData } =
          productSchema.parse(data);

        await updateProduct({
          ...updatedProductData,
          isVisible,
          slug: toSlug(updatedProductData.name),
          id: activeProduct?._id,
          categoryId: updatedProductData.categoryId as Id<"category">,
          subcategoryId: updatedProductData.subcategoryId as Id<"subcategory">,
        });
        toast.success(
          `Product visibility set to ${isVisible ? "visible" : "hidden"}`
        );
      } catch (e) {
        toast.error("Something went wrong", {
          icon: <Ban className="w-3.5 h-3.5" />,
          description: (e as Error).message,
        });
      } finally {
        setIsUpdatingProductVisibility(false);
      }
    };

    return (
      <ComposedPageHeader
        leadingContent={
          <div className="flex items-center gap-4">
            <p className="text-sm">{header}</p>
            {activeProduct?.isVisible == false && (
              <Badge
                variant={"outline"}
                className="rounded-md px-2 py-1 text-muted-foreground flex items-center gap-2"
              >
                <EyeOff className="h-3.5 w-3.5" />
                <p className="text-xs ">This product is hidden</p>
              </Badge>
            )}
          </div>
        }
        trailingContent={
          <div className="flex space-x-2">
            {activeProduct && (
              <>
                <LoadingButton
                  isLoading={isDeleteMutationPending}
                  className="text-red-400 flex gap-2 items-center bg-red-50 hover:bg-red-100 hover:text-red-800"
                  variant={"outline"}
                  onClick={() => setIsDeleteModalOpen(true)}
                >
                  <p>Delete</p>
                  <TrashIcon className="w-3.5 h-3.5" />
                </LoadingButton>

                <div className="flex items-center gap-2">
                  <LoadingButton
                    isLoading={isUpdatingProductVisibility}
                    variant={"outline"}
                    onClick={() => {
                      updateProductVisibility({
                        isVisible: !activeProduct?.isVisible,
                      });
                    }}
                  >
                    {(activeProduct?.isVisible == undefined ||
                      activeProduct?.isVisible) && (
                      <div className="flex gap-2 items-center">
                        <p>Hide</p>
                        <EyeOff className="w-3.5 h-3.5" />
                      </div>
                    )}

                    {activeProduct?.isVisible == false && (
                      <div className="flex gap-2 items-center">
                        <p>Make visible</p>
                        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                    )}
                  </LoadingButton>
                </div>

                <LoadingButton
                  isLoading={isDeleteMutationPending}
                  variant={"outline"}
                  onClick={() => revertChanges()}
                  className="flex gap-2 items-center"
                >
                  <p>Revert changes</p>
                  <RotateCcw className="w-3.5 h-3.5" />
                </LoadingButton>
              </>
            )}
            <LoadingButton
              disabled={!isValid}
              isLoading={isCreateMutationPending || isUpdateMutationPending}
              onClick={onSubmit}
              variant={"outline"}
              className="flex gap-2 items-center text-blue-700 bg-blue-50 hover:bg-blue-100"
            >
              <p>{productSlug ? "Save" : "Add"}</p>
              {ctaIcon}
            </LoadingButton>
          </div>
        }
      />
    );
  };

  return (
    <View header={<Navigation />}>
      <AlertModal
        title="Delete product?"
        isOpen={isDeleteModalOpen}
        loading={isDeleteMutationPending}
        onClose={() => {
          setIsDeleteModalOpen(false);
        }}
        onConfirm={() => {
          deleteActiveProduct();
        }}
      />
      <AlertModal
        title="Do you want to make this product visible?"
        ctaText="Yes"
        secondaryCtaText="No"
        showCancel={false}
        isOpen={isMakeProductVisibleModalOpen}
        loading={isDeleteMutationPending}
        onClose={() => {
          setIsMakeProductVisibleModalOpen(false);
        }}
        onConfirm={() => {
          deleteActiveProduct();
        }}
      />
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
