import { useEffect, useMemo, useState } from "react";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../../View";
import { Input } from "../../ui/input";
import { LoadingButton } from "../../ui/loading-button";
import { Switch } from "../../ui/switch";
import { Label } from "../../ui/label";
import { useStoreConfigUpdate } from "../hooks/useStoreConfigUpdate";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";
import { toPesewas, toDisplayAmount } from "~/convex/lib/currency";

export const FeesView = () => {
  const { activeStore } = useGetActiveStore();
  const { updateConfig, isUpdating } = useStoreConfigUpdate();
  const storeConfig = useMemo(
    () => getStoreConfigV2(activeStore),
    [activeStore?.config],
  );

  const [enteredOtherRegionsFee, setEnteredOtherRegionsFee] = useState<
    number | undefined
  >(0);
  const [enteredWithinAccraFee, setEnteredWithinAccraFee] = useState<
    number | undefined
  >(0);
  const [enteredIntlFee, setEnteredIntlFee] = useState<number | undefined>(0);

  // Replace the single waiveDeliveryFees with separate states for each fee type
  const [waiveWithinAccraFee, setWaiveWithinAccraFee] = useState(false);
  const [waiveOtherRegionsFee, setWaiveOtherRegionsFee] = useState(false);
  const [waiveIntlFee, setWaiveIntlFee] = useState(false);
  const [minimumOrderAmount, setMinimumOrderAmount] = useState<
    number | undefined
  >(undefined);

  const handleUpdateFees = async () => {
    const updates = {
      withinAccra:
        enteredWithinAccraFee === undefined
          ? undefined
          : toPesewas(enteredWithinAccraFee),
      otherRegions:
        enteredOtherRegionsFee === undefined
          ? undefined
          : toPesewas(enteredOtherRegionsFee),
      international:
        enteredIntlFee === undefined ? undefined : toPesewas(enteredIntlFee),
    };

    const waiveDeliveryFeesConfig = {
      withinAccra: waiveWithinAccraFee,
      otherRegions: waiveOtherRegionsFee,
      international: waiveIntlFee,
      all: waiveWithinAccraFee && waiveOtherRegionsFee && waiveIntlFee,
      minimumOrderAmount:
        minimumOrderAmount === undefined
          ? undefined
          : toPesewas(minimumOrderAmount),
    };

    await updateConfig({
      storeId: activeStore?._id!,
      patch: {
        commerce: {
          deliveryFees: updates,
          waiveDeliveryFees: waiveDeliveryFeesConfig,
        },
      },
      successMessage: "Delivery fees updated",
      errorMessage: "An error occurred while updating delivery fees",
    });
  };

  useEffect(() => {
    // Sync state with store data when `activeStore` changes
    // Convert from pesewas (stored) to GHS (displayed in form)
    const fees = storeConfig.commerce.deliveryFees;
    setEnteredWithinAccraFee(
      fees?.withinAccra === undefined
        ? undefined
        : toDisplayAmount(fees.withinAccra)
    );
    setEnteredOtherRegionsFee(
      fees?.otherRegions === undefined
        ? undefined
        : toDisplayAmount(fees.otherRegions)
    );
    setEnteredIntlFee(
      fees?.international === undefined
        ? undefined
        : toDisplayAmount(fees.international)
    );

    const waiveConfig = storeConfig.commerce.waiveDeliveryFees;
    if (waiveConfig && typeof waiveConfig === "object") {
      setWaiveWithinAccraFee(waiveConfig.withinAccra || false);
      setWaiveOtherRegionsFee(waiveConfig.otherRegions || false);
      setWaiveIntlFee(waiveConfig.international || false);
      setMinimumOrderAmount(
        waiveConfig.minimumOrderAmount === undefined
          ? undefined
          : toDisplayAmount(waiveConfig.minimumOrderAmount)
      );
    } else {
      setWaiveWithinAccraFee(false);
      setWaiveOtherRegionsFee(false);
      setWaiveIntlFee(false);
      setMinimumOrderAmount(undefined);
    }
  }, [storeConfig]);

  // Function to check if all fees are being waived
  const areAllFeesWaived =
    waiveWithinAccraFee && waiveOtherRegionsFee && waiveIntlFee;

  const isAnyWaiverActive =
    waiveWithinAccraFee || waiveOtherRegionsFee || waiveIntlFee;

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
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full"
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
            value={enteredWithinAccraFee ?? ""}
            onChange={(e) =>
              setEnteredWithinAccraFee(
                e.target.value ? Number.parseFloat(e.target.value) : undefined
              )
            }
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
            value={enteredOtherRegionsFee ?? ""}
            onChange={(e) =>
              setEnteredOtherRegionsFee(
                e.target.value ? Number.parseFloat(e.target.value) : undefined
              )
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
            value={enteredIntlFee ?? ""}
            onChange={(e) =>
              setEnteredIntlFee(
                e.target.value ? Number.parseFloat(e.target.value) : undefined
              )
            }
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

      {isAnyWaiverActive && (
        <div className="container mx-auto py-4 space-y-2">
          <Label
            className="text-sm text-muted-foreground"
            htmlFor="minimum-order-amount"
          >
            Minimum order amount for free delivery (
            {activeStore?.currency.toUpperCase()})
          </Label>
          <Input
            id="minimum-order-amount"
            type="number"
            placeholder="Leave empty for unconditional free delivery"
            value={minimumOrderAmount ?? ""}
            onChange={(e) => {
              const val = Number.parseFloat(e.target.value);
              setMinimumOrderAmount(
                Number.isNaN(val) || val <= 0 ? undefined : val
              );
            }}
          />
          <p className="text-xs text-muted-foreground">
            Leave empty for unconditional free delivery
          </p>
        </div>
      )}

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
