import { createFileRoute, useNavigate } from "@tanstack/react-router";
import OrganizationsView from "@/components/OrganizationsView";
import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { api } from "~/convex/_generated/api";

export const Route = createFileRoute("/")({
  component: Index,
});

export function Index() {
  const { isLoading, user } = useAuth();

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
  }, [navigate, userOrgs]);

  useEffect(() => {
    if (!isLoading && user === null) {
      navigate({ to: "/login" });
    }
  }, [isLoading, navigate, user]);

  if (isLoading || user === undefined || (user && userOrgs === undefined)) {
    return (
      <div
        className="flex min-h-[60vh] w-full items-center justify-center text-sm text-muted-foreground"
        aria-live="polite"
      >
        Loading workspace...
      </div>
    );
  }

  if (user === null) {
    return null;
  }

  return (
    <>
      <OrganizationModal />
      <OrganizationsView />
    </>
  );
}
