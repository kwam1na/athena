import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../../View";
import { Input } from "../../ui/input";
import { LoadingButton } from "../../ui/loading-button";
import { Switch } from "../../ui/switch";
import { Label } from "../../ui/label";
import { useStoreConfigUpdate } from "../hooks/useStoreConfigUpdate";

export const TaxView = () => {
  const { activeStore } = useGetActiveStore();
  const { updateConfig, isUpdating } = useStoreConfigUpdate();

  const [taxRate, setTaxRate] = useState(0);
  const [taxName, setTaxName] = useState("");
  const [enableTax, setEnableTax] = useState(false);
  const [includeTaxInPrice, setIncludeTaxInPrice] = useState(false);

  const handleUpdateTaxSettings = async () => {
    const taxConfig = {
      enabled: enableTax,
      rate: taxRate,
      name: taxName.trim() || "Tax",
      includedInPrice: includeTaxInPrice,
    };

    await updateConfig({
      storeId: activeStore?._id!,
      config: {
        ...activeStore?.config,
        tax: taxConfig,
      },
      successMessage: "Tax settings updated",
      errorMessage: "An error occurred while updating tax settings",
    });
  };

  useEffect(() => {
    // Sync state with store data when `activeStore` changes
    const taxConfig = activeStore?.config?.tax;
    setEnableTax(taxConfig?.enabled || false);
    setTaxRate(taxConfig?.rate || 0);
    setTaxName(taxConfig?.name || "");
    setIncludeTaxInPrice(taxConfig?.includedInPrice || false);
  }, [activeStore]);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={<p className="text-sm text-muted-foreground">Tax Settings</p>}
    >
      <div className="container mx-auto h-full py-8 space-y-6">
        {/* Enable Tax Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-muted-foreground" />
            <Label className="text-muted-foreground" htmlFor="enable-tax">
              Enable Tax
            </Label>
          </div>
          <Switch
            id="enable-tax"
            checked={enableTax}
            onCheckedChange={setEnableTax}
          />
        </div>

        {enableTax && (
          <>
            {/* Tax Name */}
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Tax Name</p>
              <Input
                placeholder="e.g., VAT, Sales Tax, GST"
                value={taxName}
                onChange={(e) => setTaxName(e.target.value)}
              />
            </div>

            {/* Tax Rate */}
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Tax Rate (%)</p>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="0.00"
                value={taxRate || ""}
                onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                Enter the tax rate as a percentage (e.g., 15 for 15%)
              </p>
            </div>

            {/* Include Tax in Price */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-muted-foreground" htmlFor="include-tax">
                  Include tax in product prices
                </Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, tax is included in the displayed price. When
                  disabled, tax is added at checkout.
                </p>
              </div>
              <Switch
                id="include-tax"
                checked={includeTaxInPrice}
                onCheckedChange={setIncludeTaxInPrice}
              />
            </div>
          </>
        )}
      </div>

      <div className="w-full flex pr-8">
        <LoadingButton
          className="ml-auto"
          isLoading={isUpdating}
          onClick={handleUpdateTaxSettings}
        >
          Save
        </LoadingButton>
      </div>
    </View>
  );
};
