import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import View from "./View";
import { Button } from "./ui/button";
import {
  ArrowLeftIcon,
  CheckCircledIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { ZodError } from "zod";
import { toast } from "sonner";
import { Ban, RotateCcw } from "lucide-react";
import { LoadingButton } from "./ui/loading-button";
import { useState } from "react";
import { deleteFiles, uploadProductImages } from "@/lib/imageUtils";
import { AlertModal } from "./ui/modals/alert-modal";
import { ActionModal } from "./ui/modals/action-modal";
import ProductPage from "./ProductPage";
import { ProductProvider, useProduct } from "@/contexts/ProductContext";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import useGetActiveProduct from "@/hooks/useGetActiveProduct";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { toSlug } from "../lib/utils";
import { Id } from "~/convex/_generated/dataModel";
import { deleteDirectoryInS3 } from "../lib/aws";
import { productSchema } from "../lib/schemas/product";
import { useAuth } from "../hooks/useAuth";

function ProductViewContent() {
  const { productData, revertChanges, productVariants, updateProductVariants } =
    useProduct();

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
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
  const deleteProduct = useMutation(api.inventory.products.remove);
  const deleteSku = useMutation(api.inventory.products.removeSku);
  const updateSku = useMutation(api.inventory.products.updateSku);

  const deleteActiveProduct = async () => {
    if (!activeProduct?._id || !activeStore)
      throw new Error("Missing data required to delete product");

    try {
      setIsDeleteMutationPending(true);
      await deleteProduct({ id: activeProduct._id });
      await deleteDirectoryInS3(
        `stores/${activeStore._id}/products/${activeProduct._id}`
      );

      toast(`Product '${activeProduct.name}' deleted`, {
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
        attributes: {},
      };

      const validatedProductData = productSchema.parse(mainProductData);

      console.log("validatedProductData", validatedProductData);

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
      });

      if (product) setProductid(product?._id);

      await Promise.all(
        productVariants.map((variant) =>
          createVariantSku(product!._id, variant)
        )
      );

      toast(`Product '${validatedProductData.name}' created`, {
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
    } catch (error) {
      console.error("Error saving product:", (error as Error).message);
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
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

      await Promise.all(
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

      toast(`Product '${updatedProductData.name}' updated`, {
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
    } catch (error) {
      console.error("Error modifying product:", (error as ZodError).message);

      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (error as Error).message,
      });
    } finally {
      setIsUpdateMutationPending(false);
    }
  };

  const createVariantSku = async (productId: Id<"product">, variant: any) => {
    let images: string[] = [];

    if (variant.images && variant.images.length > 0) {
      const { imageUrls } = await uploadProductImages(
        variant.images,
        `stores/${activeStore?._id}/products/${productId}`
      );

      images = imageUrls;
    }

    return await createSku({
      productId,
      sku: variant.sku,
      price: variant.price || 0,
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
    let images: string[] = [];

    if (variant.images && variant.images.length > 0) {
      const { imageUrls } = await uploadProductImages(
        variant.images,
        `stores/${activeStore?._id}/products/${activeProduct?._id}`
      );

      images = imageUrls;
    }

    await updateSku({
      id: skuId as Id<"productSku">,
      sku: variant.sku,
      price: variant.price || 0,
      inventoryCount: variant.stock || 0,
      quantityAvailable: variant.quantityAvailable || 0,
      unitCost: variant.cost || 0,
      length: variant.length ? parseInt(variant.length) : undefined,
      size: variant.size,
      color: variant.color,
      weight: variant.weight,
      attributes: variant.attributes || {},
      images,
    });
  };

  const onSubmit = async () => {
    if (activeProduct?._id || productId) await modifyProduct();
    else await saveProduct();
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
    const { o } = useSearch({ strict: false });

    const { productSlug } = useParams({ strict: false });

    const header = productSlug ? "Edit Product" : "Add New Product";
    const ctaText = productSlug ? "Save changes" : "Add Product";

    const navigate = useNavigate();

    const handleBackClick = () => {
      if (o) {
        navigate({ to: decodeURIComponent(o) });
      } else {
        navigate({
          to: "/$orgUrlSlug/store/$storeUrlSlug/products",
          params: (prev) => ({
            ...prev,
            storeUrlSlug: prev.storeUrlSlug!,
            orgUrlSlug: prev.orgUrlSlug!,
          }),
        });
      }
    };

    return (
      <div className="container mx-auto flex gap-2 h-[40px] items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            onClick={handleBackClick}
            variant="ghost"
            className="h-8 px-2 lg:px-3 "
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          <p className="text-sm">{header}</p>
        </div>

        <div className="flex space-x-2">
          {activeProduct && (
            <>
              <LoadingButton
                isLoading={isDeleteMutationPending}
                variant={"outline"}
                className="text-destructive"
                onClick={() => setIsDeleteModalOpen(true)}
              >
                <TrashIcon className="w-4 h-4 mr-2" />
                Delete
              </LoadingButton>

              <LoadingButton
                isLoading={isDeleteMutationPending}
                variant={"outline"}
                onClick={() => revertChanges()}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Revert changes
              </LoadingButton>
            </>
          )}
          <LoadingButton
            disabled={!isValid}
            isLoading={isCreateMutationPending || isUpdateMutationPending}
            onClick={onSubmit}
          >
            {/* {ctaIcon} */}
            {ctaText}
          </LoadingButton>
        </div>
      </div>
    );
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
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
