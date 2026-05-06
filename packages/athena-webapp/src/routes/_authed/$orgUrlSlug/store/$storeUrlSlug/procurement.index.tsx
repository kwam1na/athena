import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProcurementView } from "~/src/components/procurement/ProcurementView";

const procurementSearchSchema = z.object({
  procurementMode: z
    .enum(["needs_action", "planned", "inbound", "exceptions", "resolved", "all"])
    .optional(),
});

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/procurement/",
)({
  component: ProcurementRoute,
  validateSearch: procurementSearchSchema,
});

function ProcurementRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <ProcurementView
      mode={search.procurementMode}
      onModeChange={(mode) => {
        void navigate({
          replace: true,
          search: ((current: Record<string, unknown>) => {
            const next: Record<string, unknown> = {
              ...current,
              procurementMode: mode,
            };

            if (next.procurementMode === "needs_action") {
              delete next.procurementMode;
            }

            return next;
          }) as never,
        });
      }}
    />
  );
}
