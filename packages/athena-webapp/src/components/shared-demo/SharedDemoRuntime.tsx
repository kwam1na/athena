import { useLocation, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useCallback } from "react";
import { SharedDemoStatusBar, type SharedDemoRestoreStatus } from "./SharedDemoStatusBar";
import { getSharedDemoArea, getSharedDemoRoutes } from "./sharedDemoRoutes";
import { api } from "~/convex/_generated/api";

export function SharedDemoRuntime() {
  const context = useQuery(api.sharedDemo.public.getContext, {});
  const requestRestore = useMutation(api.sharedDemo.public.requestManualRestore);
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const location = useLocation();
  const restore = useCallback(async () => {
    const result = await requestRestore({ idempotencyKey: crypto.randomUUID() });
    if (result.kind === "rate_limited" || result.kind === "failed") throw new Error(result.kind);
  }, [requestRestore]);
  if (!context || !orgUrlSlug || !storeUrlSlug) return null;
  const routes = getSharedDemoRoutes(orgUrlSlug, storeUrlSlug);
  return <SharedDemoStatusBar area={getSharedDemoArea(location.pathname)} homeHref={routes.home} onRestore={restore} restoreStatus={context.restore.status as SharedDemoRestoreStatus} />;
}
