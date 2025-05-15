import View from "../View";
import PageHeader from "../common/PageHeader";
import { LoadingButton } from "../ui/loading-button";
import { PlusIcon } from "lucide-react";
import { DiscountType } from "./types";

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
