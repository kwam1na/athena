import { createFileRoute } from "@tanstack/react-router";
import { POSSettingsView } from "~/src/components/pos/settings/POSSettingsView";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";

type NotFoundPayload = {
  data?: {
    org?: boolean;
  };
};

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/settings/"
)({
  component: () => (
    <ProtectedRoute requires="manager">
      <POSSettingsView />
    </ProtectedRoute>
  ),
  notFoundComponent: SettingsNotFoundComponent,
});

function SettingsNotFoundComponent({ data }: { data?: unknown }) {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const payload = data as NotFoundPayload | undefined;
  const org = Boolean(payload?.data?.org);

  const entity = org ? "organization" : "store";
  const name = org ? orgUrlSlug : storeUrlSlug;

  return <NotFoundView entity={entity} entityIdentifier={name} />;
}
