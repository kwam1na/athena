import { useMutation, useQuery } from "convex/react";
import StoreProducts from "../StoreProducts";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import PromoCodes from "./PromoCodes";
import PageHeader from "../common/PageHeader";
import { Button } from "../ui/button";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Input } from "../ui/input";
import DiscountTypeToggleGroup from "./add-promo-code/DiscountTypeToggleGroup";
import Products from "./Products";
import { useGetProducts } from "~/src/hooks/useGetProducts";
import { currencyFormatter } from "~/src/lib/utils";
import { Product } from "~/types";
import { useState } from "react";
import { PlusIcon } from "lucide-react";
import {
  SelectedProductsProvider,
  useSelectedProducts,
} from "./products-table/selectable-data-provider";

const Header = () => {
  const { o } = useSearch({ strict: false });

  const navigate = useNavigate();

  const handleBackClick = () => {
    if (o) {
      navigate({ to: o });
    } else {
      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/promo-codes",
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
      <div className="flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleBackClick}
            variant="ghost"
            className="h-8 px-2 lg:px-3 "
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-sm">{`Add Promo code`}</p>
      </div>
    </PageHeader>
  );
};

export type DiscountType = "percentage" | "amount";

function PromoCodeView() {
  const products = useGetProducts();

  const { activeStore } = useGetActiveStore();

  const [discountType, setDiscountType] = useState<DiscountType>("amount");
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [discount, setDiscount] = useState<number | null>(null);

  const { selectedProductSkus } = useSelectedProducts();

  // const addPromoCode = useMutation

  if (!products || !activeStore) return null;

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
            ? formatter.format(discount)
            : `${discount}%`}
        </strong>{" "}
        off
      </p>
    );
  };

  const toggleDiscountType = (value: DiscountType) => {
    // setDiscount(null);
    setDiscountType(value);
  };

  console.log(selectedProductSkus);

  const hasEnteredCode =
    Boolean(promoCode && discount && discountType) &&
    selectedProductSkus.size > 0;

  return (
    <View header={<Header />}>
      <div className="container mx-auto h-full w-full p-8 space-y-12">
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-6">
            <div>
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
                onChange={(e) => {
                  setDiscount(Number(e.target.value));
                }}
              />
            </div>

            <Products products={productsFormatted} />
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

              {hasEnteredCode && (
                <Button>
                  <PlusIcon className="w-3 h-3 mr-2" />
                  Add code
                </Button>
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
