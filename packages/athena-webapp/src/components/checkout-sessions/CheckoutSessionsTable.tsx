import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { CheckoutSession } from "~/types";
import {
  CheckoutSessionTableItem,
  columns,
} from "./checkout-sessions-table/columns";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/src/lib/utils";
import { CheckoutSessionsDataTable } from "./checkout-sessions-table/data-table";

export const CheckoutSessionsTable = ({
  data,
}: {
  data: CheckoutSession[];
}) => {
  const userIds = data.map((session) => session.storeFrontUserId);

  const users = useQuery(api.storeFront.users.getByIds, {
    ids: userIds as Id<"storeFrontUser">[],
  });

  const { activeStore } = useGetActiveStore();

  const formatter = currencyFormatter(activeStore?.currency || "GHS");

  if (!users) return null;

  const userMap = new Map<string, NonNullable<(typeof users)[0]>>();
  users.forEach((user) => {
    if (user) {
      userMap.set(user._id, user);
    }
  });

  const columnData: CheckoutSessionTableItem[] = data.map((session) => {
    const user = userMap.get(session.storeFrontUserId);

    return {
      startedAt: session._creationTime,
      expiresAt: session.expiresAt,
      subtotal: formatter.format(session.amount / 100),
      user: user,
    };
  });

  return (
    <div className="container mx-auto">
      <div className="py-8">
        <CheckoutSessionsDataTable data={columnData} columns={columns} />
      </div>
    </div>
  );
};
