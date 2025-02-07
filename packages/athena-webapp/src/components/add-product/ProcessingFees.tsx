import { Label } from "../ui/label";
import View from "../View";
import { Switch } from "../ui/switch";
import { useProduct } from "~/src/contexts/ProductContext";
import { useGetCurrencyFormatter } from "~/src/hooks/useGetCurrencyFormatter";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { PAYSTACK_PROCESSING_FEE } from "~/src/lib/constants";

export function ProcessingFeesView() {
  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto"
      header={<p className="text-sm text-sm"></p>}
    >
      <ProcessingFees />
    </View>
  );
}

function ProcessingFees() {
  const { productData, updateProductData, activeProductVariant } = useProduct();

  const { activeStore } = useGetActiveStore();

  const formatter = useGetCurrencyFormatter();

  if (!activeProductVariant) return null;

  const fees =
    ((activeProductVariant.netPrice || 0) * PAYSTACK_PROCESSING_FEE) / 100;

  const fullPrice = (activeProductVariant.netPrice || 0) + fees;

  const fullPriceMinusFees = (activeProductVariant.netPrice || 0) - fees;

  return (
    <div className="flex">
      <div className="flex flex-col gap-16 pt-8 py-4 pl-8">
        <div className="flex items-center gap-16">
          <div>
            <Label htmlFor="fees-toggle">Absorb processing fees</Label>
            <p className="text-sm text-muted-foreground">
              Paystack charges a {PAYSTACK_PROCESSING_FEE}% fee
            </p>
          </div>
          <Switch
            id="fees-toggle"
            checked={productData.areProcessingFeesAbsorbed}
            onCheckedChange={(checked) => {
              updateProductData({
                areProcessingFeesAbsorbed: checked,
              });
            }}
          />
        </div>

        {!productData.areProcessingFeesAbsorbed &&
          Boolean(activeProductVariant.netPrice) && (
            <div className="space-y-8">
              {activeProductVariant.sku && (
                <p className="text-sm">
                  e.g. for product <strong>{activeProductVariant.sku}</strong>,
                  customers pay
                </p>
              )}

              {!activeProductVariant.sku && (
                <p className="text-sm">
                  e.g. for the selected variant, customers pay
                </p>
              )}

              <div className="flex items-center gap-8">
                <div>
                  <p>{formatter.format(activeProductVariant.netPrice || 0)}</p>
                  <p className="text-xs text-muted-foreground">Price</p>
                </div>

                <p>+</p>

                <div>
                  <p>{formatter.format(fees)}</p>
                  <p className="text-xs text-muted-foreground">
                    {PAYSTACK_PROCESSING_FEE}% fee
                  </p>
                </div>

                <p>=</p>

                <strong>{formatter.format(fullPrice)}</strong>
              </div>
            </div>
          )}

        {productData.areProcessingFeesAbsorbed &&
          Boolean(activeProductVariant.netPrice) && (
            <div className="space-y-8">
              {activeProductVariant.sku && (
                <p className="text-sm">
                  e.g. for product <strong>{activeProductVariant.sku}</strong>,{" "}
                  {activeStore?.name} receives
                </p>
              )}

              {!activeProductVariant.sku && (
                <p className="text-sm">
                  e.g. for the selected variant, {activeStore?.name} receives
                </p>
              )}

              <div className="flex items-center gap-8">
                <div>
                  <p>{formatter.format(activeProductVariant.netPrice || 0)}</p>
                  <p className="text-xs text-muted-foreground">Price</p>
                </div>

                <p>-</p>

                <div>
                  <p>{formatter.format(fees)}</p>
                  <p className="text-xs text-muted-foreground">
                    {PAYSTACK_PROCESSING_FEE}% fee
                  </p>
                </div>

                <p>=</p>

                <strong>{formatter.format(fullPriceMinusFees)}</strong>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
