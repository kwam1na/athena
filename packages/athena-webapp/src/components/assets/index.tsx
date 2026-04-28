import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../View";
import { Input } from "../ui/input";
import { LoadingButton } from "../ui/loading-button";
import { Switch } from "../ui/switch";
import { Label } from "../ui/label";
import { EmptyState } from "../states/empty/empty-state";
import { ArrowUp, Image, PlusIcon } from "lucide-react";
import { Button } from "../ui/button";
import { AssetsDataTable } from "./assets-table/data-table";
import { assetColumns } from "./assets-table/assetsColumns";
import { useImageUpload } from "~/src/hooks/use-image-upload";
import ImageUploader, { ImageFile } from "../ui/image-uploader";
import { convertImagesToWebp } from "~/src/lib/imageUtils";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";
import { presentUnexpectedErrorToast } from "~/src/lib/errors/presentUnexpectedErrorToast";

const Header = () => {
  return (
    <div className="container mx-auto flex gap-2 h-[40px] items-center justify-between">
      <p className="text-xl font-medium">Store assets</p>
    </div>
  );
};

const FeesView = () => {
  const { activeStore } = useGetActiveStore();
  const storeConfig = useMemo(
    () => getStoreConfigV2(activeStore),
    [activeStore?.config],
  );

  const [isUpdatingFees, setIsUpdatingFees] = useState(false);

  const [enteredOtherRegionsFee, setEnteredOtherRegionsFee] = useState<
    number | undefined
  >(0);
  const [enteredWithinAccraFee, setEnteredWithinAccraFee] = useState<
    number | undefined
  >(0);
  const [enteredIntlFee, setEnteredIntlFee] = useState<number | undefined>(0);

  const patchConfig = useMutation(api.inventory.stores.patchConfigV2);

  const handleUpdateFees = async () => {
    setIsUpdatingFees(true);

    const updates = {
      withinAccra: enteredWithinAccraFee,
      otherRegions: enteredOtherRegionsFee,
      international: enteredIntlFee,
    };

    try {
      await patchConfig({
        id: activeStore?._id!,
        patch: {
          commerce: {
            deliveryFees: updates,
          },
        },
      });
      toast.success("Delivery fees updated", { position: "top-right" });
    } catch (error) {
      console.log(error);
      presentUnexpectedErrorToast("An error occurred while updating delivery fees", {
        position: "top-right",
      });
    }

    setIsUpdatingFees(false);
  };

  useEffect(() => {
    // Sync state with store data when `activeStore` changes
    setEnteredWithinAccraFee(
      storeConfig.commerce.deliveryFees?.withinAccra || undefined
    );
    setEnteredOtherRegionsFee(
      storeConfig.commerce.deliveryFees?.otherRegions || undefined
    );
    setEnteredIntlFee(storeConfig.commerce.deliveryFees?.international || 0);
  }, [storeConfig]);

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
  const storeConfig = useMemo(
    () => getStoreConfigV2(activeStore),
    [activeStore?.config],
  );

  const [isUpdatingContactInfo, setIsUpdatingContactInfo] = useState(false);

  const [enteredPhoneNumber, setEnteredPhoneNumber] = useState(
    storeConfig.contact.phoneNumber || ""
  );
  const [enteredLocation, setEnteredLocation] = useState(
    storeConfig.contact.location || ""
  );

  const patchConfig = useMutation(api.inventory.stores.patchConfigV2);

  const handleUpdateContactInfo = async () => {
    setIsUpdatingContactInfo(true);

    const updates = {
      phoneNumber: enteredPhoneNumber,
      location: enteredLocation,
    };

    try {
      await patchConfig({
        id: activeStore?._id!,
        patch: {
          contact: updates,
        },
      });
      toast.success("Contact information updated", { position: "top-right" });
    } catch (error) {
      console.log(error);
      presentUnexpectedErrorToast(
        "An error occurred while updating contact information",
        {
        position: "top-right",
        },
      );
    }

    setIsUpdatingContactInfo(false);
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
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full"
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
  const storeConfig = useMemo(
    () => getStoreConfigV2(activeStore),
    [activeStore?.config],
  );

  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);

  const [isInMaintenanceMode, setIsInMaintenanceMode] = useState(false);

  const patchConfig = useMutation(api.inventory.stores.patchConfigV2);

  const saveChanges = async (toggled: boolean) => {
    setIsUpdatingConfig(true);
    setIsInMaintenanceMode(toggled);

    console.log("toggled ", toggled);

    const updates = {
      inMaintenanceMode: toggled,
    };

    try {
      await patchConfig({
        id: activeStore?._id!,
        patch: {
          operations: {
            availability: updates,
          },
        },
      });
      const message = toggled
        ? "Store set to maintenance mode"
        : "Store set to live";
      toast.success(message);
    } catch (error) {
      console.log(error);
      presentUnexpectedErrorToast(
        "An error occurred while updating store availability",
        {
        position: "top-right",
        },
      );
    }

    setIsUpdatingConfig(false);
  };

  useEffect(() => {
    console.log("updating maintenance mode in effect");
    console.log(storeConfig);
    setIsInMaintenanceMode(
      storeConfig.operations.availability.inMaintenanceMode || false
    );
  }, [storeConfig]);

  console.log("in maintenance mode: ", isInMaintenanceMode);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full"
      header={
        <p className="text-sm text-muted-foreground">{`Store availability`}</p>
      }
    >
      <div className="container mx-auto h-full py-8 grid grid-cols-2 gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id="custom"
            disabled={isUpdatingConfig}
            checked={isInMaintenanceMode}
            onCheckedChange={(e) => {
              saveChanges(e);
            }}
          />
          <Label className="text-muted-foreground" htmlFor="custom">
            Maintenance mode
          </Label>
        </div>
      </div>

      {/* <div className="w-full flex pr-8">
        <LoadingButton
          className="ml-auto"
          isLoading={isUpdatingConfig}
          onClick={saveChanges}
        >
          Save
        </LoadingButton>
      </div> */}
    </View>
  );
};

const EmptyStateContent = () => {
  const { activeStore } = useGetActiveStore();
  return (
    <EmptyState
      icon={<Image className="w-16 h-16 text-muted-foreground" />}
      title={
        <div className="flex gap-1 text-sm">
          <p className="text-muted-foreground">No assets for</p>
          <p className="font-medium">{activeStore?.name}</p>
        </div>
      }
      cta={
        <Button variant={"outline"}>
          <PlusIcon className="w-3 h-3 mr-2" />
          Add asset
        </Button>
      }
    />
  );
};

export const StoreAssets = () => {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const uploadStoreAssets = useAction(api.inventory.stores.uploadImageAssets);

  const { activeStore } = useGetActiveStore();

  const imageAssets = useQuery(
    api.inventory.stores.getImageAssets,
    activeStore ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore) return null;

  const tableData = imageAssets?.map((asset) => ({ url: asset.url }));

  const handleUpload = async () => {
    setIsUploading(true);
    const buffer = await convertImagesToWebp(images);
    try {
      await uploadStoreAssets({ images: buffer, storeId: activeStore._id });
      toast.success("Images uploaded successfully");
      setImages([]);
    } catch (error) {
      console.log(error);
      presentUnexpectedErrorToast("An error occurred while uploading images");
    } finally {
      setIsUploading(false);
    }
  };

  const hasAssets = tableData && tableData.length > 0;

  return (
    <View hideBorder hideHeaderBottomBorder header={<Header />}>
      <div className="container mx-auto space-y-8">
        {/* <EmptyStateContent /> */}
        <div className="w-[50%]">
          <ImageUploader images={images} updateImages={setImages} />
          {images.length > 0 && (
            <LoadingButton
              isLoading={isUploading}
              variant={"outline"}
              onClick={handleUpload}
            >
              <ArrowUp className="w-3 h-3 mr-2" />
              Upload
            </LoadingButton>
          )}
        </div>
        {hasAssets && (
          <AssetsDataTable data={tableData || []} columns={assetColumns} />
        )}
      </div>
    </View>
  );
};
