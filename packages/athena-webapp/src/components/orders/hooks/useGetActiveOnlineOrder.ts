import { useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";

export default function useGetActiveOnlineOrder() {
  const { orderSlug } = useParams({ strict: false });

  const onlineOrder = useQuery(
    api.storeFront.onlineOrder.get,
    orderSlug ? { orderId: orderSlug as Id<"onlineOrder"> } : "skip"
  );

  return onlineOrder;
}
