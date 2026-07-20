import { Link } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";

import dailyOperationsShot from "@/assets/landing/daily-operations-hero.png";
import dailyOpsMetricsShot from "@/assets/landing/daily-ops-metrics.png";
import eodReviewShot from "@/assets/landing/eod-review.png";
import openingHandoffShot from "@/assets/landing/opening-handoff.png";
import posPendingShot from "@/assets/landing/pos-pending.png";
import posSyncedShot from "@/assets/landing/pos-synced.png";
import { AutomationRevealScene } from "@/components/landing/story/AutomationRevealScene";
import { CashControlsScene } from "@/components/landing/story/CashControlsScene";
import {
  EvidenceFigure,
  OnePlaceFigure,
  WholeLoopFigure,
} from "@/components/landing/story/ControlLoopFigures";
import { LandingWorkspaceShot } from "@/components/landing/story/LandingWorkspaceShot";
import { SyncBridgeScene } from "@/components/landing/story/SyncBridgeScene";
import { AutomationBeat } from "@/components/landing/story/SceneChrome";
import { useForcedLightTheme } from "@/components/landing/story/useForcedLightTheme";
import { emitLandingFunnelEvent } from "@/lib/marketing/landingFunnelClient";
import { DEMO_PATH } from "@/lib/navigation/appEntryRoutes";
import { PublicLayout } from "./-public-layout";

// Scroll-linked reveal for the hero shot: it starts faint while only its top
// edge peeks above the fold, then ramps to full opacity as the reader scrolls
// and it comes into view. Honors reduced-motion by rendering fully opaque.
const HERO_SHOT_MIN_OPACITY = 0.35;
const HERO_SHOT_MIN_SCALE = 0.9;
// Fraction of a viewport the reader scrolls before the shot is fully revealed.
const HERO_SHOT_REVEAL_VH = 0.55;

function useHeroShotRevealRef() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.opacity = "1";
      el.style.transform = "none";
      return;
    }

    let raf = 0;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight || 1;
      // 0 at the top of the page (shot faint, only peeking); 1 once the reader
      // has scrolled ~half a viewport and the shot has come into view.
      const progress = window.scrollY / (vh * HERO_SHOT_REVEAL_VH);
      const clamped = Math.min(1, Math.max(0, progress));
      // Subtle ease-out: reveal moves a touch quicker early, then settles.
      const eased = 1 - Math.pow(1 - clamped, 1.6);
      el.style.opacity = String(
        HERO_SHOT_MIN_OPACITY + (1 - HERO_SHOT_MIN_OPACITY) * eased,
      );
      // Grow from slightly small to full size as it comes into view.
      el.style.transform = `scale(${
        HERO_SHOT_MIN_SCALE + (1 - HERO_SHOT_MIN_SCALE) * eased
      })`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return ref;
}

function DemoCtaButton() {
  return (
    <Link
      to={DEMO_PATH}
      onClick={() => emitLandingFunnelEvent("demo_cta")}
      className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-layout-lg text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-standard ease-standard hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      Try the demo
      <ArrowRight className="ml-layout-sm h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

function HeroSection() {
  const shotRef = useHeroShotRevealRef();

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-background via-background to-app-canvas px-layout-md pb-layout-2xl sm:px-layout-xl">
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_82%_12%,hsl(var(--primary)/0.08),transparent_38%)]"
        aria-hidden="true"
      />
      {/* Hero content — blurb and shot — nudged up ~10% together. */}
      <div className="relative mx-auto w-full max-w-7xl -translate-y-[10vh]">
        {/* Blurb centered in the first screen. */}
        <div className="flex h-[calc(100svh-4rem)] flex-col items-center justify-center text-center">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Athena for owner-led retail
            </p>
            <h1 className="mt-layout-md font-display text-5xl font-light leading-[0.96] text-foreground sm:text-7xl">
              One person. A whole store. Fully in view.
            </h1>
            <p className="mx-auto mt-layout-lg max-w-xl text-lg leading-8 text-muted-foreground sm:text-xl">
              Athena walks the day with you — from opening the drawer to closing
              the books — so nothing about your store runs on memory.
            </p>
            <div className="mt-layout-xl flex flex-col items-center gap-layout-sm sm:flex-row sm:justify-center">
              <DemoCtaButton />
              <span className="text-sm text-muted-foreground">
                No signup. A working store, open in seconds.
              </span>
            </div>
          </div>
        </div>

        {/* Hero shot peeks above the fold, then reveals to full opacity on scroll. */}
        <div
          ref={shotRef}
          className="-mt-[22vh]"
          style={{
            opacity: HERO_SHOT_MIN_OPACITY,
            transform: `scale(${HERO_SHOT_MIN_SCALE})`,
          }}
        >
          <LandingWorkspaceShot
            alt="Athena's Daily Operations workspace mid-week: a pending approval, the open register, today's net sales, cash, card and mobile money, and the week at a glance."
            className="max-w-7xl"
            eager
            height={2356}
            src={dailyOperationsShot}
            width={3840}
          />
        </div>
      </div>
    </section>
  );
}

// The goal statement between the hero and the workspace sections: what Athena
// is for, drawn from the repo README, with three isometric FIG illustrations.
const CONTROL_LOOP_PILLARS = [
  {
    Figure: OnePlaceFigure,
    title: "One place, not twelve tools",
    copy: "The counter, the stockroom, the orders, and the cash drawer share one system — no spreadsheet glue, no numbers copied between apps after close.",
  },
  {
    Figure: WholeLoopFigure,
    title: "The daily loop, end to end",
    copy: "Open the store, sell, watch the day, reconcile the drawer, close the books. The story below walks that exact loop, one workspace at a time.",
  },
  {
    Figure: EvidenceFigure,
    title: "Evidence you can trust",
    copy: "Register sessions, cash counts, and approvals leave a trail as the day runs — so “what happened?” always has an answer.",
  },
] as const;

function ControlLoopSection() {
  return (
    <section className="bg-app-canvas px-layout-md py-32 sm:px-layout-xl">
      <div className="mx-auto w-full max-w-7xl">
        <h2 className="max-w-4xl font-display text-3xl font-light leading-[1.15] sm:text-4xl md:text-5xl">
          <span className="text-foreground">
            The daily control loop of a business, in one place.
          </span>{" "}
          <span className="text-muted-foreground">
            Athena is an operating system for a solo owner — sell in person and
            online, track stock, fulfill orders, and manage cash, with enough
            evidence to trust what happened without becoming a full-time systems
            operator.
          </span>
        </h2>

        <div className="mt-24 grid grid-cols-1 gap-x-layout-xl gap-y-layout-2xl md:grid-cols-3">
          {CONTROL_LOOP_PILLARS.map(({ Figure, title, copy }) => (
            <div
              key={title}
              className="flex flex-col border-t border-border pt-layout-md md:border-l md:border-t-0 md:pl-layout-lg md:pt-0 md:first:border-l-0 md:first:pl-0"
            >
              <div className="flex min-h-[220px] flex-1 items-center justify-center py-layout-xl text-foreground/80">
                <Figure className="h-auto w-full max-w-[220px]" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                {title}
              </h3>
              <p className="mt-layout-2xs max-w-xs text-sm leading-6 text-muted-foreground">
                {copy}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ActCopy({
  workspace,
  title,
  copy,
  automation,
  className,
}: {
  automation?: string;
  className?: string;
  copy: string;
  title: string;
  workspace: string;
}) {
  return (
    <div className={className ?? "max-w-xl"}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
        {workspace}
      </p>
      <h2 className="mt-layout-sm font-display text-4xl font-light leading-[1.02] text-foreground sm:text-5xl">
        {title}
      </h2>
      <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
        {copy}
      </p>
      {automation ? <AutomationBeat>{automation}</AutomationBeat> : null}
    </div>
  );
}

// Each act owns a full viewport: compact scenes sit beside their copy, dense
// workspace exhibits get the full width beneath it.
function StoryAct({
  layout = "split",
  reversed = false,
  background,
  hideTopBorder = false,
  stackedGap = "space-y-layout-xl",
  children,
  ...copyProps
}: {
  automation?: string;
  background?: string;
  children: ReactNode;
  copy: string;
  hideTopBorder?: boolean;
  layout?: "split" | "stacked";
  reversed?: boolean;
  stackedGap?: string;
  title: string;
  workspace: string;
}) {
  const topBorder = hideTopBorder ? "" : "border-t border-border/70";
  if (layout === "stacked") {
    return (
      <section
        className={`flex min-h-svh items-center ${topBorder} px-layout-md pb-32 pt-32 sm:px-layout-xl ${background ?? ""}`}
      >
        <div className={`mx-auto w-full max-w-7xl ${stackedGap}`}>
          <ActCopy {...copyProps} className="max-w-2xl" />
          {children}
        </div>
      </section>
    );
  }
  return (
    <section
      className={`flex min-h-svh items-center ${topBorder} px-layout-md pb-32 pt-32 sm:px-layout-xl`}
    >
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
    <PublicLayout trackFunnelCtas hideSecondaryNav>
      <main>
        <HeroSection />

        <ControlLoopSection />

        <StoryAct
          hideTopBorder
          background="bg-app-canvas"
          layout="stacked"
          stackedGap="space-y-layout-3xl"
          workspace="Opening Handoff"
          title="Start ready, not scrambling."
          copy="Yesterday doesn't leak into today unresolved. Carry-forward work from last night's close arrives as a checklist, the float is confirmed, and the store day starts from a known state."
          automation="Athena starts the opening and flags anything that needs a manager's eyes."
        >
          <LandingWorkspaceShot
            alt="Athena's Opening Handoff workspace on a Wednesday morning: the prior day's close cleared, a carried-forward inventory review, and the store day started automatically by Athena."
            bordered={false}
            className="max-w-none"
            height={2624}
            src={openingHandoffShot}
            width={3072}
          />
        </StoryAct>

        <StoryAct
          background="bg-app-canvas"
          layout="stacked"
          stackedGap="space-y-layout-3xl"
          workspace="Daily Operations"
          title="The whole day's pulse, in one read."
          copy="How the week is tracking, today's trend and best-sellers, how customers are paying, and every sale the moment it syncs — the rhythm of the day without a single spreadsheet."
          automation="The numbers keep themselves current as sales sync from the counter."
        >
          <LandingWorkspaceShot
            alt="Athena's Daily Operations workspace: today's money tiles, the week's sales at a glance, today's sales trend, top items and payment mix, and the live activity timeline."
            bordered={false}
            className="max-w-none"
            height={2792}
            src={dailyOpsMetricsShot}
            width={3072}
          />
        </StoryAct>

        <StoryAct
          background="bg-background"
          layout="stacked"
          stackedGap="space-y-layout-3xl"
          workspace="Point of Sale"
          title="Sales don't wait for the internet."
          copy="Every sale is recorded on the register first — instantly, on the device. When the connection drops, the counter keeps moving; the sale is safe locally and syncs on its own when the network returns."
          automation="Nothing to export, nothing to re-enter, nothing to remember."
        >
          <div className="w-full space-y-layout-xl">
            <div className="max-w-5xl">
              <LandingWorkspaceShot
                alt="The register's POS status reading 'pending sync' — a sale just recorded on the device, held safely before it uploads."
                className="max-w-5xl"
                cropHeightFraction={0.52}
                height={853}
                src={posPendingShot}
                width={2000}
              />
              <p className="mt-layout-sm flex items-start gap-layout-sm text-sm leading-6 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="mt-[8px] h-2 w-2 shrink-0 rounded-full bg-warning"
                />
                3:14 PM — the connection drops. The finished sale is held safely
                on the device.
              </p>
            </div>
            <div className="ml-auto max-w-5xl">
              <LandingWorkspaceShot
                alt="The register's POS status reading 'synced' — the sale uploaded on its own once the connection returned."
                className="max-w-5xl"
                cropHeightFraction={0.52}
                height={853}
                src={posSyncedShot}
                width={2000}
              />
              <p className="mt-layout-sm flex items-start gap-layout-sm text-sm leading-6 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="mt-[8px] h-2 w-2 shrink-0 rounded-full bg-success"
                />
                Minutes later — back online. The sale synced on its own,
                straight into the day&apos;s numbers.
              </p>
            </div>
          </div>
        </StoryAct>

        <section className="flex min-h-svh items-center border-t border-border/70 bg-surface px-layout-md py-layout-2xl sm:px-layout-xl">
          <div className="mx-auto w-full max-w-7xl">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                Counter to books
              </p>
              <h2 className="mt-layout-sm font-display text-4xl font-light leading-[1.02] text-foreground sm:text-5xl">
                Every sale lands twice.
              </h2>
              <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
                Made once at the counter, the same sale lands again in your
                books — a line in the register session, counted toward the day's
                totals, with the drawer already expecting the cash. The till and
                the ledger never fall out of step.
              </p>
            </div>
            <div className="mt-layout-2xl">
              <SyncBridgeScene />
            </div>
          </div>
        </section>

        <StoryAct
          layout="stacked"
          background="bg-app-canvas"
          workspace="Cash Controls"
          title="Know what's in every drawer."
          copy="Expected cash builds from the opening float and every synced sale. At close, counted meets expected — variance is surfaced in the moment, not discovered weeks later."
          automation="Athena reconciles synced register activity before closeout is settled."
        >
          <CashControlsScene />
        </StoryAct>

        <StoryAct
          background="bg-app-canvas"
          layout="stacked"
          stackedGap="space-y-layout-3xl"
          workspace="EOD Review"
          title="Close the day with a clear conscience."
          copy="The close runs under store policy: totals settled, the drawer accounted for, and the one thing that needs judgment flagged for you. Anything unfinished carries forward — tomorrow's opening is already prepared."
          automation="Athena prepared the close; you settle what needs judgment."
        >
          <LandingWorkspaceShot
            alt="Athena's EOD Review workspace on Wednesday evening: the day's net sales, cash, card and mobile money, a small approved cash variance, and the Kente inventory review carried into tomorrow's opening."
            bordered={false}
            className="max-w-none"
            height={2396}
            src={eodReviewShot}
            width={3072}
          />
        </StoryAct>

        <section className="flex min-h-svh items-center border-t border-border bg-surface px-layout-md py-layout-2xl sm:px-layout-xl">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-layout-2xl lg:grid-cols-2">
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                The day, replayed
              </p>
              <h2 className="mt-layout-sm font-display text-4xl font-light leading-[1.02] text-foreground sm:text-5xl">
                &ldquo;But I&apos;m just one person.&rdquo;
              </h2>
              <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
                You were never running it alone. Athena started the opening,
                watched the registers, synced every sale, flagged the variance,
                and prepared the close — and left every decision to you.
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
                The demo opens Osu Studio — the same store, the same registers.
                No signup; it takes seconds.
              </p>
            </div>
            <DemoCtaButton />
          </div>
        </section>
      </main>
    </PublicLayout>
  );
}
