import { Save } from "lucide-react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { toast } from "sonner";
import { LoadingButton } from "../ui/loading-button";

export const LandingPageReelVersion = () => {
  const { activeStore } = useGetActiveStore();

  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);

  const [reelVersion, setReelVersion] = useState<string | null>();

  const updateConfig = useMutation(api.inventory.stores.updateConfig);

  const handleUpdateConfig = async () => {
    if (!activeStore) return;
    setIsUpdatingConfig(true);
    try {
      await updateConfig({
        id: activeStore._id,
        config: {
          ...activeStore.config,
          landingPageReelVersion: reelVersion,
        },
      });
      toast.success("Reel version updated", { position: "top-right" });
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative">
          <Input
            className="peer ps-28"
            placeholder="1"
            type="number"
            value={reelVersion || undefined}
            onChange={(e) => setReelVersion(e.target.value)}
          />
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-sm peer-disabled:opacity-50">
            Reel version
          </span>
        </div>

        <LoadingButton
          variant={"outline"}
          disabled={!reelVersion}
          isLoading={isUpdatingConfig}
          onClick={handleUpdateConfig}
        >
          Save
        </LoadingButton>
      </div>
    </div>
  );
};
