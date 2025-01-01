import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "./useGetActiveStore";
import { currencyFormatter } from "../lib/utils";
import { useEffect } from "react";
import { toast } from "sonner";

export const useNewOrderNotification = () => {
  const { activeStore } = useGetActiveStore();

  const ORDER_ID_LOCAL_STORAGE_KEY = "order_id";

  const newOrder = useQuery(
    api.storeFront.onlineOrder.newOrder,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const formatter = currencyFormatter(activeStore?.currency || "USD");

  useEffect(() => {
    if (newOrder) {
      const { customerDetails } = newOrder;

      const previousOrderId = localStorage.getItem(ORDER_ID_LOCAL_STORAGE_KEY);

      if (previousOrderId == newOrder._id) return;

      localStorage.setItem(ORDER_ID_LOCAL_STORAGE_KEY, newOrder._id);

      toast(`Order for ${formatter.format(newOrder.amount / 100)} received`, {
        description: `${customerDetails.email} placed an order`,
        position: "top-right",
        duration: 4000,
      });
    }
  }, [newOrder]);
};
