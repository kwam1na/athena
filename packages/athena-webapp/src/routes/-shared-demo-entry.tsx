import { useAuthActions } from "@convex-dev/auth/react";
import { useNavigate } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  isSharedDemoUiEnabled,
  useSharedDemoContext,
} from "@/hooks/useSharedDemoContext";
import { api } from "~/convex/_generated/api";
import { getSharedDemoEntryPresentation } from "./-demo-presentation";

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
  const isOpening = !failed && isSharedDemoUiEnabled;

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
      <section
        aria-labelledby="demo-entry-title"
        aria-live={isOpening ? "polite" : undefined}
        className="w-full max-w-sm text-center"
        role={isOpening ? "status" : undefined}
      >
        {isOpening ? (
          <Loader2
            aria-hidden="true"
            className="mx-auto h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
        ) : null}
        <h1
          id="demo-entry-title"
          className="mt-layout-md font-display text-3xl font-light tracking-tight text-foreground"
        >
          {presentation.title}
        </h1>
        {presentation.detail ? (
          <p className="mx-auto mt-layout-sm max-w-md leading-7 text-muted-foreground">
            {presentation.detail}
          </p>
        ) : null}
        {failed && isSharedDemoUiEnabled ? (
          <Button
            type="button"
            size="lg"
            className="mt-layout-lg"
            onClick={() => {
              started.current = true;
              void enter();
            }}
          >
            Try again
          </Button>
        ) : null}
      </section>
    </main>
  );
}
