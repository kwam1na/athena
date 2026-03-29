import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";

interface UpdateConfigOptions {
  storeId: Id<"store">;
  patch?: Record<string, any>;
  // Backward-compatible alias while callsites migrate to patch payloads.
  config?: Record<string, any>;
  mirrorLegacy?: boolean;
  successMessage?: string;
  errorMessage?: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useStoreConfigUpdate = () => {
  const [isUpdating, setIsUpdating] = useState(false);
  const patchConfigMutation = useMutation(api.inventory.stores.patchConfigV2);

  const updateConfig = async ({
    storeId,
    patch,
    config,
    mirrorLegacy,
    successMessage = "Configuration updated",
    errorMessage = "An error occurred while updating configuration",
    onSuccess,
    onError,
  }: UpdateConfigOptions) => {
    setIsUpdating(true);

    try {
      const nextPatch = patch ?? config;

      if (!nextPatch) {
        throw new Error("A config patch payload is required");
      }

      await patchConfigMutation({
        id: storeId,
        patch: nextPatch,
        mirrorLegacy,
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
