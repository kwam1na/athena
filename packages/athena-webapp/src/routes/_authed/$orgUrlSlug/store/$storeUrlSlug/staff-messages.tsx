import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

import { StaffMessagesView } from "@/components/staff/StaffMessagesView";
import type { Id } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";

const getSharedDemoContext = makeFunctionReference<"query", "public", Record<string, never>, { storeId: Id<"store"> } | null>("sharedDemo/public:getContext");

export const Route = createFileRoute("/_authed/$orgUrlSlug/store/$storeUrlSlug/staff-messages")({ component: StaffMessagesRoute });

function StaffMessagesRoute() {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const demo = useQuery(getSharedDemoContext, {});
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
