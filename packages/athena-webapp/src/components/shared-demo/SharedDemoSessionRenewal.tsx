import { useAuthActions } from "@convex-dev/auth/react";
import { Link } from "@tanstack/react-router";
import { useAction } from "convex/react";
import { Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";

import { api } from "~/convex/_generated/api";
import { recordSharedDemoRenewalAttempt } from "@/lib/errors/sharedDemoSessionExpired";

type SharedDemoSessionRenewalProps = {
  onFailed: () => void;
  reloadPage?: () => void;
};

/**
 * Takes a fresh demo admission without asking the visitor to do anything.
 *
 * A demo session ending is not a decision the visitor made and not one they
 * can act on any better than we can — the only route back is the same one they
 * took to get in. Every read fails while the session is expired, including the
 * app's own identity probe, so this cannot render inside the app shell; it
 * runs from the error boundary, which is the one place that still mounts.
 *
 * The sequence deliberately differs from the demo entry route, which signs out
 * before taking a ticket. Signing out here would leave the app briefly with no
 * identity at all, and the router answers that by redirecting to sign-in —
 * unmounting this component mid-renewal and stranding the visitor on a login
 * screen. Taking the ticket first and signing in over the dead session swaps
 * identity in one step, with no signed-out window for the router to react to.
 *
 * The reload afterwards is deliberate too: the queries that failed are spread
 * across the route tree and every one has to be re-issued against the new
 * identity, which a targeted invalidation would not reliably cover.
 */
export function SharedDemoSessionRenewal({
  onFailed,
  reloadPage = () => window.location.reload(),
}: SharedDemoSessionRenewalProps) {
  const { signIn } = useAuthActions();
  const issueTicket = useAction(api.sharedDemo.admission.issueSharedDemoTicket);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    recordSharedDemoRenewalAttempt();

    void (async () => {
      try {
        const { ticket } = await issueTicket({});
        await signIn("shared-demo", { ticket });
        reloadPage();
      } catch {
        onFailed();
      }
    })();
  }, [issueTicket, onFailed, reloadPage, signIn]);

  return (
    <section
      aria-labelledby="shared-demo-renewal-title"
      aria-live="polite"
      className="flex min-h-[100svh] min-w-0 flex-1 items-center justify-center bg-background px-6 py-12 text-foreground sm:px-10 lg:px-14"
      role="status"
    >
      <div className="mx-auto w-full max-w-3xl space-y-layout-lg">
        <Loader2
          aria-hidden="true"
          className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
        <div className="space-y-3">
          <h1
            id="shared-demo-renewal-title"
            className="font-display text-4xl leading-tight tracking-normal text-foreground sm:text-[clamp(2.75rem,4.6vw,4.75rem)] sm:leading-[0.95] sm:tracking-[-0.05em]"
          >
            Starting a fresh demo session
          </h1>
          <p className="text-sm leading-6 text-muted-foreground md:text-lg md:leading-7">
            Your last session ended. Reconnecting you to the demo store now.
          </p>
          {/*
            The way out of a stall. `onFailed` only fires on rejection, so a
            request that never settles — a dropped socket over sleep/wake, a
            deploy mid-flight — would otherwise leave a spinner and no control
            at all, in the one screen whose job is recovery.
          */}
          <Link
            className="inline-flex items-center gap-2 text-sm underline underline-offset-4"
            to="/demo"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Open demo again
          </Link>
        </div>
      </div>
    </section>
  );
}
