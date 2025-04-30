import { useMutation, useQuery } from "convex/react";
import StoreProducts from "../products/StoreProducts";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import PromoCodes from "./PromoCodes";
import PageHeader, { ComposedPageHeader } from "../common/PageHeader";
import { Button } from "../ui/button";
import { ArrowLeftIcon, TrashIcon } from "@radix-ui/react-icons";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Input } from "../ui/input";
import DiscountTypeToggleGroup from "./add-promo-code/DiscountTypeToggleGroup";
import Products from "./Products";
import { useGetProducts } from "~/src/hooks/useGetProducts";
import { currencyFormatter } from "~/src/lib/utils";
import { Product } from "~/types";
import { useEffect, useState } from "react";
import { PlusIcon, Save } from "lucide-react";
import {
  SelectedProductsProvider,
  useSelectedProducts,
} from "./products-table/selectable-data-provider";
import PromoCodeSpanToggleGroup from "./add-promo-code/PromoCodeSpanToggleGroup";
import { useAuth } from "~/src/hooks/useAuth";
import { toast } from "sonner";
import { LoadingButton } from "../ui/loading-button";
import { Id } from "~/convex/_generated/dataModel";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

export type DiscountType = "percentage" | "amount";

export type PromoCodeSpan = "entire-order" | "selected-products";

const Header = ({
  isUpdating,
  handleSave,
}: {
  isUpdating: boolean;
  handleSave: () => void;
}) => {
  const navigate = useNavigate();

  const { promoCodeSlug } = useParams({ strict: false });

  const [isDeletingPromoCode, setIsDeletingPromoCode] = useState(false);

  const deletePromoCode = useMutation(api.inventory.promoCode.remove);

  const handleDeletePromoCode = async () => {
    try {
      setIsDeletingPromoCode(true);
      await deletePromoCode({ id: promoCodeSlug as Id<"promoCode"> });
      toast.success("Promo code deleted");
      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/promo-codes",
        params: (prev) => ({
          ...prev,
          storeUrlSlug: prev.storeUrlSlug!,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    } catch (e) {
      toast.error("Failed to delete promo code", {
        description: (e as Error).message,
      });
    } finally {
      setIsDeletingPromoCode(false);
    }
  };

  const header = promoCodeSlug ? "Edit promo code" : "Add promo code";

  return (
    <ComposedPageHeader
      leadingContent={<p className="text-sm">{header}</p>}
      trailingContent={
        <>
          {promoCodeSlug && (
            <div className="ml-auto space-x-2">
              <LoadingButton
                isLoading={isUpdating}
                variant={"outline"}
                onClick={handleSave}
              >
                <Save className="w-4 h-4" />
              </LoadingButton>

              <LoadingButton
                isLoading={isDeletingPromoCode}
                className="text-red-400 hover:bg-red-300 hover:text-red-800"
                variant={"outline"}
                onClick={handleDeletePromoCode}
              >
                <TrashIcon className="w-4 h-4" />
              </LoadingButton>
            </div>
          )}
        </>
      }
    />
  );
};

function PromoCodeView() {
  const products = useGetProducts();

  const { activeStore } = useGetActiveStore();

  const [discountType, setDiscountType] = useState<DiscountType>("amount");
  const [promoCodeSpan, setPromoCodeSpan] =
    useState<PromoCodeSpan>("entire-order");
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [discount, setDiscount] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [autoApply, setAutoApply] = useState(false);

  const [isAddingPromoCode, setIsAddingPromoCode] = useState(false);

  const [isUpdatingPromoCode, setIsUpdatingPromoCode] = useState(false);

  const { selectedProductSkus } = useSelectedProducts();

  const { user } = useAuth();

  const navigate = useNavigate();

  const addPromoCode = useMutation(api.inventory.promoCode.create);

  const updatePromoCode = useMutation(api.inventory.promoCode.update);

  const { promoCodeSlug } = useParams({ strict: false });

  const activePromoCode = useQuery(
    api.inventory.promoCode.getById,
    promoCodeSlug ? { id: promoCodeSlug as Id<"promoCode"> } : "skip"
  );

  useEffect(() => {
    if (activePromoCode) {
      setPromoCode(activePromoCode.code);
      setDiscount(activePromoCode.discountValue.toString());
      setDiscountType(activePromoCode.discountType);
      setPromoCodeSpan(activePromoCode.span);
      setIsActive(activePromoCode.active);
      setAutoApply(activePromoCode.autoApply ?? false);
    }
  }, [activePromoCode]);

  if (!products || !activeStore || !user) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const productsFormatted = products.map((product: Product) => {
    const p = {
      ...product,
      skus: product.skus.map((sku) => {
        return {
          ...sku,
          price: formatter.format(sku.price),
        };
      }),
    };

    return p;
  });

  const Discount = () => {
    if (!discount) return null;

    return (
      <p className="text-sm">
        for{" "}
        <strong>
          {discountType == "amount"
            ? formatter.format(parseFloat(discount))
            : `${discount}%`}
        </strong>{" "}
        off{" "}
        {promoCodeSpan == "entire-order" ? "your entire order" : "select items"}
      </p>
    );
  };

  const toggleDiscountType = (value: DiscountType) => {
    // setDiscount(null);
    setDiscountType(value);
  };

  const handleAddPromoCode = async () => {
    const productSkus =
      promoCodeSpan == "selected-products"
        ? Array.from(selectedProductSkus)
        : undefined;

    try {
      setIsAddingPromoCode(true);
      await addPromoCode({
        storeId: activeStore._id,
        code: promoCode!,
        discountType: discountType,
        discountValue: parseFloat(discount!),
        span: promoCodeSpan,
        productSkus,
        validFrom: Date.now(),
        validTo: Date.now(),
        createdByUserId: user._id,
      });

      toast.success(`Promo code ${promoCode} added`);

      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/promo-codes",
        params: (prev) => ({
          ...prev,
          storeUrlSlug: prev.storeUrlSlug!,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    } catch (e) {
      toast.error("Failed to add promo code", {
        description: (e as Error).message,
      });
    } finally {
      setIsAddingPromoCode(false);
    }
  };

  const handleUpdatePromoCode = async () => {
    const productSkus =
      promoCodeSpan == "selected-products"
        ? Array.from(selectedProductSkus)
        : undefined;

    try {
      setIsUpdatingPromoCode(true);
      await updatePromoCode({
        id: promoCodeSlug as Id<"promoCode">,
        code: promoCode!,
        active: isActive,
        autoApply: autoApply,
        discountType: discountType,
        discountValue: parseFloat(discount!),
        span: promoCodeSpan,
        productSkus,
        validFrom: Date.now(),
        validTo: Date.now(),
      });

      toast.success(`Promo code ${promoCode} updated`);

      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/promo-codes",
        params: (prev) => ({
          ...prev,
          storeUrlSlug: prev.storeUrlSlug!,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    } catch (e) {
      toast.error("Failed to update promo code", {
        description: (e as Error).message,
      });
    } finally {
      setIsUpdatingPromoCode(false);
    }
  };

  const hasSelectedProducts =
    promoCodeSpan == "selected-products" && selectedProductSkus.size > 0;

  const isEntireOrder = promoCodeSpan == "entire-order";

  const hasEnteredCode =
    Boolean(promoCode && discount && discountType) &&
    (isEntireOrder || hasSelectedProducts);

  return (
    <View
      header={
        <Header
          isUpdating={isUpdatingPromoCode}
          handleSave={handleUpdatePromoCode}
        />
      }
    >
      <div className="container mx-auto h-full w-full p-8 space-y-12">
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="flex items-center gap-8">
              <Input
                className="w-[320px]"
                placeholder="Promo code"
                value={promoCode ?? undefined}
                onChange={(e) => {
                  setPromoCode(e.target.value.toUpperCase());
                }}
              />
            </div>

            <div className="flex">
              <DiscountTypeToggleGroup
                discountType={discountType}
                setDiscountType={toggleDiscountType}
              />
            </div>
            <div>
              <Input
                className="w-[160px]"
                type="number"
                placeholder="Discount"
                value={discount ?? undefined}
                onChange={(e) => {
                  setDiscount(e.target.value);
                }}
              />
            </div>

            <div className="flex">
              <PromoCodeSpanToggleGroup
                promoCodeSpan={promoCodeSpan}
                setPromoCodeSpan={setPromoCodeSpan}
              />
            </div>

            <div className="flex items-center gap-8 border rounded-lg p-4 w-[320px]">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label className="text-muted-foreground" htmlFor="custom">
                    Active
                  </Label>
                </div>
                <Switch
                  id="custom"
                  disabled={isUpdatingPromoCode}
                  checked={isActive}
                  onCheckedChange={(e) => {
                    setIsActive(e);
                  }}
                />
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label className="text-muted-foreground" htmlFor="custom">
                    Auto-apply
                  </Label>
                </div>
                <Switch
                  id="custom"
                  disabled={isUpdatingPromoCode}
                  checked={autoApply}
                  onCheckedChange={(e) => {
                    setAutoApply(e);
                  }}
                />
              </div>
            </div>

            {promoCodeSpan == "selected-products" && (
              <Products products={productsFormatted} />
            )}
          </div>

          <View
            hideHeaderBottomBorder
            header={
              <PageHeader>
                <p className="text-sm">Preview</p>
              </PageHeader>
            }
          >
            <div className="px-8 space-y-12">
              <div className="space-y-4">
                {promoCode && (
                  <span className="text-sm">
                    Use promo code <strong>{promoCode}</strong>
                  </span>
                )}
                <Discount />
              </div>

              {hasEnteredCode && !promoCodeSlug && (
                <LoadingButton
                  isLoading={isAddingPromoCode}
                  onClick={handleAddPromoCode}
                >
                  <PlusIcon className="w-3 h-3 mr-2" />
                  Add code
                </LoadingButton>
              )}
            </div>
          </View>
        </div>
      </div>
    </View>
  );
}

export default function AddPromoCodeView() {
  return (
    <SelectedProductsProvider>
      <PromoCodeView />
    </SelectedProductsProvider>
  );
}
