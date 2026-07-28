import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";

import OrganizationsView from "@/components/OrganizationsView";
import { UpdateReadyBanner } from "@/components/app-update/UpdateReadyBanner";
import { OrganizationModal } from "@/components/ui/modals/organization-modal";
import { useNavigationKeyboardShortcuts } from "@/hooks/use-navigation-keyboard-shortcuts";
import { useAuth } from "@/hooks/useAuth";
import {
  ATHENA_HAS_AUTHENTICATED_KEY,
  LOGGED_IN_USER_ID_KEY,
} from "@/lib/constants";
import { api } from "~/convex/_generated/api";

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
  const hasAuthenticatedBefore = useRef(
    localStorage.getItem(ATHENA_HAS_AUTHENTICATED_KEY) === "true" ||
      Boolean(localStorage.getItem(LOGGED_IN_USER_ID_KEY)),
  ).current;

  useEffect(() => {
    if (userOrgs && userOrgs.length > 0) {
      const org = userOrgs[0];
      navigate({ to: "/$orgUrlSlug", params: { orgUrlSlug: org.slug } });
    }
  }, [navigate, userOrgs]);

  useEffect(() => {
    if (!isLoading && user === null) {
      navigate({ to: hasAuthenticatedBefore ? "/login" : "/landing" });
    }
  }, [hasAuthenticatedBefore, isLoading, navigate, user]);

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
