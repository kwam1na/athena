import { Input } from "../ui/input";
import DiscountTypeToggleGroup from "./add-promo-code/DiscountTypeToggleGroup";
import PromoCodeSpanToggleGroup from "./add-promo-code/PromoCodeSpanToggleGroup";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import Products from "./Products";
import { Id } from "~/convex/_generated/dataModel";
import { Dispatch, SetStateAction } from "react";
import { DiscountType, PromoCodeSpan } from "./types";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PromoCodeFormProps {
  isMultipleUses: boolean;
  setIsMultipleUses: Dispatch<SetStateAction<boolean>>;
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
  isLeaveAReviewDiscountCode: boolean;
  setIsLeaveAReviewDiscountCode?: Dispatch<SetStateAction<boolean>>;
  updateLeaveAReviewDiscountCode?: (checked: boolean) => Promise<void>;
  isUpdatingPromoCode: boolean;
  isUpdatingStoreConfig: boolean;
  promoCodeSlug?: Id<"promoCode">;
  products: any[];
  validFrom: Date | undefined;
  setValidFrom: Dispatch<SetStateAction<Date | undefined>>;
  validTo: Date | undefined;
  setValidTo: Dispatch<SetStateAction<Date | undefined>>;
}

const PromoCodeForm = ({
  isMultipleUses,
  setIsMultipleUses,
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
  isLeaveAReviewDiscountCode,
  updateLeaveAReviewDiscountCode,
  isUpdatingPromoCode,
  isUpdatingStoreConfig,
  promoCodeSlug,
  products,
  validFrom,
  setValidFrom,
  validTo,
  setValidTo,
}: PromoCodeFormProps) => {
  const toggleDiscountType = (value: DiscountType) => {
    setDiscountType(value);
  };

  return (
    <div className="space-y-8">
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

      {/* Valid From and Valid To Date Section */}
      <div className="space-y-4 border rounded-lg p-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="validFrom">Valid From</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !validFrom && "text-muted-foreground"
                  )}
                  disabled={isUpdatingPromoCode}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {validFrom ? (
                    format(validFrom, "PPP")
                  ) : (
                    <span>Pick a date</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={validFrom}
                  onSelect={setValidFrom}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label htmlFor="validTo">Valid To</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !validTo && "text-muted-foreground"
                  )}
                  disabled={isUpdatingPromoCode}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {validTo ? format(validTo, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={validTo}
                  onSelect={setValidTo}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-8 border rounded-lg p-4 w-fit">
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

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground" htmlFor="exclusive">
              Multiple uses
            </Label>
          </div>
          <Switch
            id="exclusive"
            disabled={isUpdatingPromoCode}
            checked={isMultipleUses}
            onCheckedChange={(e) => {
              setIsMultipleUses(e);
            }}
          />
        </div>
      </div>

      {updateHomepageDiscountCode && (
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
              // disabled={isUpdatingStoreConfig || isLeaveAReviewDiscountCode}
              checked={isHomepageDiscountCode}
              onCheckedChange={updateHomepageDiscountCode}
            />
          </div>
        </div>
      )}

      {updateLeaveAReviewDiscountCode && (
        <div className="flex items-center gap-8 border rounded-lg p-4 w-fit">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label
                className="text-muted-foreground"
                htmlFor="leave-a-review-discount"
              >
                Use as leave a review discount code
              </Label>
            </div>
            <Switch
              id="leave-a-review-discount"
              // disabled={isUpdatingStoreConfig || isHomepageDiscountCode}
              checked={isLeaveAReviewDiscountCode}
              onCheckedChange={updateLeaveAReviewDiscountCode}
            />
          </div>
        </div>
      )}

      {promoCodeSpan === "selected-products" && (
        <div className="pt-8">
          <p className="text-sm">Select products</p>
          <Products products={products} />
        </div>
      )}
    </div>
  );
};

export default PromoCodeForm;
