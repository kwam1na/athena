import { NotFoundView } from "@/components/states/not-found/NotFoundView";
import { useEffect } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { usePermissions } from "@/hooks/usePermissions";

function StoreRootRedirect() {
  const navigate = useNavigate();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const { role, isLoading } = usePermissions();

  useEffect(() => {
    if (orgUrlSlug && storeUrlSlug && !isLoading) {
      // Redirect based on user role
      if (role === "pos_only") {
        navigate({
          to: "/$orgUrlSlug/store/$storeUrlSlug/pos",
          params: { orgUrlSlug, storeUrlSlug },
        });
      } else {
        // full_admin or default to operations workspace
        navigate({
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations",
          params: { orgUrlSlug, storeUrlSlug },
        });
      }
    }
  }, [orgUrlSlug, storeUrlSlug, role, isLoading, navigate]);
  return null;
}

function StoreRootNotFound({ data }: { data?: unknown }) {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const notFoundData =
    typeof data === "object" && data !== null && "data" in data
      ? (data.data as { org?: boolean } | undefined)
      : undefined;
  const isMissingOrg = Boolean(notFoundData?.org);
  const entity = isMissingOrg ? "organization" : "store";
  const name = isMissingOrg ? orgUrlSlug : storeUrlSlug;

  return <NotFoundView entity={entity} entityIdentifier={name} />;
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/"
)({
  loader: async () => {
    const org = {};
    const store = {};

    if (!org || !store)
      throw notFound({
        data: {
          store: Boolean(store) == false,
          org: Boolean(org) == false,
        },
      });

    return {
      store,
    };
  },

  component: StoreRootRedirect,
  notFoundComponent: StoreRootNotFound,
});
