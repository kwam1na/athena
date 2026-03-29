import { useEffect, useMemo, useState } from "react";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../../View";
import { Input } from "../../ui/input";
import { LoadingButton } from "../../ui/loading-button";
import { useStoreConfigUpdate } from "../hooks/useStoreConfigUpdate";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";

export const ContactView = () => {
  const { activeStore } = useGetActiveStore();
  const { updateConfig, isUpdating } = useStoreConfigUpdate();
  const storeConfig = useMemo(
    () => getStoreConfigV2(activeStore),
    [activeStore?.config],
  );

  const [enteredPhoneNumber, setEnteredPhoneNumber] = useState(
    storeConfig.contact.phoneNumber || ""
  );
  const [enteredLocation, setEnteredLocation] = useState(
    storeConfig.contact.location || ""
  );

  const handleUpdateContactInfo = async () => {
    const updates = {
      phoneNumber: enteredPhoneNumber,
      location: enteredLocation,
    };

    await updateConfig({
      storeId: activeStore?._id!,
      patch: {
        contact: updates,
      },
      successMessage: "Contact information updated",
      errorMessage: "An error occurred while updating contact information",
    });
  };

  useEffect(() => {
    // Sync state with store data when `activeStore` changes
    setEnteredPhoneNumber(storeConfig.contact.phoneNumber || "");
    setEnteredLocation(storeConfig.contact.location || "");
  }, [storeConfig]);

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
