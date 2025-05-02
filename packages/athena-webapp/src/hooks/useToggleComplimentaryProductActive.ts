import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";

export function useToggleComplimentaryProductActive() {
  const toggle = useMutation(
    api.inventory.complimentaryProduct.toggleComplimentaryProductActive
  );

  return async (
    complimentaryProductId: Id<"complimentaryProduct">,
    isActive: boolean
  ) => {
    await toggle({
      complimentaryProductId,
      isActive,
    });
  };
}
