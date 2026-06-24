import { createFileRoute } from "@tanstack/react-router";
import { POSRegisterView } from "~/src/components/pos/POSRegisterView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";
import { useExpenseRegisterViewModel } from "@/lib/pos/presentation/expense/useExpenseRegisterViewModel";
import { useAppShellFullscreenMode } from "@/contexts/AppShellFullscreenContext";
import { useAppMessageCommunicationPreference } from "@/lib/app-messages";

function ExpenseRouteComponent() {
  useAppShellFullscreenMode();
  useAppMessageCommunicationPreference({
    surfaceId: "pos-expense-register",
    variant: "toast",
  });
  const viewModel = useExpenseRegisterViewModel();

  return <POSRegisterView workflowMode="expense" viewModel={viewModel} />;
}

function ExpenseNotFoundRoute({ data }: { data?: unknown }) {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const routeData = data as { data?: { org?: boolean } };
  const isOrgMissing = Boolean(routeData.data?.org);
  const entity = isOrgMissing ? "organization" : "store";
  const name = isOrgMissing ? orgUrlSlug : storeUrlSlug;

  return <NotFoundView entity={entity} entityIdentifier={name} />;
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/expense/"
)({
  component: ExpenseRouteComponent,

  notFoundComponent: ExpenseNotFoundRoute,
});
