import { Link } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

import { AutomationRevealScene } from "@/components/landing/story/AutomationRevealScene";
import { CashControlsScene } from "@/components/landing/story/CashControlsScene";
import { DailyOperationsScene } from "@/components/landing/story/DailyOperationsScene";
import { EodReviewScene } from "@/components/landing/story/EodReviewScene";
import { HeroDayArcScene } from "@/components/landing/story/HeroDayArcScene";
import { OpeningHandoffScene } from "@/components/landing/story/OpeningHandoffScene";
import { PosSaleScene } from "@/components/landing/story/PosSaleScene";
import { SyncBridgeScene } from "@/components/landing/story/SyncBridgeScene";
import { AutomationBeat } from "@/components/landing/story/SceneChrome";
import { useForcedLightTheme } from "@/components/landing/story/useForcedLightTheme";
import { emitLandingFunnelEvent } from "@/lib/marketing/landingFunnelClient";
import { DEMO_PATH, WALKTHROUGH_PATH } from "@/lib/navigation/appEntryRoutes";
import { PublicLayout } from "./-public-layout";

function DemoCtaButton() {
  return (
    <Link
      to={DEMO_PATH}
      onClick={() => emitLandingFunnelEvent("demo_cta")}
      className="inline-flex min-h-12 items-center justify-center rounded-md bg-signal px-layout-lg text-sm font-semibold text-signal-foreground transition-[background-color,transform] duration-standard ease-standard hover:bg-signal/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      Try the demo
      <ArrowRight className="ml-layout-sm h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

function ActCopy({
  time,
  workspace,
  title,
  copy,
  automation,
  className,
}: {
  automation?: string;
  className?: string;
  copy: string;
  time: string;
  title: string;
  workspace: string;
}) {
  return (
    <div className={className ?? "max-w-xl"}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-signal">
        <span className="font-numeric">{time}</span>
        <span aria-hidden="true"> · </span>
        {workspace}
      </p>
      <h2 className="mt-layout-sm font-display text-4xl font-light leading-[1.02] text-foreground sm:text-5xl">
        {title}
      </h2>
      <p className="mt-layout-md text-lg leading-8 text-muted-foreground">{copy}</p>
      {automation ? <AutomationBeat>{automation}</AutomationBeat> : null}
    </div>
  );
}

// Each act owns a full viewport: compact scenes sit beside their copy, dense
// workspace exhibits get the full width beneath it.
function StoryAct({
  layout = "split",
  reversed = false,
  children,
  ...copyProps
}: {
  automation?: string;
  children: ReactNode;
  copy: string;
  layout?: "split" | "stacked";
  reversed?: boolean;
  time: string;
  title: string;
  workspace: string;
}) {
  if (layout === "stacked") {
    return (
      <section className="flex min-h-svh items-center border-t border-border/70 px-layout-md py-layout-2xl sm:px-layout-xl">
        <div className="mx-auto w-full max-w-7xl space-y-layout-xl">
          <ActCopy {...copyProps} className="max-w-2xl" />
          {children}
        </div>
      </section>
    );
  }
  return (
    <section className="flex min-h-svh items-center border-t border-border/70 px-layout-md py-layout-2xl sm:px-layout-xl">
      <div
        className={`mx-auto grid w-full max-w-7xl items-center gap-layout-2xl lg:grid-cols-2 ${
          reversed ? "lg:[&>*:first-child]:order-2" : ""
        }`}
      >
        <ActCopy {...copyProps} />
        {children}
      </div>
    </section>
  );
}

export function Index() {
  useForcedLightTheme();
  useEffect(() => {
    emitLandingFunnelEvent("page_view");
  }, []);

  return (
    <PublicLayout trackFunnelCtas>
      <main>
        <section className="relative flex min-h-[calc(100svh-4rem)] items-center overflow-hidden bg-background px-layout-md py-layout-2xl sm:px-layout-xl">
          <div
            className="absolute inset-0 bg-[radial-gradient(circle_at_82%_12%,hsl(var(--signal)/0.08),transparent_38%)]"
            aria-hidden="true"
          />
          <div className="relative mx-auto grid w-full max-w-7xl items-center gap-layout-2xl lg:grid-cols-[0.9fr_1.1fr]">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Athena for owner-led retail
              </p>
              <h1 className="mt-layout-md font-display text-5xl font-light leading-[0.96] text-foreground sm:text-7xl">
                One person. A whole store. Fully in view.
              </h1>
              <p className="mt-layout-lg max-w-xl text-lg leading-8 text-muted-foreground sm:text-xl">
                Athena walks the day with you — from opening the drawer to closing
                the books — so nothing about your store runs on memory.
              </p>
              <div className="mt-layout-xl flex flex-col gap-layout-sm sm:flex-row sm:items-center">
                <DemoCtaButton />
                <span className="text-sm text-muted-foreground">
                  No signup. A working store, open in seconds.
                </span>
              </div>
              <p className="mt-layout-md text-sm text-muted-foreground">
                Prefer a guided tour?{" "}
                <Link
                  to={WALKTHROUGH_PATH}
                  onClick={() => emitLandingFunnelEvent("walkthrough_cta")}
                  className="underline underline-offset-4 transition-colors duration-standard ease-standard hover:text-foreground"
                >
                  Request a walkthrough
                </Link>
                .
              </p>
            </div>
            <HeroDayArcScene />
          </div>
        </section>

        <StoryAct
          time="8:47 AM"
          workspace="Opening Handoff"
          title="Start ready, not scrambling."
          copy="Yesterday doesn't leak into today unresolved. Carry-forward work from last night's close arrives as a checklist, the float is confirmed, and the store day starts from a known state."
          automation="Athena starts the opening and flags anything that needs a manager's eyes."
        >
          <OpeningHandoffScene />
        </StoryAct>

        <StoryAct
          layout="stacked"
          time="11:20 AM"
          workspace="Daily Operations"
          title="One place to stand while the day moves."
          copy="Sales, registers, and anything that needs attention share one view — the place you glance between everything else you're doing."
          automation="Athena watches the day and routes each signal to the workflow that owns the next action."
        >
          <DailyOperationsScene />
        </StoryAct>

        <StoryAct
          time="3:14 PM"
          workspace="Point of Sale"
          title="Sales don't wait for the internet."
          copy="Every sale is recorded on the register first — instantly, on the device. When the connection drops, the counter keeps moving; the sale is safe locally and syncs on its own when the network returns."
          automation="Nothing to export, nothing to re-enter, nothing to remember."
          reversed
        >
          <PosSaleScene />
        </StoryAct>

        <section className="flex min-h-svh items-center border-t border-border/70 bg-surface px-layout-md py-layout-2xl sm:px-layout-xl">
          <div className="mx-auto w-full max-w-7xl">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-signal">
                <span className="font-numeric">3:14 PM</span>
                <span aria-hidden="true"> · </span>
                …and in your books
              </p>
              <h2 className="mt-layout-sm font-display text-4xl font-light leading-[1.02] text-foreground sm:text-5xl">
                Every sale lands twice.
              </h2>
              <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
                Once at the counter, once in your books. The register keeps a local
                record; Athena projects it to the cloud on its own. Moments later the
                same sale is a line in the register session — and the drawer already
                expects the cash.
              </p>
            </div>
            <div className="mt-layout-2xl">
              <SyncBridgeScene />
            </div>
          </div>
        </section>

        <StoryAct
          layout="stacked"
          time="5:40 PM"
          workspace="Cash Controls"
          title="Know what's in every drawer."
          copy="Expected cash builds from the opening float and every synced sale. At close, counted meets expected — variance is surfaced in the moment, not discovered weeks later."
          automation="Athena reconciles synced register activity before closeout is settled."
        >
          <CashControlsScene />
        </StoryAct>

        <StoryAct
          layout="stacked"
          time="8:03 PM"
          workspace="EOD Review"
          title="Close the day with a clear conscience."
          copy="The close runs under store policy: totals settled, the drawer accounted for, and the one thing that needs judgment flagged for you. Anything unfinished carries forward — tomorrow's opening is already prepared."
          automation="Athena prepared the close; you settle what needs judgment."
        >
          <EodReviewScene />
        </StoryAct>

        <section className="flex min-h-svh items-center border-t border-border bg-surface px-layout-md py-layout-2xl sm:px-layout-xl">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-layout-2xl lg:grid-cols-2">
            <div className="max-w-xl">
              <p className="flex items-center gap-layout-sm text-xs font-semibold uppercase tracking-[0.22em] text-signal">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                The day, replayed
              </p>
              <h2 className="mt-layout-sm font-display text-4xl font-light leading-[1.02] text-foreground sm:text-5xl">
                &ldquo;But I&apos;m just one person.&rdquo;
              </h2>
              <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
                You were never running it alone. Athena started the opening, watched
                the registers, synced every sale, flagged the variance, and prepared
                the close — and left every decision to you.
              </p>
            </div>
            <AutomationRevealScene />
          </div>
        </section>

        <section className="flex min-h-svh items-center border-t border-border bg-background px-layout-md py-layout-2xl sm:px-layout-xl">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-layout-xl lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Open the store you just read about
              </p>
              <h2 className="mt-layout-md font-display text-4xl font-light leading-tight text-foreground sm:text-6xl">
                Walk this exact day yourself.
              </h2>
              <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
                The demo opens Osu Studio — the same store, the same registers. No
                signup; it takes seconds.
              </p>
            </div>
            <DemoCtaButton />
          </div>
        </section>
      </main>
    </PublicLayout>
  );
}
