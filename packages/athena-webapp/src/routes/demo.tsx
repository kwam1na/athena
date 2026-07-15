import { useAuthActions } from "@convex-dev/auth/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  isSharedDemoUiEnabled,
  useSharedDemoContext,
} from "@/hooks/useSharedDemoContext";
import { api } from "~/convex/_generated/api";
import { getSharedDemoEntryPresentation } from "./demoPresentation";

export const Route = createFileRoute("/demo")({
  component: SharedDemoEntry,
  head: () => ({ meta: [{ title: "Athena | Demo" }] }),
});

export function SharedDemoEntry() {
  const { signIn, signOut } = useAuthActions();
  const issueTicket = useAction(api.sharedDemo.admission.issueSharedDemoTicket);
  const { isLoading, user } = useAuth();
  const demoContext = useSharedDemoContext();
  const organizations = useQuery(api.inventory.organizations.getAll, user?._id ? { userId: user._id } : "skip");
  const stores = useQuery(api.inventory.stores.getAll, organizations?.[0]?._id ? { organizationId: organizations[0]._id } : "skip");
  const navigate = useNavigate();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  const presentation = getSharedDemoEntryPresentation({
    enabled: isSharedDemoUiEnabled,
    failed,
  });

  const enter = useCallback(async () => {
    setFailed(false);
    try {
      const { ticket } = await issueTicket({});
      await signIn("shared-demo", { ticket });
    } catch {
      started.current = false;
      setFailed(true);
    }
  }, [issueTicket, signIn]);

  useEffect(() => {
    if (isSharedDemoUiEnabled && !isLoading && !user && !started.current) {
      started.current = true;
      void signOut().then(enter).catch(() => {
        started.current = false;
        setFailed(true);
      });
    }
  }, [enter, isLoading, signOut, user]);

  useEffect(() => {
    if (!isSharedDemoUiEnabled || isLoading || !user || demoContext === undefined || demoContext || started.current) return;
    started.current = true;
    void signOut().then(enter).catch(() => {
      started.current = false;
      setFailed(true);
    });
  }, [demoContext, enter, isLoading, signOut, user]);

  useEffect(() => {
    const organization = organizations?.[0];
    const store = stores?.find(({ _id }) => _id === demoContext?.storeId);
    if (!user || !demoContext || !organization || !store) return;
    navigate({
      to: "/$orgUrlSlug/store/$storeUrlSlug/shared-demo",
      params: { orgUrlSlug: organization.slug, storeUrlSlug: store.slug },
      replace: true,
    });
  }, [demoContext, navigate, organizations, stores, user]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-app-canvas px-layout-md py-layout-xl">
      <section aria-labelledby="demo-entry-title" className="w-full max-w-lg border-y border-border bg-background py-layout-xl text-center sm:px-layout-lg">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">Athena demo</p>
        <h1 id="demo-entry-title" className="mt-layout-md font-display text-4xl font-light text-foreground">
          {presentation.title}
        </h1>
        <p className="mx-auto mt-layout-md max-w-md leading-7 text-muted-foreground">
          {presentation.detail}
        </p>
        {failed && isSharedDemoUiEnabled ? <Button type="button" size="lg" className="mt-layout-lg" onClick={() => { started.current = true; void enter(); }}>Try again</Button> : null}
        {!failed && isSharedDemoUiEnabled ? <span className="sr-only" role="status">Signing in to the demo</span> : null}
      </section>
    </main>
  );
}
