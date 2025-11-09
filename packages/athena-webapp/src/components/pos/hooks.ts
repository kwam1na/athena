import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { usePOSStore } from "~/src/stores/posStore";

export const usePOSCashier = () => {
  const store = usePOSStore();
  const cashier = useQuery(
    api.inventory.cashier.getById,
    store.cashier.id ? { id: store.cashier.id } : "skip"
  );
  return cashier;
};
