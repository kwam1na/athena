import { createFileRoute } from "@tanstack/react-router";
import AnalyticsView from "@/components/analytics/AnalyticsView";

export const Route = createFileRoute("/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/storefront")({ component: AnalyticsView });
