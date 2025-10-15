import { useEffect, useState } from "react";
import { StoreIcon, Truck } from "lucide-react";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../../View";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import { Button } from "../../ui/button";

export const FulfillmentView = () => {
  const { activeStore } = useGetActiveStore();

  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
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

  const updateConfig = useMutation(api.inventory.stores.updateConfig);

  const saveEnableStorePickupChanges = async (toggled: boolean) => {
    setIsUpdatingConfig(true);
    setEnableStorePickup(toggled);

    const updates = {
      ...activeStore?.config?.fulfillment,
      enableStorePickup: toggled,
    };

    try {
      await updateConfig({
        id: activeStore?._id!,
        config: {
          ...activeStore?.config,
          fulfillment: updates,
        },
      });
      const message = toggled
        ? "Store pickup has been enabled"
        : "Store pickup has been disabled";

      const icon = <StoreIcon className="w-4 h-4" />;
      toast.message(message, { icon });
    } catch (error) {
      console.log(error);
      toast.error("An error occurred while updating pickup settings", {
        description: (error as Error).message,
        position: "top-right",
      });
    }

    setIsUpdatingConfig(false);
  };

  const saveEnableDeliveryChanges = async (toggled: boolean) => {
    setIsUpdatingConfig(true);
    setEnableDelivery(toggled);

    const updates = {
      ...activeStore?.config?.fulfillment,
      enableDelivery: toggled,
    };

    try {
      await updateConfig({
        id: activeStore?._id!,
        config: {
          ...activeStore?.config,
          fulfillment: updates,
        },
      });
      const message = toggled
        ? "Delivery has been enabled"
        : "Delivery has been disabled";

      const icon = <Truck className="w-4 h-4" />;
      toast.message(message, { icon });
    } catch (error) {
      console.log(error);
      toast.error("An error occurred while updating delivery settings", {
        description: (error as Error).message,
        position: "top-right",
      });
    }

    setIsUpdatingConfig(false);
  };

  const savePickupRestriction = async (updates: any) => {
    setIsUpdatingConfig(true);

    try {
      await updateConfig({
        id: activeStore?._id!,
        config: {
          ...activeStore?.config,
          fulfillment: {
            ...activeStore?.config?.fulfillment,
            pickupRestriction: updates,
          },
        },
      });
      toast.success("Pickup restriction updated");
    } catch (error) {
      console.log(error);
      toast.error("An error occurred while updating pickup restriction", {
        description: (error as Error).message,
      });
    }

    setIsUpdatingConfig(false);
  };

  const saveDeliveryRestriction = async (updates: any) => {
    setIsUpdatingConfig(true);

    try {
      await updateConfig({
        id: activeStore?._id!,
        config: {
          ...activeStore?.config,
          fulfillment: {
            ...activeStore?.config?.fulfillment,
            deliveryRestriction: updates,
          },
        },
      });
      toast.success("Delivery restriction updated");
    } catch (error) {
      console.log(error);
      toast.error("An error occurred while updating delivery restriction", {
        description: (error as Error).message,
      });
    }

    setIsUpdatingConfig(false);
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
        startTime: undefined,
        endTime: undefined,
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
          startTime: undefined,
          endTime: undefined,
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
        startTime: undefined,
        endTime: undefined,
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
          startTime: undefined,
          endTime: undefined,
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
      activeStore?.config?.fulfillment?.enableStorePickup ?? true
    );

    setEnableDelivery(activeStore?.config?.fulfillment?.enableDelivery ?? true);

    // Load restriction states
    const pickupRestriction =
      activeStore?.config?.fulfillment?.pickupRestriction;
    setPickupRestrictionActive(pickupRestriction?.isActive || false);
    setPickupRestrictionMessage(pickupRestriction?.message || "");
    setPickupRestrictionReason(pickupRestriction?.reason || "");
    setPickupHasUnsavedChanges(false);

    const deliveryRestriction =
      activeStore?.config?.fulfillment?.deliveryRestriction;
    setDeliveryRestrictionActive(deliveryRestriction?.isActive || false);
    setDeliveryRestrictionMessage(deliveryRestriction?.message || "");
    setDeliveryRestrictionReason(deliveryRestriction?.reason || "");
    setDeliveryHasUnsavedChanges(false);
  }, [activeStore?.config?.fulfillment]);

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
