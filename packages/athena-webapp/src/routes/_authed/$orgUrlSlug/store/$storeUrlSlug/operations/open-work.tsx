import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { OperationsQueueView } from "~/src/components/operations/OperationsQueueView";
import type { OpenWorkSearchPatch } from "~/src/components/operations/OperationsQueueView";

const openWorkSearchSchema = z.object({
  o: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  workType: z.string().trim().min(1).optional(),
});

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
)({
  component: OpenWorkRoute,
  validateSearch: openWorkSearchSchema,
});

function OpenWorkRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const handleOpenWorkSearchChange = (patch: OpenWorkSearchPatch) => {
    void navigate({
      replace: true,
      search: (current) => {
        const next = { ...current, ...patch };

        if (next.page === undefined) {
          delete next.page;
        }

        if (next.workType === undefined) {
          delete next.workType;
        }

        return next;
      },
    });
  };

  return (
    <OperationsQueueView
      activeWorkflow="queue"
      onOpenWorkSearchChange={handleOpenWorkSearchChange}
      openWorkSearch={search}
    />
  );
}
