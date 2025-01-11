import { useQuery } from "convex/react";
import { useParams } from "@tanstack/react-router";
import { api } from "~/convex/_generated/api";
import { useAuth } from "./useAuth";

export function useGetActiveOrganization() {
  const { user } = useAuth();

  const organizations = useQuery(
    api.inventory.organizations.getAll,
    user?._id
      ? {
          userId: user._id,
        }
      : "skip"
  );

  const { orgUrlSlug } = useParams({ strict: false });

  const activeOrganization = organizations?.find(
    (org: any) => org.slug == orgUrlSlug
  );

  return {
    activeOrganization,
    fetchOrganizationError: null,
    isLoadingOrganizations: false,
  };
}

export function useGetOrganizations() {
  const { user } = useAuth();

  const organizations = useQuery(
    api.inventory.organizations.getAll,
    user?._id
      ? {
          userId: user._id,
        }
      : "skip"
  );

  return organizations;
}
