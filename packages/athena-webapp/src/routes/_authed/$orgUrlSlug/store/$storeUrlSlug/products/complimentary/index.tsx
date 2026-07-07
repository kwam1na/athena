import ComplimentaryProductsView from "~/src/components/products/complimentary/ComplimentaryProductsView";
import { NotFoundView } from "@/components/states/not-found/NotFoundView";
import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "~/src/components/ProtectedRoute";

type NotFoundPayload = {
  data?: {
    org?: boolean;
  };
};

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/complimentary/"
)({
  component: () => (
    <ProtectedRoute requires="manager">
      <ComplimentaryProductsView />
    </ProtectedRoute>
  ),
  notFoundComponent: ComplimentaryProductsNotFoundComponent,
});

function ComplimentaryProductsNotFoundComponent({ data }: { data?: unknown }) {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const payload = data as NotFoundPayload | undefined;
  const org = Boolean(payload?.data?.org);

  const entity = org ? "organization" : "store";
  const name = org ? orgUrlSlug : storeUrlSlug;

  return <NotFoundView entity={entity} entityIdentifier={name} />;
}
