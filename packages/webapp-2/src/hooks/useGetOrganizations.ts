import { getAllOrganizations } from "@/api/organization";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";

export function useGetActiveOrganization() {
  const { data: organizations } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => getAllOrganizations(),
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
  const { data: organizations } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => getAllOrganizations(),
  });

  return organizations;
}
