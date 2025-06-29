import { Input } from "../ui/input";
import DiscountTypeToggleGroup from "./add-promo-code/DiscountTypeToggleGroup";
import PromoCodeSpanToggleGroup from "./add-promo-code/PromoCodeSpanToggleGroup";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import Products from "./Products";
import { Id } from "~/convex/_generated/dataModel";
import { Dispatch, SetStateAction } from "react";
import { DiscountType, PromoCodeSpan } from "./types";

interface PromoCodeFormProps {
  promoCode: string | null;
  setPromoCode: Dispatch<SetStateAction<string | null>>;
  discount: string | null;
  setDiscount: Dispatch<SetStateAction<string | null>>;
  discountType: DiscountType;
  setDiscountType: (value: DiscountType) => void;
  promoCodeSpan: PromoCodeSpan;
  setPromoCodeSpan: Dispatch<SetStateAction<PromoCodeSpan>>;
  isActive: boolean;
  setIsActive: Dispatch<SetStateAction<boolean>>;
  autoApply: boolean;
  setAutoApply: Dispatch<SetStateAction<boolean>>;
  isExclusive: boolean;
  setIsExclusive: Dispatch<SetStateAction<boolean>>;
  isSitewide: boolean;
  setIsSitewide: Dispatch<SetStateAction<boolean>>;
  isHomepageDiscountCode: boolean;
  setIsHomepageDiscountCode?: Dispatch<SetStateAction<boolean>>;
  updateHomepageDiscountCode?: (checked: boolean) => Promise<void>;
  isUpdatingPromoCode: boolean;
  isUpdatingStoreConfig: boolean;
  promoCodeSlug?: Id<"promoCode">;
  products: any[];
}

const PromoCodeForm = ({
  promoCode,
  setPromoCode,
  discount,
  setDiscount,
  discountType,
  setDiscountType,
  promoCodeSpan,
  setPromoCodeSpan,
  isActive,
  setIsActive,
  autoApply,
  setAutoApply,
  isExclusive,
  setIsExclusive,
  isSitewide,
  setIsSitewide,
  isHomepageDiscountCode,
  updateHomepageDiscountCode,
  isUpdatingPromoCode,
  isUpdatingStoreConfig,
  promoCodeSlug,
  products,
}: PromoCodeFormProps) => {
  const toggleDiscountType = (value: DiscountType) => {
    setDiscountType(value);
  };

  return (
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

      <div className="flex items-center gap-8 border rounded-lg p-4 w-fit">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground" htmlFor="sitewide">
              Sitewide
            </Label>
          </div>
          <Switch
            id="sitewide"
            disabled={isUpdatingPromoCode}
            checked={isSitewide}
            onCheckedChange={(e) => {
              setIsSitewide(e);
            }}
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground" htmlFor="active">
              Active
            </Label>
          </div>
          <Switch
            id="active"
            disabled={isUpdatingPromoCode}
            checked={isActive}
            onCheckedChange={(e) => {
              setIsActive(e);
            }}
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground" htmlFor="autoapply">
              Auto-apply
            </Label>
          </div>
          <Switch
            id="autoapply"
            disabled={isUpdatingPromoCode}
            checked={autoApply}
            onCheckedChange={(e) => {
              setAutoApply(e);
            }}
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground" htmlFor="exclusive">
              Exclusive
            </Label>
          </div>
          <Switch
            id="exclusive"
            disabled={isUpdatingPromoCode}
            checked={isExclusive}
            onCheckedChange={(e) => {
              setIsExclusive(e);
            }}
          />
        </div>
      </div>

      {promoCodeSlug && updateHomepageDiscountCode && (
        <div className="flex items-center gap-8 border rounded-lg p-4 w-fit">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label
                className="text-muted-foreground"
                htmlFor="homepage-discount"
              >
                Use as homepage discount code
              </Label>
            </div>
            <Switch
              id="homepage-discount"
              disabled={isUpdatingStoreConfig}
              checked={isHomepageDiscountCode}
              onCheckedChange={updateHomepageDiscountCode}
            />
          </div>
        </div>
      )}

      {promoCodeSpan === "selected-products" && (
        <Products products={products} />
      )}
    </div>
  );
};

export default PromoCodeForm;
