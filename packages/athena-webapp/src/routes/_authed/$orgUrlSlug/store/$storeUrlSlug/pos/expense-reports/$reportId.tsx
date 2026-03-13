import { createFileRoute } from "@tanstack/react-router";

import ExpenseReportView from "~/src/components/pos/expense-reports/ExpenseReportView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports/$reportId"
)({
  component: ExpenseReportView,
  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams();
    const { data: payload } = data as Record<string, any>;
    const { org } = payload as Record<string, boolean>;

    const entity = org ? "organization" : "store";
    const name = org ? orgUrlSlug : storeUrlSlug;

    return <NotFoundView entity={entity} entityIdentifier={name} />;
  },
});
