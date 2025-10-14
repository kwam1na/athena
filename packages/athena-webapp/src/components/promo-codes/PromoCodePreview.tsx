import View from "../View";
import PageHeader from "../common/PageHeader";
import { LoadingButton } from "../ui/loading-button";
import { PlusIcon } from "lucide-react";
import { DiscountType, PromoCodeSpan } from "./types";
import { Product, ProductSku } from "~/types";
import { getProductName } from "~/src/lib/productUtils";

interface PromoCodePreviewProps {
  promoCode: string | null;
  discount: string | null;
  discountType: DiscountType;
  currencyFormatter: {
    format: (value: number) => string;
  };
  hasEnteredCode: boolean;
  promoCodeSlug?: string;
  isAddingPromoCode: boolean;
  handleAddPromoCode: () => void;
  promoCodeSpan: PromoCodeSpan;
  products?: ProductSku[];
}

const PromoCodePreview = ({
  promoCode,
  discount,
  discountType,
  currencyFormatter,
  hasEnteredCode,
  promoCodeSlug,
  isAddingPromoCode,
  handleAddPromoCode,
  promoCodeSpan,
  products,
}: PromoCodePreviewProps) => {
  const Discount = () => {
    if (!discount) return null;

    return (
      <p className="text-sm">
        for{" "}
        <strong>
          {discountType === "amount"
            ? currencyFormatter.format(parseFloat(discount))
            : `${discount}%`}
        </strong>{" "}
        off
      </p>
    );
  };

  const showProducts =
    promoCodeSpan === "selected-products" && products && products.length > 0;

  return (
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

        {showProducts && (
          <div className="space-y-4">
            <p className="text-sm font-medium">Applies to these products:</p>
            <div className="grid grid-cols-2 gap-4">
              {products.map((product) => {
                // Get the first image from the first SKU
                const productImage = product.images?.[0];

                return (
                  <div
                    key={product._id}
                    className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    {productImage ? (
                      <img
                        src={productImage}
                        alt={product.productName}
                        className="w-12 h-12 object-cover rounded"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">
                          No image
                        </span>
                      </div>
                    )}
                    <p className="text-sm font-medium line-clamp-2 flex-1">
                      {getProductName(product)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
  );
};

export default PromoCodePreview;
