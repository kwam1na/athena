import { useEffect, useMemo, useState } from "react";
import { Construction, Disc2, EyeIcon } from "lucide-react";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import View from "../../View";
import { Switch } from "../../ui/switch";
import { Label } from "../../ui/label";
import { MaintenanceMessageEditor } from "../../homepage/MaintenanceMessageEditor";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";
import { useStoreConfigUpdate } from "../hooks/useStoreConfigUpdate";

export const MaintenanceView = () => {
  const { activeStore } = useGetActiveStore();
  const storeConfig = useMemo(
    () => getStoreConfigV2(activeStore),
    [activeStore?.config],
  );

  const [isInMaintenanceMode, setIsInMaintenanceMode] = useState(false);
  const [isInReadOnlyMode, setIsInReadOnlyMode] = useState(false);

  const { updateConfig, isUpdating: isUpdatingConfig } = useStoreConfigUpdate();

  const saveMaintenanceModeChanges = async (toggled: boolean) => {
    const previousValue = isInMaintenanceMode;
    setIsInMaintenanceMode(toggled);

    const updates = {
      inMaintenanceMode: toggled,
    };

    await updateConfig({
      storeId: activeStore?._id!,
      patch: {
        operations: {
          availability: updates,
        },
      },
      successMessage: toggled
        ? "Store set to maintenance mode"
        : "Store set to live",
      errorMessage: "An error occurred while updating store availability",
      onError: () => {
        setIsInMaintenanceMode(previousValue);
      },
    });
  };

  const saveReadOnlyeModeChanges = async (toggled: boolean) => {
    const previousValue = isInReadOnlyMode;
    setIsInReadOnlyMode(toggled);

    const updates = {
      inReadOnlyMode: toggled,
    };

    await updateConfig({
      storeId: activeStore?._id!,
      patch: {
        operations: {
          visibility: updates,
        },
      },
      successMessage: toggled
        ? "Store set to view-only mode"
        : "Store set to full access",
      errorMessage: "An error occurred while updating store visibility",
      onError: () => {
        setIsInReadOnlyMode(previousValue);
      },
    });
  };

  useEffect(() => {
    setIsInMaintenanceMode(storeConfig.operations.availability.inMaintenanceMode);
    setIsInReadOnlyMode(storeConfig.operations.visibility.inReadOnlyMode);
  }, [storeConfig]);

  return (
    <div className="space-y-8">
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
              <Label
                className="text-muted-foreground"
                htmlFor="maintenance-mode"
              >
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

      {activeStore && <MaintenanceMessageEditor storeId={activeStore._id} />}
    </div>
  );
};
