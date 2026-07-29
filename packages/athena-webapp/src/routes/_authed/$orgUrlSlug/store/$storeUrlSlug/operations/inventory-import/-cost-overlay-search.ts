import { z } from "zod";

// Cost overlays are bounded to 5,000 rows, or 334 viewport-sized review pages.
export const INVENTORY_COST_OVERLAY_MAX_RESTORED_PAGE = 334;

export const inventoryCostOverlaySearchSchema = z.object({
  filter: z
    .enum(["all", "eligible", "selected", "different", "exceptions"])
    .optional()
    .catch("all"),
  page: z.coerce
    .number()
    .int()
    .positive()
    .transform((page) =>
      Math.min(page, INVENTORY_COST_OVERLAY_MAX_RESTORED_PAGE),
    )
    .optional()
    .catch(1),
  q: z.string().trim().max(120).optional(),
  run: z.string().trim().min(1).optional(),
});
