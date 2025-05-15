import { useMutation, useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useGetProducts } from "~/src/hooks/useGetProducts";
import { currencyFormatter } from "~/src/lib/utils";
import { Product } from "~/types";
import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  SelectedProductsProvider,
  useSelectedProducts,
} from "./selectable-products-table/selectable-data-provider";
import { useAuth } from "~/src/hooks/useAuth";
import { toast } from "sonner";
import { Id } from "~/convex/_generated/dataModel";
import { FadeIn } from "../common/FadeIn";
import { Separator } from "../ui/separator";
import { DiscountType, PromoCodeSpan } from "./types";
import PromoCodeHeader from "./PromoCodeHeader";
import PromoCodeForm from "./PromoCodeForm";
import PromoCodePreview from "./PromoCodePreview";
import PromoCodeAnalytics from "./analytics/PromoCodeAnalytics";

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
  const [isSitewide, setIsSitewide] = useState(false);
  const [isHomepageDiscountCode, setIsHomepageDiscountCode] = useState(false);

  const [isAddingPromoCode, setIsAddingPromoCode] = useState(false);
  const [isUpdatingPromoCode, setIsUpdatingPromoCode] = useState(false);
  const [isUpdatingStoreConfig, setIsUpdatingStoreConfig] = useState(false);

  const { selectedProductSkus } = useSelectedProducts();
  const { user } = useAuth();
  const navigate = useNavigate();

  const addPromoCode = useMutation(api.inventory.promoCode.create);
  const updatePromoCode = useMutation(api.inventory.promoCode.update);
  const updateStoreConfig = useMutation(api.inventory.stores.updateConfig);

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
      setIsSitewide(activePromoCode.sitewide ?? false);

      // Check if this promo code is set as homepage discount code
      if (
        activeStore?.config?.homepageDiscountCodeModalPromoCode ===
        activePromoCode._id
      ) {
        setIsHomepageDiscountCode(true);
      }
    }
  }, [activePromoCode, activeStore]);

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

  const handleAddPromoCode = async () => {
    const productSkus =
      promoCodeSpan == "selected-products"
        ? Array.from(selectedProductSkus)
        : undefined;

    const displayText =
      discountType == "amount"
        ? formatter.format(parseFloat(discount!))
        : `${discount}%`;

    try {
      setIsAddingPromoCode(true);
      const newPromoCode = await addPromoCode({
        storeId: activeStore._id,
        code: promoCode!,
        discountType: discountType,
        discountValue: parseFloat(discount!),
        displayText: displayText,
        sitewide: isSitewide,
        autoApply: autoApply,
        span: promoCodeSpan,
        productSkus,
        validFrom: Date.now(),
        validTo: Date.now(),
        createdByUserId: user._id,
      });

      toast.success(`Promo code ${promoCode} added`);

      // If set as homepage discount code, update store config
      if (isHomepageDiscountCode && newPromoCode.promoCode) {
        await updateStoreConfig({
          id: activeStore._id,
          config: {
            ...activeStore.config,
            homepageDiscountCodeModalPromoCode: newPromoCode.promoCode._id,
          },
        });
        toast.success("Set as homepage discount code");
      }

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

    const displayText =
      discountType == "amount"
        ? formatter.format(parseFloat(discount!))
        : `${discount}%`;

    try {
      setIsUpdatingPromoCode(true);
      await updatePromoCode({
        id: promoCodeSlug as Id<"promoCode">,
        code: promoCode!,
        active: isActive,
        autoApply: autoApply,
        sitewide: isSitewide,
        discountType: discountType,
        discountValue: parseFloat(discount!),
        displayText: displayText,
        span: promoCodeSpan,
        productSkus,
        validFrom: Date.now(),
        validTo: Date.now(),
      });

      toast.success(`Promo code ${promoCode} updated`);

      // Update store config for homepage discount code if needed
      if (activeStore && promoCodeSlug) {
        const currentHomepagePromoCodeId =
          activeStore.config?.homepageDiscountCodeModalPromoCode;
        const isCurrentlyHomepageCode =
          currentHomepagePromoCodeId === promoCodeSlug;

        if (isHomepageDiscountCode && !isCurrentlyHomepageCode) {
          // Add this promo code as homepage discount code
          await updateStoreConfig({
            id: activeStore._id,
            config: {
              ...activeStore.config,
              homepageDiscountCodeModalPromoCode: promoCodeSlug,
            },
          });
          toast.success("Set as homepage discount code");
        } else if (!isHomepageDiscountCode && isCurrentlyHomepageCode) {
          // Remove this promo code as homepage discount code
          const { homepageDiscountCodeModalPromoCode, ...restConfig } =
            activeStore.config || {};
          await updateStoreConfig({
            id: activeStore._id,
            config: restConfig,
          });
          toast.success("Removed as homepage discount code");
        }
      }

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

  const updateHomepageDiscountCode = async (checked: boolean) => {
    if (!activeStore || !promoCodeSlug) return;

    try {
      setIsUpdatingStoreConfig(true);

      if (checked) {
        // Set this promo code as homepage discount code
        await updateStoreConfig({
          id: activeStore._id,
          config: {
            ...activeStore.config,
            homepageDiscountCodeModalPromoCode: promoCodeSlug,
          },
        });
        toast.success("Set as homepage discount code");
      } else {
        // Remove this promo code as homepage discount code
        const { homepageDiscountCodeModalPromoCode, ...restConfig } =
          activeStore.config || {};
        await updateStoreConfig({
          id: activeStore._id,
          config: restConfig,
        });
        toast.success("Removed as homepage discount code");
      }

      setIsHomepageDiscountCode(checked);
    } catch (e) {
      toast.error("Failed to update homepage discount code", {
        description: (e as Error).message,
      });
    } finally {
      setIsUpdatingStoreConfig(false);
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
        <PromoCodeHeader
          isUpdating={isUpdatingPromoCode}
          handleSave={handleUpdatePromoCode}
        />
      }
    >
      <FadeIn className="container mx-auto h-full w-full p-8 space-y-12">
        <div className="grid grid-cols-2 gap-8">
          <PromoCodeForm
            promoCode={promoCode}
            setPromoCode={setPromoCode}
            discount={discount}
            setDiscount={setDiscount}
            discountType={discountType}
            setDiscountType={setDiscountType}
            promoCodeSpan={promoCodeSpan}
            setPromoCodeSpan={setPromoCodeSpan}
            isActive={isActive}
            setIsActive={setIsActive}
            autoApply={autoApply}
            setAutoApply={setAutoApply}
            isSitewide={isSitewide}
            setIsSitewide={setIsSitewide}
            isHomepageDiscountCode={isHomepageDiscountCode}
            updateHomepageDiscountCode={updateHomepageDiscountCode}
            isUpdatingPromoCode={isUpdatingPromoCode}
            isUpdatingStoreConfig={isUpdatingStoreConfig}
            promoCodeSlug={promoCodeSlug as Id<"promoCode">}
            products={productsFormatted}
          />

          <PromoCodePreview
            promoCode={promoCode}
            discount={discount}
            discountType={discountType}
            currencyFormatter={formatter}
            hasEnteredCode={hasEnteredCode}
            promoCodeSlug={promoCodeSlug}
            isAddingPromoCode={isAddingPromoCode}
            handleAddPromoCode={handleAddPromoCode}
          />
        </div>

        {/* Analytics section - only show when editing an existing promo code */}
        {promoCodeSlug && (
          <div className="mt-12">
            <Separator className="mb-8" />
            <View
              hideHeaderBottomBorder
              header={
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  <p className="text-sm">Analytics</p>
                </div>
              }
            >
              <div className="p-8">
                <PromoCodeAnalytics
                  promoCodeId={promoCodeSlug as Id<"promoCode">}
                />
              </div>
            </View>
          </div>
        )}
      </FadeIn>
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
