import { useQuery } from "convex/react";

import { api } from "~/convex/_generated/api";

export const isSharedDemoUiEnabled = true;

export function sharedDemoQueryArgs(enabled: boolean) {
  return enabled ? {} : "skip" as const;
}

export function useSharedDemoContext() {
  return useQuery(
    api.sharedDemo.public.getContext,
    sharedDemoQueryArgs(isSharedDemoUiEnabled),
  );
}
