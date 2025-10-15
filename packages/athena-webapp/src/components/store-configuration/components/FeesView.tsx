import { useEffect, useState } from "react";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../../View";
import { Input } from "../../ui/input";
import { LoadingButton } from "../../ui/loading-button";
import { Switch } from "../../ui/switch";
import { Label } from "../../ui/label";
import { useStoreConfigUpdate } from "../hooks/useStoreConfigUpdate";

export const FeesView = () => {
  const { activeStore } = useGetActiveStore();
  const { updateConfig, isUpdating } = useStoreConfigUpdate();

  const [enteredOtherRegionsFee, setEnteredOtherRegionsFee] = useState(0);
  const [enteredWithinAccraFee, setEnteredWithinAccraFee] = useState(0);
  const [enteredIntlFee, setEnteredIntlFee] = useState(0);

  // Replace the single waiveDeliveryFees with separate states for each fee type
  const [waiveWithinAccraFee, setWaiveWithinAccraFee] = useState(false);
  const [waiveOtherRegionsFee, setWaiveOtherRegionsFee] = useState(false);
  const [waiveIntlFee, setWaiveIntlFee] = useState(false);

  const handleUpdateFees = async () => {
    const updates = {
      withinAccra: enteredWithinAccraFee,
      otherRegions: enteredOtherRegionsFee,
      international: enteredIntlFee,
    };

    // Create a new waiveDeliveryFees object with granular control
    const waiveDeliveryFeesConfig = {
      withinAccra: waiveWithinAccraFee,
      otherRegions: waiveOtherRegionsFee,
      international: waiveIntlFee,
      // Keep a global flag for backward compatibility
      all: waiveWithinAccraFee && waiveOtherRegionsFee && waiveIntlFee,
    };

    await updateConfig({
      storeId: activeStore?._id!,
      config: {
        ...activeStore?.config,
        deliveryFees: updates,
        waiveDeliveryFees: waiveDeliveryFeesConfig,
      },
      successMessage: "Delivery fees updated",
      errorMessage: "An error occurred while updating delivery fees",
    });
  };

  useEffect(() => {
    // Sync state with store data when `activeStore` changes
    setEnteredWithinAccraFee(
      activeStore?.config?.deliveryFees?.withinAccra || undefined
    );
    setEnteredOtherRegionsFee(
      activeStore?.config?.deliveryFees?.otherRegions || undefined
    );
    setEnteredIntlFee(activeStore?.config?.deliveryFees?.international || 0);

    // Handle both old boolean format and new object format for backward compatibility
    const waiveConfig = activeStore?.config?.waiveDeliveryFees;
    if (typeof waiveConfig === "boolean") {
      // Old format - single boolean
      setWaiveWithinAccraFee(waiveConfig);
      setWaiveOtherRegionsFee(waiveConfig);
      setWaiveIntlFee(waiveConfig);
    } else if (waiveConfig && typeof waiveConfig === "object") {
      // New format - object with properties
      setWaiveWithinAccraFee(waiveConfig.withinAccra || false);
      setWaiveOtherRegionsFee(waiveConfig.otherRegions || false);
      setWaiveIntlFee(waiveConfig.international || false);
    } else {
      // Default all to false
      setWaiveWithinAccraFee(false);
      setWaiveOtherRegionsFee(false);
      setWaiveIntlFee(false);
    }
  }, [activeStore]);

  // Function to check if all fees are being waived
  const areAllFeesWaived =
    waiveWithinAccraFee && waiveOtherRegionsFee && waiveIntlFee;

  // Function to toggle all fees at once
  const handleToggleAllFees = (checked: boolean) => {
    setWaiveWithinAccraFee(checked);
    setWaiveOtherRegionsFee(checked);
    setWaiveIntlFee(checked);
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={
        <p className="text-sm text-muted-foreground">{`Delivery fees (${activeStore?.currency.toUpperCase()})`}</p>
      }
    >
      <div className="container mx-auto h-full py-8 grid grid-cols-2 gap-4">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              Within Greater Accra
            </p>
            <div className="flex items-center gap-2">
              <Switch
                id="waive-within-accra-fees"
                checked={waiveWithinAccraFee}
                onCheckedChange={setWaiveWithinAccraFee}
              />
              <Label
                className="text-xs text-muted-foreground"
                htmlFor="waive-within-accra-fees"
              >
                Waive
              </Label>
            </div>
          </div>
          <Input
            type="number"
            value={enteredWithinAccraFee || undefined}
            onChange={(e) => setEnteredWithinAccraFee(parseInt(e.target.value))}
            disabled={waiveWithinAccraFee}
          />
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">To other regions</p>
            <div className="flex items-center gap-2">
              <Switch
                id="waive-other-regions-fees"
                checked={waiveOtherRegionsFee}
                onCheckedChange={setWaiveOtherRegionsFee}
              />
              <Label
                className="text-xs text-muted-foreground"
                htmlFor="waive-other-regions-fees"
              >
                Waive
              </Label>
            </div>
          </div>
          <Input
            type="number"
            value={enteredOtherRegionsFee || undefined}
            onChange={(e) =>
              setEnteredOtherRegionsFee(parseInt(e.target.value))
            }
            disabled={waiveOtherRegionsFee}
          />
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">International</p>
            <div className="flex items-center gap-2">
              <Switch
                id="waive-intl-fees"
                checked={waiveIntlFee}
                onCheckedChange={setWaiveIntlFee}
              />
              <Label
                className="text-xs text-muted-foreground"
                htmlFor="waive-intl-fees"
              >
                Waive
              </Label>
            </div>
          </div>
          <Input
            type="number"
            value={enteredIntlFee || undefined}
            onChange={(e) => setEnteredIntlFee(parseInt(e.target.value))}
            disabled={waiveIntlFee}
          />
        </div>
      </div>

      <div className="container mx-auto py-4">
        <div className="flex items-center gap-2">
          <Switch
            id="waive-all-delivery-fees"
            checked={areAllFeesWaived}
            onCheckedChange={handleToggleAllFees}
          />
          <Label
            className="text-muted-foreground"
            htmlFor="waive-all-delivery-fees"
          >
            Waive all delivery fees
          </Label>
        </div>
        {areAllFeesWaived && (
          <p className="text-xs text-muted-foreground mt-2">
            When enabled, customers will not be charged for delivery regardless
            of location.
          </p>
        )}
      </div>

      <div className="w-full flex pr-8">
        <LoadingButton
          className="ml-auto"
          isLoading={isUpdating}
          onClick={handleUpdateFees}
        >
          Save
        </LoadingButton>
      </div>
    </View>
  );
};
