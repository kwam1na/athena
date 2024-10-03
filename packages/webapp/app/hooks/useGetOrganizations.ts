import { Organization } from "@athena/db";
import { useLoaderData, useParams } from "@tanstack/react-router";

export function useGetActiveOrganization() {
  const organizations: Organization[] = useLoaderData({
    from: "/_authed",
  });

  const { orgUrlSlug } = useParams({ strict: false });

  const activeOrganization = organizations?.find(
    (org) => org.slug == orgUrlSlug
  );

  return {
    activeOrganization,
    fetchOrganizationError: null,
    isLoadingOrganizations: false,
  };
}

export function useGetOrganizations() {
  const organizations: Organization[] = useLoaderData({
    from: "/_authed",
  });

  return organizations;
}
