import { useQuery } from "convex/react";

import { api } from "~/convex/_generated/api";

export function resolveSharedDemoUiEnabled(env: { DEV: boolean }) {
  return env.DEV;
}

export function sharedDemoQueryArgs(enabled: boolean) {
  return enabled ? {} : "skip" as const;
}

export const isSharedDemoUiEnabled = resolveSharedDemoUiEnabled(import.meta.env);

export function useSharedDemoContext() {
  return useQuery(
    api.sharedDemo.public.getContext,
    sharedDemoQueryArgs(isSharedDemoUiEnabled),
  );
}
