import { z } from "zod";

const procurementModeSchema = z.preprocess(
  (value) => (value === "resolved" ? undefined : value),
  z
    .enum(["needs_action", "planned", "inbound", "exceptions", "all"])
    .optional(),
);

export const rootPageSchema = z.object({
  o: z.string().optional(),
  variant: z.string().optional(),
  orderStatus: z.string().optional(),
  categorySlug: z.string().optional(),
  classification: z
    .enum([
      "all",
      "fast_mover",
      "slow_mover",
      "nonmoving",
      "low_cover",
      "high_revenue_low_margin",
    ])
    .optional(),
  comparison: z.enum(["prior_period", "none"]).optional(),
  cursor: z.string().optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  itemSort: z
    .enum(["revenue", "margin", "units", "cover", "inventory_value", "attention"])
    .optional(),
  registerSessionId: z.string().optional(),
  mode: z.enum(["cycle_count", "manual"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  procurementMode: procurementModeSchema,
  preset: z
    .enum(["wtd", "today", "prior_week", "trailing_30", "custom"])
    .optional(),
  query: z.string().optional(),
  scope: z.string().optional(),
  sku: z.string().optional(),
  runId: z.string().optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timeRange: z.enum(["today", "fromDate", "all"]).optional(),
});
