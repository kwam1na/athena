import { createFileRoute } from "@tanstack/react-router";
import { useAppShellFullscreenMode } from "@/contexts/AppShellFullscreenContext";
import { useUpdateCommunicationPreference } from "@/lib/app-update";
import { POSRegisterOpeningGuard } from "~/src/components/pos/register/POSRegisterOpeningGuard";
import { POSRegisterView } from "~/src/components/pos/register/POSRegisterView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/register/"
)({
  component: POSRegisterRoute,

  notFoundComponent: POSRegisterNotFoundRoute,
});

function POSRegisterRoute() {
  useAppShellFullscreenMode();
  useUpdateCommunicationPreference({
    surfaceId: "pos-register",
    variant: "toast",
  });

  return (
    <POSRegisterOpeningGuard>
      <POSRegisterView />
    </POSRegisterOpeningGuard>
  );
}

function POSRegisterNotFoundRoute({ data }: { data?: unknown }) {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const routeData = data as { data?: { org?: boolean } };
  const isOrgMissing = Boolean(routeData.data?.org);
  const entity = isOrgMissing ? "organization" : "store";
  const name = isOrgMissing ? orgUrlSlug : storeUrlSlug;

  return <NotFoundView entity={entity} entityIdentifier={name} />;
}
