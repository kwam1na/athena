import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DollarSign, Percent } from "lucide-react";
import { DiscountType, PromoCodeSpan } from "../PromoCodeView";

function PromoCodeSpanToggleGroup({
  promoCodeSpan,
  setPromoCodeSpan,
}: {
  promoCodeSpan: PromoCodeSpan;
  setPromoCodeSpan: (value: PromoCodeSpan) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={promoCodeSpan}
      onValueChange={(value) => {
        setPromoCodeSpan(value as PromoCodeSpan);
      }}
    >
      <ToggleGroupItem value="entire-order" aria-label="Toggle entire order">
        Entire order
      </ToggleGroupItem>
      <ToggleGroupItem
        value="selected-products"
        aria-label="Toggle select products"
      >
        Product
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export default PromoCodeSpanToggleGroup;
