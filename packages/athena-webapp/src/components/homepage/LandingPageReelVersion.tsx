import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "~/convex/_generated/api";
import { toast } from "sonner";
import { LoadingButton } from "../ui/loading-button";
import { SelectNative } from "../ui/select-native";

export const LandingPageReelVersion = () => {
  const { activeStore } = useGetActiveStore();

  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);

  const [reelVersion, setReelVersion] = useState<string | null>();

  const [updatedReelVersion, setUpdatedReelVersion] = useState<string | null>(
    null
  );

  const updateLandingPageReel = useAction(
    api.inventory.stores.updateLandingPageReel
  );

  const handleUpdateConfig = async () => {
    if (!activeStore || !reelVersion) return;

    setIsUpdatingConfig(true);

    try {
      const res = await updateLandingPageReel({
        storeId: activeStore._id,
        data: {
          reelVersion,
        },
        config: {
          ...activeStore.config,
          landingPageReelVersion: reelVersion,
        },
      });

      if (!res.success) {
        toast.error(res.errorMessage, { position: "top-right" });
        return;
      }
      toast.success(`Reel version updated to v${reelVersion}`, {
        position: "top-right",
      });

      setUpdatedReelVersion(reelVersion);
    } catch (error) {
      console.error("Error updating config:", error);
      toast.error("An error occurred while updating the reel version", {
        description: (error as Error).message,
        position: "top-right",
      });
    } finally {
      setIsUpdatingConfig(false);
    }
  };

  useEffect(() => {
    if (activeStore) {
      setReelVersion(activeStore?.config?.landingPageReelVersion);
    }
  }, [activeStore]);

  // Determine if the save button should be disabled
  const isButtonDisabled =
    // Disable if no reel version is selected
    !reelVersion ||
    // Disable if the selected version matches the current store version
    // and no update has been attempted yet
    (reelVersion === activeStore?.config?.landingPageReelVersion &&
      !updatedReelVersion) ||
    // Disable if we're trying to update to the same version we just updated to
    updatedReelVersion === reelVersion;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center px-1 gap-2 border border-input rounded-md">
          <p className="text-sm pl-2 text-muted-foreground">Reel version</p>
          <SelectNative
            className="bg-background/0 border-none text-muted-foreground hover:text-foreground w-fit "
            value={reelVersion || ""}
            onChange={(e) => setReelVersion(e.target.value)}
          >
            {activeStore?.config?.reelVersions?.map((version: string) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </SelectNative>
        </div>

        <LoadingButton
          variant={"outline"}
          disabled={isButtonDisabled}
          isLoading={isUpdatingConfig}
          onClick={handleUpdateConfig}
        >
          Save
        </LoadingButton>
      </div>
    </div>
  );
};
