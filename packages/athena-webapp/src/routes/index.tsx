import { createFileRoute, useNavigate } from "@tanstack/react-router";
import OrganizationsView from "@/components/OrganizationsView";
import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { api } from "~/convex/_generated/api";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { user } = useAuth();

  const userOrgs = useQuery(
    api.inventory.organizations.getAll,
    user?._id ? { userId: user._id } : "skip"
  );

  const navigate = useNavigate();

  useEffect(() => {
    if (userOrgs && userOrgs.length > 0) {
      const org = userOrgs[0];
      navigate({ to: "/$orgUrlSlug", params: { orgUrlSlug: org.slug } });
    }
  }, [userOrgs]);

  useEffect(() => {
    if (user === null) {
      navigate({ to: "/login" });
    }
  }, [user]);

  return (
    <>
      <OrganizationModal />
      <OrganizationsView />
    </>
  );
}
