import { createFileRoute } from "@tanstack/react-router";

import TransactionsView from "~/src/components/pos/transactions/TransactionsView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";
import { ReportsWeeklyReturnLink } from "~/src/components/reports/ReportsWeeklyReturnLink";

function TransactionsRoute() {
  return (
    <>
      <ReportsWeeklyReturnLink />
      <TransactionsView />
    </>
  );
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/"
)({
  component: TransactionsRoute,
  notFoundComponent: function TransactionsNotFound({ data }) {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams();
    const payload = (data as { data?: unknown } | undefined)?.data;
    const org =
      payload !== null &&
      typeof payload === "object" &&
      "org" in payload &&
      payload.org === true;

    const entity = org ? "organization" : "store";
    const name = org ? orgUrlSlug : storeUrlSlug;

    return <NotFoundView entity={entity} entityIdentifier={name} />;
  },
});
