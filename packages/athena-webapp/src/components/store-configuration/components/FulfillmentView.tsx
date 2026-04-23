import { useEffect, useMemo, useState } from "react";
import { StoreIcon, Truck } from "lucide-react";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../../View";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import { Button } from "../../ui/button";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";
import { useStoreConfigUpdate } from "../hooks/useStoreConfigUpdate";

export const FulfillmentView = () => {
  const { activeStore } = useGetActiveStore();
  const storeConfig = useMemo(
    () => getStoreConfigV2(activeStore),
    [activeStore?.config],
  );

  const [enableStorePickup, setEnableStorePickup] = useState(true);
  const [enableDelivery, setEnableDelivery] = useState(true);

  // Temporary restriction states
  const [pickupRestrictionActive, setPickupRestrictionActive] = useState(false);
  const [pickupRestrictionMessage, setPickupRestrictionMessage] = useState("");
  const [pickupRestrictionReason, setPickupRestrictionReason] = useState("");
  const [pickupHasUnsavedChanges, setPickupHasUnsavedChanges] = useState(false);

  const [deliveryRestrictionActive, setDeliveryRestrictionActive] =
    useState(false);
  const [deliveryRestrictionMessage, setDeliveryRestrictionMessage] =
    useState("");
  const [deliveryRestrictionReason, setDeliveryRestrictionReason] =
    useState("");
  const [deliveryHasUnsavedChanges, setDeliveryHasUnsavedChanges] =
    useState(false);

  const { updateConfig, isUpdating: isUpdatingConfig } = useStoreConfigUpdate();

  const saveEnableStorePickupChanges = async (toggled: boolean) => {
    const previousValue = enableStorePickup;
    setEnableStorePickup(toggled);

    await updateConfig({
      storeId: activeStore?._id!,
      patch: {
        commerce: {
          fulfillment: {
            enableStorePickup: toggled,
          },
        },
      },
      successMessage: toggled
        ? "Store pickup has been enabled"
        : "Store pickup has been disabled",
      errorMessage: "An error occurred while updating pickup settings",
      onError: () => {
        setEnableStorePickup(previousValue);
      },
    });
  };

  const saveEnableDeliveryChanges = async (toggled: boolean) => {
    const previousValue = enableDelivery;
    setEnableDelivery(toggled);

    await updateConfig({
      storeId: activeStore?._id!,
      patch: {
        commerce: {
          fulfillment: {
            enableDelivery: toggled,
          },
        },
      },
      successMessage: toggled
        ? "Delivery has been enabled"
        : "Delivery has been disabled",
      errorMessage: "An error occurred while updating delivery settings",
      onError: () => {
        setEnableDelivery(previousValue);
      },
    });
  };

  const savePickupRestriction = async (updates: Record<string, any>) => {
    await updateConfig({
      storeId: activeStore?._id!,
      patch: {
        commerce: {
          fulfillment: {
            pickupRestriction: updates,
          },
        },
      },
      successMessage: "Pickup restriction updated",
      errorMessage: "An error occurred while updating pickup restriction",
    });
  };

  const saveDeliveryRestriction = async (updates: Record<string, any>) => {
    await updateConfig({
      storeId: activeStore?._id!,
      patch: {
        commerce: {
          fulfillment: {
            deliveryRestriction: updates,
          },
        },
      },
      successMessage: "Delivery restriction updated",
      errorMessage: "An error occurred while updating delivery restriction",
    });
  };

  const handlePickupRestrictionToggle = async (checked: boolean) => {
    setPickupRestrictionActive(checked);

    if (!checked) {
      // Clear everything when toggling off
      setPickupRestrictionMessage("");
      setPickupRestrictionReason("");
      setPickupHasUnsavedChanges(false);
      await savePickupRestriction({
        isActive: false,
        message: "",
        reason: "",
        startTime: null,
        endTime: null,
      });
    } else {
      // If turning on pickup restriction, turn off delivery restriction
      if (deliveryRestrictionActive) {
        setDeliveryRestrictionActive(false);
        setDeliveryRestrictionMessage("");
        setDeliveryRestrictionReason("");
        setDeliveryHasUnsavedChanges(false);
        await saveDeliveryRestriction({
          isActive: false,
          message: "",
          reason: "",
          startTime: null,
          endTime: null,
        });
      }

      await savePickupRestriction({
        isActive: true,
        message: pickupRestrictionMessage || "Temporarily unavailable",
        reason: pickupRestrictionReason,
      });
    }
  };

  const handleDeliveryRestrictionToggle = async (checked: boolean) => {
    setDeliveryRestrictionActive(checked);

    if (!checked) {
      // Clear everything when toggling off
      setDeliveryRestrictionMessage("");
      setDeliveryRestrictionReason("");
      setDeliveryHasUnsavedChanges(false);
      await saveDeliveryRestriction({
        isActive: false,
        message: "",
        reason: "",
        startTime: null,
        endTime: null,
      });
    } else {
      // If turning on delivery restriction, turn off pickup restriction
      if (pickupRestrictionActive) {
        setPickupRestrictionActive(false);
        setPickupRestrictionMessage("");
        setPickupRestrictionReason("");
        setPickupHasUnsavedChanges(false);
        await savePickupRestriction({
          isActive: false,
          message: "",
          reason: "",
          startTime: null,
          endTime: null,
        });
      }

      await saveDeliveryRestriction({
        isActive: true,
        message: deliveryRestrictionMessage || "Temporarily unavailable",
        reason: deliveryRestrictionReason,
      });
    }
  };

  const handleSavePickupRestriction = async () => {
    await savePickupRestriction({
      isActive: pickupRestrictionActive,
      message: pickupRestrictionMessage || "Temporarily unavailable",
      reason: pickupRestrictionReason,
    });
    setPickupHasUnsavedChanges(false);
  };

  const handleSaveDeliveryRestriction = async () => {
    await saveDeliveryRestriction({
      isActive: deliveryRestrictionActive,
      message: deliveryRestrictionMessage || "Temporarily unavailable",
      reason: deliveryRestrictionReason,
    });
    setDeliveryHasUnsavedChanges(false);
  };

  useEffect(() => {
    // Default to true if not set (for backward compatibility)
    setEnableStorePickup(
      storeConfig.commerce.fulfillment?.enableStorePickup ?? true
    );

    setEnableDelivery(storeConfig.commerce.fulfillment?.enableDelivery ?? true);

    // Load restriction states
    const pickupRestriction = storeConfig.commerce.fulfillment?.pickupRestriction;
    setPickupRestrictionActive(pickupRestriction?.isActive || false);
    setPickupRestrictionMessage(pickupRestriction?.message || "");
    setPickupRestrictionReason(pickupRestriction?.reason || "");
    setPickupHasUnsavedChanges(false);

    const deliveryRestriction =
      storeConfig.commerce.fulfillment?.deliveryRestriction;
    setDeliveryRestrictionActive(deliveryRestriction?.isActive || false);
    setDeliveryRestrictionMessage(deliveryRestriction?.message || "");
    setDeliveryRestrictionReason(deliveryRestriction?.reason || "");
    setDeliveryHasUnsavedChanges(false);
  }, [storeConfig]);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={
        <p className="text-sm text-muted-foreground">{`Fulfillment options`}</p>
      }
    >
      <div className="container mx-auto h-full py-8 space-y-6">
        <div className="grid grid-cols-1 gap-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StoreIcon className="w-4 h-4 text-muted-foreground" />
              <Label className="text-muted-foreground" htmlFor="enable-pickup">
                Enable store pickup
              </Label>
            </div>
            <Switch
              id="enable-pickup"
              disabled={isUpdatingConfig || !enableDelivery}
              checked={enableStorePickup}
              onCheckedChange={(e) => {
                saveEnableStorePickupChanges(e);
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-muted-foreground" />
              <Label
                className="text-muted-foreground"
                htmlFor="enable-delivery"
              >
                Enable delivery
              </Label>
            </div>
            <Switch
              id="enable-delivery"
              disabled={isUpdatingConfig || !enableStorePickup}
              checked={enableDelivery}
              onCheckedChange={(e) => {
                saveEnableDeliveryChanges(e);
              }}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          At least one fulfillment option must be enabled
        </p>

        {/* Temporary Restrictions Section */}
        <div className="space-y-6 mt-8 pt-8 border-t">
          <h3 className="text-sm font-medium text-muted-foreground">
            Temporary Restrictions
          </h3>

          {/* Pickup Restriction */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="restrict-pickup"
                className="text-muted-foreground"
              >
                Temporarily restrict pickup
              </Label>
              <Switch
                id="restrict-pickup"
                checked={pickupRestrictionActive}
                disabled={!enableStorePickup || isUpdatingConfig}
                onCheckedChange={handlePickupRestrictionToggle}
              />
            </div>

            {pickupRestrictionActive && (
              <div className="space-y-3 pl-6 border-l-2">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Message to customers
                  </Label>
                  <Input
                    placeholder="e.g., 'Closed for maintenance'"
                    value={pickupRestrictionMessage}
                    onChange={(e) => {
                      setPickupRestrictionMessage(e.target.value);
                      setPickupHasUnsavedChanges(true);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Internal note (not shown to customers)
                  </Label>
                  <Textarea
                    placeholder="Reason for restriction..."
                    value={pickupRestrictionReason}
                    onChange={(e) => {
                      setPickupRestrictionReason(e.target.value);
                      setPickupHasUnsavedChanges(true);
                    }}
                    className="min-h-[60px]"
                  />
                </div>

                {pickupHasUnsavedChanges && (
                  <Button
                    onClick={handleSavePickupRestriction}
                    disabled={isUpdatingConfig}
                    size="sm"
                  >
                    Save Changes
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Delivery Restriction */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="restrict-delivery"
                className="text-muted-foreground"
              >
                Temporarily restrict delivery
              </Label>
              <Switch
                id="restrict-delivery"
                checked={deliveryRestrictionActive}
                disabled={!enableDelivery || isUpdatingConfig}
                onCheckedChange={handleDeliveryRestrictionToggle}
              />
            </div>

            {deliveryRestrictionActive && (
              <div className="space-y-3 pl-6 border-l-2">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Message to customers
                  </Label>
                  <Input
                    placeholder="e.g., 'Delivery paused due to weather'"
                    value={deliveryRestrictionMessage}
                    onChange={(e) => {
                      setDeliveryRestrictionMessage(e.target.value);
                      setDeliveryHasUnsavedChanges(true);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Internal note (not shown to customers)
                  </Label>
                  <Textarea
                    placeholder="Reason for restriction..."
                    value={deliveryRestrictionReason}
                    onChange={(e) => {
                      setDeliveryRestrictionReason(e.target.value);
                      setDeliveryHasUnsavedChanges(true);
                    }}
                    className="min-h-[60px]"
                  />
                </div>

                {deliveryHasUnsavedChanges && (
                  <Button
                    onClick={handleSaveDeliveryRestriction}
                    disabled={isUpdatingConfig}
                    size="sm"
                  >
                    Save Changes
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </View>
  );
};
