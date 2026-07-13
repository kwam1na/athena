import { useLocation, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useCallback } from "react";
import { SharedDemoStatusBar, type SharedDemoRestoreStatus } from "./SharedDemoStatusBar";
import { getSharedDemoArea, getSharedDemoRoutes } from "./sharedDemoRoutes";

type SharedDemoContext = { kind: "shared_demo"; restore: { status: SharedDemoRestoreStatus } };
type RestoreResult = { kind: "already_running" | "failed" | "rate_limited" | "started" };
const getContext = makeFunctionReference<"query", "public", Record<string, never>, SharedDemoContext | null>("sharedDemo/public:getContext");
const requestManualRestore = makeFunctionReference<"mutation", "public", { idempotencyKey: string }, RestoreResult>("sharedDemo/public:requestManualRestore");

export function SharedDemoRuntime() {
  const context = useQuery(getContext, {});
  const requestRestore = useMutation(requestManualRestore);
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const location = useLocation();
  const restore = useCallback(async () => {
    const result = await requestRestore({ idempotencyKey: crypto.randomUUID() });
    if (result.kind === "rate_limited" || result.kind === "failed") throw new Error(result.kind);
  }, [requestRestore]);
  if (!context || !orgUrlSlug || !storeUrlSlug) return null;
  const routes = getSharedDemoRoutes(orgUrlSlug, storeUrlSlug);
  return <SharedDemoStatusBar area={getSharedDemoArea(location.pathname)} homeHref={routes.home} onRestore={restore} restoreStatus={context.restore.status} />;
}
