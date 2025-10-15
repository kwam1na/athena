import { useEffect, useState } from "react";
import { Construction, Disc2, EyeIcon } from "lucide-react";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../../View";
import { Switch } from "../../ui/switch";
import { Label } from "../../ui/label";

export const MaintenanceView = () => {
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Construction className="w-4 h-4 text-muted-foreground" />
            <Label className="text-muted-foreground" htmlFor="maintenance-mode">
              Maintenance mode
            </Label>
          </div>
          <Switch
            id="maintenance-mode"
            disabled={isUpdatingConfig}
            checked={isInMaintenanceMode}
            onCheckedChange={(e) => {
              saveMaintenanceModeChanges(e);
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <EyeIcon className="w-4 h-4 text-muted-foreground" />
            <Label className="text-muted-foreground" htmlFor="view-only-mode">
              View-only mode
            </Label>
          </div>
          <Switch
            id="view-only-mode"
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
