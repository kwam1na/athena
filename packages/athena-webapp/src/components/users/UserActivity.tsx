import { useQuery } from "convex/react";
import { analyticsColumns } from "../analytics/analytics-data-table/analytics-columns";
import { GenericDataTable } from "../base/table/data-table";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useParams } from "@tanstack/react-router";
import { Id } from "~/convex/_generated/dataModel";

export const UserActivity = () => {
  const { activeStore } = useGetActiveStore();

  //   const analytics = useQuery(
  //     api.storeFront.analytics.getAll,
  //     activeStore?._id ? { storeId: activeStore._id } : "skip"
  //   );

  const { userId } = useParams({ strict: false });
  const analytics = useQuery(
    api.storeFront.user.getAllUserActivity,
    userId ? { id: userId as Id<"storeFrontUser"> } : "skip"
  );

  if (!activeStore || !analytics) return null;

  const items = analytics.sort((a, b) => b._creationTime - a._creationTime);

  return <GenericDataTable data={items} columns={analyticsColumns} />;
};
