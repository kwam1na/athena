import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ReportsLayout } from "@/components/reports/ReportsLayout";
import type { ReportPeriodPreset } from "@/components/reports/ReportPeriodControl";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportsSearchSchema = z.object({
  comparison: z.enum(["prior_period", "none"]).optional(),
  end: dateSchema.optional(),
  preset: z.enum(["wtd", "today", "prior_week", "trailing_30", "custom"]).optional(),
  runId: z.string().min(1).optional(),
  start: dateSchema.optional(),
}).superRefine((value, context) => {
  if (value.preset === "custom" && (!value.start || !value.end)) {
    context.addIssue({ code: "custom", message: "Choose a start and end date." });
  }
});

export function getNextReportPeriodSearch(current: Record<string, unknown>, preset: ReportPeriodPreset) {
  const next: Record<string, unknown> = { ...current, preset };
  delete next.cursor;
  delete next.page;
  delete next.runId;
  if (preset !== "custom") {
    delete next.start;
    delete next.end;
  }
  return next;
}

export const Route = createFileRoute("/_authed/$orgUrlSlug/store/$storeUrlSlug/reports")({
  component: () => <ProtectedRoute requires="full_admin"><ReportsLayout /></ProtectedRoute>,
});
