import { useEffect, useState } from "react";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../../View";
import { Input } from "../../ui/input";
import { LoadingButton } from "../../ui/loading-button";
import { useStoreConfigUpdate } from "../hooks/useStoreConfigUpdate";

export const ContactView = () => {
  const { activeStore } = useGetActiveStore();
  const { updateConfig, isUpdating } = useStoreConfigUpdate();

  const [enteredPhoneNumber, setEnteredPhoneNumber] = useState(
    activeStore?.config?.contactInfo?.phoneNumber || ""
  );
  const [enteredLocation, setEnteredLocation] = useState(
    activeStore?.config?.contactInfo?.location || ""
  );

  const handleUpdateContactInfo = async () => {
    const updates = {
      phoneNumber: enteredPhoneNumber,
      location: enteredLocation,
    };

    await updateConfig({
      storeId: activeStore?._id!,
      config: {
        ...activeStore?.config,
        contactInfo: updates,
      },
      successMessage: "Contact information updated",
      errorMessage: "An error occurred while updating contact information",
    });
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
          isLoading={isUpdating}
          onClick={handleUpdateContactInfo}
        >
          Save
        </LoadingButton>
      </div>
    </View>
  );
};
