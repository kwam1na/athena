import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import View from "../View";
import { Button } from "../ui/button";
import {
  ArrowLeftIcon,
  CheckCircledIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { ZodError } from "zod";
import { toast } from "sonner";
import { Ban, Plus, PlusIcon, RotateCcw, Save } from "lucide-react";
import { LoadingButton } from "../ui/loading-button";
import { useState } from "react";
import {
  convertImagesToWebp,
  deleteFiles,
  getUploadImagesData,
} from "@/lib/imageUtils";
import { AlertModal } from "../ui/modals/alert-modal";
import { ActionModal } from "../ui/modals/action-modal";
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
import PageHeader from "../common/PageHeader";

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

  const deleteActiveProduct = async () => {
    if (!activeProduct?._id || !activeStore)
      throw new Error("Missing data required to delete product");

    try {
      setIsDeleteMutationPending(true);
      await deleteProduct({ id: activeProduct._id, storeId: activeStore._id });

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
      });

      if (product) setProductid(product?._id);

      await Promise.all(
        productVariants.map((variant) =>
          createVariantSku(product!._id, variant)
        )
      );

      toast.success(`Product created`);

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

      toast.success("Changes saved");

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

        images = imageUrls;
      } catch (e) {
        toast.error("Error processing images");
      }
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

        await updateProductSku({
          id: skuId as Id<"productSku">,
          update: { images: imageUrls },
        });
      } catch (e) {
        toast.error("Error processing images");
      }
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

    const ctaIcon = !productSlug ? (
      <PlusIcon className="w-4 h-4" />
    ) : (
      <Save className="w-4 h-4" />
    );

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
      <PageHeader>
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
                className="text-red-400 hover:bg-red-300 hover:text-red-800"
                variant={"outline"}
                onClick={() => setIsDeleteModalOpen(true)}
              >
                <TrashIcon className="w-4 h-4" />
              </LoadingButton>

              <LoadingButton
                isLoading={isDeleteMutationPending}
                variant={"outline"}
                onClick={() => revertChanges()}
              >
                <RotateCcw className="w-4 h-4" />
              </LoadingButton>
            </>
          )}
          <LoadingButton
            disabled={!isValid}
            isLoading={isCreateMutationPending || isUpdateMutationPending}
            onClick={onSubmit}
            variant={"outline"}
          >
            {ctaIcon}
          </LoadingButton>
        </div>
      </PageHeader>
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
