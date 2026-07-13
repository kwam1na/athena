import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { StaffMessagesView } from "@/components/staff/StaffMessagesView";
import { useSharedDemoContext } from "@/hooks/useSharedDemoContext";
import { api } from "~/convex/_generated/api";

export const Route = createFileRoute("/_authed/$orgUrlSlug/store/$storeUrlSlug/staff-messages")({ component: StaffMessagesRoute });

function StaffMessagesRoute() {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const demo = useSharedDemoContext();
  const organization = useQuery(api.inventory.organizations.getByIdOrSlug, {
    identifier: orgUrlSlug,
  });
  const stores = useQuery(
    api.inventory.stores.getAll,
    organization?._id ? { organizationId: organization._id } : "skip",
  );
  const storeId = demo?.storeId ?? stores?.find((store) => store.slug === storeUrlSlug)?._id;
  if (!storeId) return <main className="p-layout-lg">Loading staff messages…</main>;
  return <StaffMessagesView storeId={storeId} />;
}
