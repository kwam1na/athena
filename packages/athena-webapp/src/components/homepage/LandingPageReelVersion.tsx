import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "~/convex/_generated/api";
import { toast } from "sonner";
import { LoadingButton } from "../ui/loading-button";
import { SelectNative } from "../ui/select-native";
import { VideoPlayer } from "./VideoPlayer";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";

type StreamReel = {
  version: number;
  hlsUrl: string;
  streamUid?: string;
  thumbnailUrl?: string;
  createdAt?: number;
};

export const LandingPageReelVersion = () => {
  const { activeStore } = useGetActiveStore();
  const storeConfig = useMemo(
    () => getStoreConfigV2(activeStore),
    [activeStore?.config],
  );

  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);

  const [reelVersion, setReelVersion] = useState<number | null>(null);

  const [updatedReelVersion, setUpdatedReelVersion] = useState<number | null>(
    null,
  );

  const setActiveStreamReel = useAction(
    api.cloudflare.stream.setActiveStreamReel,
  );

  const streamReels = useMemo(() => {
    const raw = storeConfig.media.reels.streamReels;
    if (!Array.isArray(raw)) return [] as StreamReel[];

    return raw
      .filter(
        (reel): reel is StreamReel =>
          typeof reel?.version === "number" && typeof reel?.hlsUrl === "string",
      )
      .sort((a, b) => b.version - a.version);
  }, [storeConfig.media.reels.streamReels]);

  const selectedReel = streamReels.find((reel) => reel.version === reelVersion);

  useEffect(() => {
    if (!activeStore) {
      setReelVersion(null);
      return;
    }

    if (
      typeof reelVersion === "number" &&
      streamReels.some((reel) => reel.version === reelVersion)
    ) {
      return;
    }

    const activeVersion = storeConfig.media.reels.activeVersion;

    if (typeof activeVersion === "number") {
      setReelVersion(activeVersion);
      return;
    }

    if (streamReels.length > 0) {
      setReelVersion(streamReels[0].version);
      return;
    }

    setReelVersion(null);
  }, [activeStore, storeConfig, streamReels, reelVersion]);

  const hlsUrl =
    selectedReel?.hlsUrl || storeConfig.media.reels.activeHlsUrl || "";

  const handleUpdateConfig = async () => {
    if (!activeStore || !selectedReel) return;

    setIsUpdatingConfig(true);

    try {
      await setActiveStreamReel({
        storeId: activeStore._id,
        version: selectedReel.version,
        hlsUrl: selectedReel.hlsUrl,
      });
      toast.success(`Reel version updated to v${selectedReel.version}`, {
        position: "top-right",
      });

      setUpdatedReelVersion(selectedReel.version);
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

  // Determine if the save button should be disabled
  const isButtonDisabled =
    !reelVersion ||
    !selectedReel ||
    (reelVersion === storeConfig.media.reels.activeVersion &&
      !updatedReelVersion) ||
    updatedReelVersion === reelVersion;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <div className="flex items-center px-1 gap-2 border border-input rounded-md">
          <p className="text-sm pl-2 w-[116px] text-muted-foreground">
            Reel version
          </p>
          <SelectNative
            className="bg-background/0 border-none text-muted-foreground hover:text-foreground w-fit"
            value={reelVersion?.toString() || ""}
            onChange={(e) => setReelVersion(Number(e.target.value))}
          >
            {streamReels.map((reel) => (
              <option key={reel.version} value={reel.version}>
                {`v${reel.version}`}
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
      {streamReels.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No reel versions yet. Upload a video below to create one.
        </p>
      )}
      {activeStore && hlsUrl && <VideoPlayer hlsUrl={hlsUrl} />}
    </div>
  );
};
