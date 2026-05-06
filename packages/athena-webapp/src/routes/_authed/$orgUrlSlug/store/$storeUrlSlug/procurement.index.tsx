import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProcurementView } from "~/src/components/procurement/ProcurementView";

const procurementSearchSchema = z.object({
  procurementMode: z
    .enum(["needs_action", "planned", "inbound", "exceptions", "resolved", "all"])
    .optional(),
  page: z.coerce.number().int().positive().optional(),
  sku: z.string().optional(),
});

export function getNextProcurementModeSearch(
  current: Record<string, unknown>,
  mode: NonNullable<z.infer<typeof procurementSearchSchema>["procurementMode"]>,
) {
  const next: Record<string, unknown> = {
    ...current,
    procurementMode: mode,
  };

  if (next.procurementMode === "needs_action") {
    delete next.procurementMode;
  }

  next.page = 1;

  return next;
}

export function getNextProcurementPageSearch(
  current: Record<string, unknown>,
  page: number,
) {
  return {
    ...current,
    page,
  };
}

export function getNextProcurementSelectedSkuSearch(
  current: Record<string, unknown>,
  sku: string | null,
  page?: number,
) {
  const next: Record<string, unknown> = { ...current };

  if (sku) {
    next.sku = sku;
    if (page !== undefined) {
      next.page = page;
    }
  } else {
    delete next.sku;
  }

  return next;
}

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
          search: ((current: Record<string, unknown>) =>
            getNextProcurementModeSearch(current, mode)) as never,
        });
      }}
      onPageChange={(page) => {
        void navigate({
          replace: true,
          search: ((current: Record<string, unknown>) =>
            getNextProcurementPageSearch(current, page)) as never,
        });
      }}
      onSelectedSkuChange={(sku, page) => {
        void navigate({
          replace: true,
          search: ((current: Record<string, unknown>) =>
            getNextProcurementSelectedSkuSearch(current, sku, page)) as never,
        });
      }}
      page={search.page}
      selectedSku={search.sku}
    />
  );
}
