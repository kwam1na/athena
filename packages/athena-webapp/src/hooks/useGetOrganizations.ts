import { useQuery } from "convex/react";
import { useParams } from "@tanstack/react-router";
import { api } from "~/convex/_generated/api";
import { useGetAuthedUser } from "./useGetAuthedUser";

export function useGetActiveOrganization() {
  const user = useGetAuthedUser();

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
    (org) => org.slug == orgUrlSlug
  );

  return {
    activeOrganization,
    fetchOrganizationError: null,
    isLoadingOrganizations: false,
  };
}

export function useGetOrganizations() {
  const user = useGetAuthedUser();

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
