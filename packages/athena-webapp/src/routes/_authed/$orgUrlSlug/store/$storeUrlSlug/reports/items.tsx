import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/items")({ component: Outlet });
