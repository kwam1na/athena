import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../View";
import { Input } from "../ui/input";
import { LoadingButton } from "../ui/loading-button";
import { Switch } from "../ui/switch";
import { Label } from "../ui/label";
import { set } from "zod";
import { Construction, Disc2, EyeClosed, EyeIcon, Receipt } from "lucide-react";
import { EyeOpenIcon } from "@radix-ui/react-icons";

const Header = () => {
  return (
    <div className="container mx-auto flex gap-2 h-[40px] items-center justify-between">
      <p className="text-xl font-medium">Store configuration</p>
    </div>
  );
};

const FeesView = () => {
  const { activeStore } = useGetActiveStore();

  const [isUpdatingFees, setIsUpdatingFees] = useState(false);

  const [enteredOtherRegionsFee, setEnteredOtherRegionsFee] = useState(0);
  const [enteredWithinAccraFee, setEnteredWithinAccraFee] = useState(0);
  const [enteredIntlFee, setEnteredIntlFee] = useState(0);

  // Replace the single waiveDeliveryFees with separate states for each fee type
  const [waiveWithinAccraFee, setWaiveWithinAccraFee] = useState(false);
  const [waiveOtherRegionsFee, setWaiveOtherRegionsFee] = useState(false);
  const [waiveIntlFee, setWaiveIntlFee] = useState(false);

  const updateFees = useMutation(api.inventory.stores.updateConfig);

  const handleUpdateFees = async () => {
    setIsUpdatingFees(true);

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

    try {
      await updateFees({
        id: activeStore?._id!,
        config: {
          ...activeStore?.config,
          deliveryFees: updates,
          waiveDeliveryFees: waiveDeliveryFeesConfig,
        },
      });
      toast.success("Delivery fees updated", { position: "top-right" });
    } catch (error) {
      console.log(error);
      toast.error("An error occurred while updating delivery fees", {
        description: (error as Error).message,
        position: "top-right",
      });
    }

    setIsUpdatingFees(false);
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
          isLoading={isUpdatingFees}
          onClick={handleUpdateFees}
        >
          Save
        </LoadingButton>
      </div>
    </View>
  );
};

const ContactView = () => {
  const { activeStore } = useGetActiveStore();

  const [isUpdatingContactInfo, setIsUpdatingContactInfo] = useState(false);

  const [enteredPhoneNumber, setEnteredPhoneNumber] = useState(
    activeStore?.config?.contactInfo?.phoneNumber || ""
  );
  const [enteredLocation, setEnteredLocation] = useState(
    activeStore?.config?.contactInfo?.location || ""
  );

  const updateContactInfo = useMutation(api.inventory.stores.updateConfig);

  const handleUpdateContactInfo = async () => {
    setIsUpdatingContactInfo(true);

    const updates = {
      phoneNumber: enteredPhoneNumber,
      location: enteredLocation,
    };

    try {
      await updateContactInfo({
        id: activeStore?._id!,
        config: {
          ...activeStore?.config,
          contactInfo: updates,
        },
      });
      toast.success("Contact information updated", { position: "top-right" });
    } catch (error) {
      console.log(error);
      toast.error("An error occurred while updating contact information", {
        description: (error as Error).message,
        position: "top-right",
      });
    }

    setIsUpdatingContactInfo(false);
  };

  useEffect(() => {
    // Sync state with store data when `activeStore` changes
    setEnteredPhoneNumber(activeStore?.config?.contactInfo?.phoneNumber || "");
    setEnteredLocation(activeStore?.config?.contactInfo?.location || "");
  }, [activeStore]);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={
        <p className="text-sm text-muted-foreground">Contact Information</p>
      }
    >
      <div className="container mx-auto h-full py-8 grid grid-cols-1 gap-4">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Phone number</p>
          <Input
            value={enteredPhoneNumber || undefined}
            onChange={(e) => setEnteredPhoneNumber(e.target.value)}
          />
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Location</p>
          <Input
            value={enteredLocation || undefined}
            onChange={(e) => setEnteredLocation(e.target.value)}
          />
        </div>
      </div>

      <div className="w-full flex pr-8">
        <LoadingButton
          className="ml-auto"
          isLoading={isUpdatingContactInfo}
          onClick={handleUpdateContactInfo}
        >
          Save
        </LoadingButton>
      </div>
    </View>
  );
};

const TaxView = () => {
  const { activeStore } = useGetActiveStore();

  const [isUpdatingTaxSettings, setIsUpdatingTaxSettings] = useState(false);

  const [taxRate, setTaxRate] = useState(0);
  const [taxName, setTaxName] = useState("");
  const [enableTax, setEnableTax] = useState(false);
  const [includeTaxInPrice, setIncludeTaxInPrice] = useState(false);

  const updateTaxSettings = useMutation(api.inventory.stores.updateConfig);

  const handleUpdateTaxSettings = async () => {
    setIsUpdatingTaxSettings(true);

    const taxConfig = {
      enabled: enableTax,
      rate: taxRate,
      name: taxName.trim() || "Tax",
      includedInPrice: includeTaxInPrice,
    };

    try {
      await updateTaxSettings({
        id: activeStore?._id!,
        config: {
          ...activeStore?.config,
          tax: taxConfig,
        },
      });
      toast.success("Tax settings updated", { position: "top-right" });
    } catch (error) {
      console.log(error);
      toast.error("An error occurred while updating tax settings", {
        description: (error as Error).message,
        position: "top-right",
      });
    }

    setIsUpdatingTaxSettings(false);
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
          isLoading={isUpdatingTaxSettings}
          onClick={handleUpdateTaxSettings}
        >
          Save
        </LoadingButton>
      </div>
    </View>
  );
};

const MaintenanceView = () => {
  const { activeStore } = useGetActiveStore();

  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);

  const [isInMaintenanceMode, setIsInMaintenanceMode] = useState(false);

  const [isInReadOnlyMode, setIsInReadOnlyMode] = useState(false);

  const updateConfig = useMutation(api.inventory.stores.updateConfig);

  const saveMaintenanceModeChanges = async (toggled: boolean) => {
    setIsUpdatingConfig(true);
    setIsInMaintenanceMode(toggled);

    const updates = {
      inMaintenanceMode: toggled,
    };

    try {
      await updateConfig({
        id: activeStore?._id!,
        config: {
          ...activeStore?.config,
          availability: updates,
        },
      });
      const message = toggled
        ? "Store set to maintenance mode"
        : "Store set to live";

      const icon = toggled ? (
        <Construction className="w-4 h-4" />
      ) : (
        <Disc2 className="w-4 h-4" />
      );
      toast.message(message, { icon });
    } catch (error) {
      console.log(error);
      toast.error("An error occurred while updating store availability", {
        description: (error as Error).message,
        position: "top-right",
      });
    }

    setIsUpdatingConfig(false);
  };

  const saveReadOnlyeModeChanges = async (toggled: boolean) => {
    setIsUpdatingConfig(true);
    setIsInReadOnlyMode(toggled);

    const updates = {
      inReadOnlyMode: toggled,
    };

    try {
      await updateConfig({
        id: activeStore?._id!,
        config: {
          ...activeStore?.config,
          visibility: updates,
        },
      });
      const message = toggled
        ? "Store set to view-only mode"
        : "Store set to full access";

      const icon = toggled ? (
        <EyeIcon className="w-4 h-4" />
      ) : (
        <Disc2 className="w-4 h-4" />
      );
      toast.message(message, { icon });
    } catch (error) {
      console.log(error);
      toast.error("An error occurred while updating store visibility", {
        description: (error as Error).message,
        position: "top-right",
      });
    }

    setIsUpdatingConfig(false);
  };

  useEffect(() => {
    setIsInMaintenanceMode(
      activeStore?.config?.availability?.inMaintenanceMode || false
    );

    setIsInReadOnlyMode(
      activeStore?.config?.visibility?.inReadOnlyMode || false
    );
  }, [activeStore?.config?.availability, activeStore?.config?.visibility]);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={
        <p className="text-sm text-muted-foreground">{`Store availability`}</p>
      }
    >
      <div className="container mx-auto h-full py-8 grid grid-cols-1 gap-8">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <Construction className="w-4 h-4 text-muted-foreground" />
            <Label className="text-muted-foreground" htmlFor="custom">
              Maintenance mode
            </Label>
          </div>
          <Switch
            id="custom"
            disabled={isUpdatingConfig}
            checked={isInMaintenanceMode}
            onCheckedChange={(e) => {
              saveMaintenanceModeChanges(e);
            }}
          />
        </div>

        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <EyeIcon className="w-4 h-4 text-muted-foreground" />
            <Label className="text-muted-foreground" htmlFor="custom">
              View-only mode
            </Label>
          </div>
          <Switch
            id="custom"
            disabled={isUpdatingConfig}
            checked={isInReadOnlyMode}
            onCheckedChange={(e) => {
              saveReadOnlyeModeChanges(e);
            }}
          />
        </div>
      </div>
    </View>
  );
};

export const StoreConfiguration = () => {
  return (
    <View hideBorder hideHeaderBottomBorder header={<Header />}>
      <div className="container mx-auto h-full w-full py-8 grid grid-cols-2 gap-40">
        <FeesView />
        <ContactView />

        <TaxView />
        <MaintenanceView />
      </div>
    </View>
  );
};
