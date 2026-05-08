import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../View";
import { LoadingButton } from "../ui/loading-button";
import { ArrowUp } from "lucide-react";
import { AssetsDataTable } from "./assets-table/data-table";
import { assetColumns } from "./assets-table/assetsColumns";
import ImageUploader, { ImageFile } from "../ui/image-uploader";
import { convertImagesToWebp } from "~/src/lib/imageUtils";
import { presentUnexpectedErrorToast } from "~/src/lib/errors/presentUnexpectedErrorToast";

const Header = () => {
  return (
    <div className="container mx-auto flex gap-2 h-[40px] items-center justify-between">
      <p className="text-xl font-medium">Store assets</p>
    </div>
  );
};

export const StoreAssets = () => {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const uploadStoreAssets = useAction(api.inventory.stores.uploadImageAssets);

  const { activeStore } = useGetActiveStore();

  const imageAssets = useQuery(
    api.inventory.stores.getImageAssets,
    activeStore ? { storeId: activeStore._id } : "skip",
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
