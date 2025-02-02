import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DollarSign, Percent } from "lucide-react";
import { DiscountType } from "../AddPromoCodeView";

function DiscountTypeToggleGroup({
  discountType,
  setDiscountType,
}: {
  discountType: DiscountType;
  setDiscountType: (value: DiscountType) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={discountType}
      onValueChange={(value) => {
        setDiscountType(value as DiscountType);
      }}
    >
      <ToggleGroupItem value="amount" aria-label="Toggle amount">
        <DollarSign className="w-4 h-4 mr-2" />
        Amount
      </ToggleGroupItem>
      <ToggleGroupItem value="percentage" aria-label="Toggle pecentage">
        <Percent className="w-4 h-4 mr-2" />
        Percentage
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export default DiscountTypeToggleGroup;
