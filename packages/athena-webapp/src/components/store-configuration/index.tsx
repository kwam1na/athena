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
import { Construction, Disc2 } from "lucide-react";

const Header = () => {
  return (
    <div className="container mx-auto flex gap-2 h-[40px] items-center justify-between">
      <p className="text-3xl font-medium">Store configuration</p>
    </div>
  );
};

const FeesView = () => {
  const { activeStore } = useGetActiveStore();

  const [isUpdatingFees, setIsUpdatingFees] = useState(false);

  const [enteredOtherRegionsFee, setEnteredOtherRegionsFee] = useState(0);
  const [enteredWithinAccraFee, setEnteredWithinAccraFee] = useState(0);
  const [enteredIntlFee, setEnteredIntlFee] = useState(0);

  const updateFees = useMutation(api.inventory.stores.updateConfig);

  const handleUpdateFees = async () => {
    setIsUpdatingFees(true);

    const updates = {
      withinAccra: enteredWithinAccraFee,
      otherRegions: enteredOtherRegionsFee,
      international: enteredIntlFee,
    };

    try {
      await updateFees({
        id: activeStore?._id!,
        config: {
          ...activeStore?.config,
          deliveryFees: updates,
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
  }, [activeStore]);

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
          <p className="text-sm text-muted-foreground">Within Greater Accra</p>
          <Input
            type="number"
            value={enteredWithinAccraFee || undefined}
            onChange={(e) => setEnteredWithinAccraFee(parseInt(e.target.value))}
          />
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">To other regions</p>
          <Input
            type="number"
            value={enteredOtherRegionsFee || undefined}
            onChange={(e) =>
              setEnteredOtherRegionsFee(parseInt(e.target.value))
            }
          />
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">International</p>
          <Input
            type="number"
            value={enteredIntlFee || undefined}
            onChange={(e) => setEnteredIntlFee(parseInt(e.target.value))}
          />
        </div>
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

const MaintenanceView = () => {
  const { activeStore } = useGetActiveStore();

  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);

  const [isInMaintenanceMode, setIsInMaintenanceMode] = useState(false);

  const updateConfig = useMutation(api.inventory.stores.updateConfig);

  const saveChanges = async (toggled: boolean) => {
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

  useEffect(() => {
    console.log("updating maintenance mode in effect");
    console.log(activeStore?.config);
    setIsInMaintenanceMode(
      activeStore?.config?.availability?.inMaintenanceMode || false
    );
  }, [activeStore?.config?.availability]);

  console.log("in maintenance mode: ", isInMaintenanceMode);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={
        <p className="text-sm text-muted-foreground">{`Store availability`}</p>
      }
    >
      <div className="container mx-auto h-full py-8 grid grid-cols-2 gap-4">
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
              saveChanges(e);
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

        <MaintenanceView />
      </div>
    </View>
  );
};
