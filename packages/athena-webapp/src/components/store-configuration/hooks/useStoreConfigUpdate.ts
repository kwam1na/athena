import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";

interface UpdateConfigOptions {
  storeId: Id<"store">;
  config: any;
  successMessage?: string;
  errorMessage?: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useStoreConfigUpdate = () => {
  const [isUpdating, setIsUpdating] = useState(false);
  const updateConfigMutation = useMutation(api.inventory.stores.updateConfig);

  const updateConfig = async ({
    storeId,
    config,
    successMessage = "Configuration updated",
    errorMessage = "An error occurred while updating configuration",
    onSuccess,
    onError,
  }: UpdateConfigOptions) => {
    setIsUpdating(true);

    try {
      await updateConfigMutation({
        id: storeId,
        config,
      });
      toast.success(successMessage, { position: "top-right" });
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast.error(errorMessage, {
        description: (error as Error).message,
        position: "top-right",
      });
      onError?.(error as Error);
    } finally {
      setIsUpdating(false);
    }
  };

  return { updateConfig, isUpdating };
};
