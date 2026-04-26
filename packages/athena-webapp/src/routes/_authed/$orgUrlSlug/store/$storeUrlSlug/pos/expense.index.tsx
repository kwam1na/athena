import { createFileRoute } from "@tanstack/react-router";
import { POSRegisterView } from "~/src/components/pos/POSRegisterView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";
import { useExpenseRegisterViewModel } from "@/lib/pos/presentation/expense/useExpenseRegisterViewModel";

function ExpenseRouteComponent() {
  const viewModel = useExpenseRegisterViewModel();

  return <POSRegisterView workflowMode="expense" viewModel={viewModel} />;
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/expense/"
)({
  component: ExpenseRouteComponent,

  notFoundComponent: ({ data }) => {
    const { orgUrlSlug, storeUrlSlug } = Route.useParams();
    const { data: d } = data as Record<string, any>;
    const { org } = d as Record<string, boolean>;

    const entity = org ? "organization" : "store";
    const name = org ? orgUrlSlug : storeUrlSlug;

    return <NotFoundView entity={entity} entityIdentifier={name} />;
  },
});
