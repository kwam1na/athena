import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect } from "react";

import OrganizationsView from "@/components/OrganizationsView";
import { UpdateReadyBanner } from "@/components/app-update/UpdateReadyBanner";
import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { useNavigationKeyboardShortcuts } from "@/hooks/use-navigation-keyboard-shortcuts";
import { useAuth } from "@/hooks/useAuth";
import { api } from "~/convex/_generated/api";

export const Route = createFileRoute("/app")({
  component: AppEntryRoute,
  head: () => ({
    meta: [{ title: "Athena | Workspace" }],
  }),
});

export function AppEntryRoute() {
  useNavigationKeyboardShortcuts();

  return (
    <>
      <UpdateReadyBanner />
      <div className="p-8">
        <AppEntryDispatcher />
      </div>
    </>
  );
}

export function AppEntryDispatcher() {
  const { isLoading, user } = useAuth();
  const userOrgs = useQuery(
    api.inventory.organizations.getAll,
    user?._id ? { userId: user._id } : "skip",
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
    return null;
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
