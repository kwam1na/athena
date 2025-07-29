import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Analytic } from "~/types";
import { UsersTable } from "./users-table/data-table";
import { columns, User } from "./users-table/columns";

export default function AnalyticsUsers({ items }: { items: Analytic[] }) {
  // Process analytics to get user metrics
  const userIds = new Set(items?.map((item) => item.storeFrontUserId));

  const users = useQuery(api.storeFront.users.getByIds, {
    ids: Array.from(userIds),
  })?.map((user) => {
    if (!user) return null;
    return {
      ...user,
      isNew: Date.now() < user._creationTime,
    };
  });

  if (!users) return null;

  return (
    <div className="container mx-auto">
      <div className="py-8">
        <UsersTable data={users as User[]} columns={columns} />
      </div>
    </div>
  );
}
