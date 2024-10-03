import { getAllOrganizations } from "@/api/organization";
import { Organization } from "@athena/db";
import { useQuery } from "@tanstack/react-query";
import { useLoaderData, useParams } from "@tanstack/react-router";

export default function useGetActiveOrganization() {
  const organizations: Organization[] = useLoaderData({ from: "__root__" });

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
