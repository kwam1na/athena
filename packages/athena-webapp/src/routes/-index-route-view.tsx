import { Link } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { createTimeline, cubicBezier } from "animejs";

import dailyOperationsShot from "@/assets/landing/daily-operations-hero.png";
import dailyOperationsShotDark from "@/assets/landing/daily-operations-hero-dark.png";
import dailyOpsMetricsShot from "@/assets/landing/daily-ops-metrics.png";
import dailyOpsMetricsShotDark from "@/assets/landing/daily-ops-metrics-dark.png";
import eodReviewShot from "@/assets/landing/eod-review.png";
import eodReviewShotDark from "@/assets/landing/eod-review-dark.png";
import openingHandoffShot from "@/assets/landing/opening-handoff.png";
import openingHandoffShotDark from "@/assets/landing/opening-handoff-dark.png";
import posPendingShot from "@/assets/landing/pos-pending.png";
import posPendingShotDark from "@/assets/landing/pos-pending-dark.png";
import posSyncedShot from "@/assets/landing/pos-synced.png";
import posSyncedShotDark from "@/assets/landing/pos-synced-dark.png";
import { AutomationRevealScene } from "@/components/landing/story/AutomationRevealScene";
import { CashControlsScene } from "@/components/landing/story/CashControlsScene";
import {
  EvidenceFigure,
  OnePlaceFigure,
  WholeLoopFigure,
} from "@/components/landing/story/ControlLoopFigures";
import { LandingWorkspaceShot } from "@/components/landing/story/LandingWorkspaceShot";
import { RegisterSessionScene } from "@/components/landing/story/RegisterSessionScene";
import { SyncBridgeScene } from "@/components/landing/story/SyncBridgeScene";
import { AutomationBeat } from "@/components/landing/story/SceneChrome";
import { useLandingTheme } from "@/components/landing/story/useLandingTheme";
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

// Hidden starting state for the copy layers: sunk 12px, faded, softened from an
// 8px frost. anime.js tweens these back to rest on mount; declaring them inline
// means no flash of the finished layout before the timeline takes over.
const HERO_COPY_HIDDEN = {
  opacity: 0,
  transform: "translateY(12px)",
  filter: "blur(8px)",
} as const;

function HeroSection() {
  const shotRef = useHeroShotRevealRef();
  // Entrance choreography for the whole hero, driven by a single anime.js
  // timeline: the copy cascades in top-down (eyebrow → headline → subhead →
  // CTA), the glow breathes in behind it, and the shot arrives last as the
  // payoff. Per-element positions on the timeline set the rhythm. Honors
  // reduced-motion by snapping everything to its resting state.
  const eyebrowRef = useRef<HTMLParagraphElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subheadRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const shotWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const eyebrow = eyebrowRef.current;
    const headline = headlineRef.current;
    const subhead = subheadRef.current;
    const cta = ctaRef.current;
    const glow = glowRef.current;
    const shot = shotWrapRef.current;
    if (!eyebrow || !headline || !subhead || !cta || !glow || !shot) return;

    const rest = (el: HTMLElement) => {
      el.style.opacity = "1";
      el.style.transform = "none";
      el.style.filter = "none";
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      [eyebrow, headline, subhead, cta, glow, shot].forEach(rest);
      return;
    }

    // Rise + fade + sharpen, one shared ease. Copy staggers by ~280ms; the
    // shot rises from further down and lingers longest. START holds the hidden
    // frame for half a second before anything moves.
    const ease = cubicBezier(0.22, 1, 0.36, 1);
    const rise = { opacity: [0, 1], translateY: [12, 0], filter: ["blur(8px)", "blur(0px)"] };
    const START = 500;

    const timeline = createTimeline({ defaults: { ease } });
    timeline
      .add(glow, { opacity: [0, 1], duration: 3600 }, START)
      .add(eyebrow, { ...rise, duration: 1400 }, START)
      .add(headline, { ...rise, duration: 1500 }, START + 280)
      .add(subhead, { ...rise, duration: 1500 }, START + 560)
      .add(cta, { ...rise, duration: 1500 }, START + 840)
      .add(shot, { opacity: [0, 1], translateY: [40, 0], duration: 2400 }, START + 1100);

    return () => {
      timeline.pause();
    };
  }, []);

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-background via-background to-app-canvas px-layout-md pb-layout-2xl sm:px-layout-xl">
      {/* Primary-tinted glow breathes in slowly behind the copy. */}
      <div
        ref={glowRef}
        className="absolute inset-0 bg-[radial-gradient(circle_at_82%_12%,hsl(var(--primary)/0.08),transparent_38%)]"
        style={{ opacity: 0 }}
        aria-hidden="true"
      />
      {/* Hero content — blurb and shot — nudged up ~10% together. */}
      <div className="relative mx-auto w-full max-w-7xl -translate-y-[10vh]">
        {/* Blurb centered in the first screen, cascading in top-down. */}
        <div className="flex h-[calc(100svh-4rem)] flex-col items-center justify-center text-center">
          <div className="max-w-2xl">
            <p
              ref={eyebrowRef}
              style={HERO_COPY_HIDDEN}
              className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground"
            >
              For the owner who can&apos;t be everywhere
            </p>
            <h1
              ref={headlineRef}
              style={HERO_COPY_HIDDEN}
              className="mt-layout-md font-display text-5xl font-light leading-[0.96] text-foreground sm:text-7xl"
            >
              The day runs itself. Only what matters reaches you.
            </h1>
            <p
              ref={subheadRef}
              style={HERO_COPY_HIDDEN}
              className="mx-auto mt-layout-lg max-w-xl text-lg leading-8 text-muted-foreground sm:text-xl"
            >
              Athena carries the store from opening float to final count — and
              asks for you only when something needs your judgment.
            </p>
            <div
              ref={ctaRef}
              style={HERO_COPY_HIDDEN}
              className="mt-layout-xl flex flex-col items-center gap-layout-sm sm:flex-row sm:justify-center"
            >
              <DemoCtaButton />
              <span className="text-sm text-muted-foreground">
                No signup. A working store, open in seconds.
              </span>
            </div>
          </div>
        </div>

        {/* Hero shot peeks above the fold, then reveals to full opacity on scroll. */}
        <div ref={shotWrapRef} className="-mt-[22vh]" style={{ opacity: 0 }}>
          <div
            ref={shotRef}
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
              srcDark={dailyOperationsShotDark}
              width={3840}
            />
          </div>
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
    title: "One place for the whole store",
    copy: "The counter, stockroom, orders, and cash drawer share one system — no sales notebook, no piles of receipts, no totals tallied by hand after close.",
  },
  {
    Figure: WholeLoopFigure,
    title: "The daily loop, end to end",
    copy: "Open the store, sell, watch the day, reconcile the drawer, close the books — one workspace for each step, and each step feeding the next.",
  },
  {
    Figure: EvidenceFigure,
    title: "Evidence you can trust",
    copy: "Register sessions, cash counts, and approvals leave a trail as the day runs — so “what happened?” always has an answer.",
  },
] as const;

// A tiled fractal-noise SVG, rendered once and repeated as a background. The
// page tells a paper-to-system story, so the whole surface carries a faint
// paper grain — fixed so copy, canvas panels, and screenshots all share it.
const GRAIN_TILE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E")`;

function LandingGrain() {
  return (
    <div
      aria-hidden="true"
      // The tile is black noise; on charcoal it must be inverted to read as
      // light grain, and eased down so it stays a whisper.
      className="pointer-events-none fixed inset-0 z-[70] opacity-[0.08] dark:opacity-[0.05] dark:[filter:invert(1)]"
      style={{ backgroundImage: GRAIN_TILE }}
    />
  );
}

function ControlLoopSection() {
  return (
    <section className="relative bg-app-canvas px-layout-md pb-[8rem] pt-[8rem] sm:px-layout-xl">
      {/* Ledger-paper dot grid, fading out from the center — a quiet nod to
          the sales notebook this section says you no longer need. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 text-foreground/[0.16] [mask-image:radial-gradient(110%_80%_at_50%_52%,black_30%,transparent_72%)]"
        style={{
          backgroundImage:
            "radial-gradient(currentColor 1px, transparent 1.5px)",
          backgroundSize: "26px 26px",
        }}
      />
      <div className="relative mx-auto w-full max-w-7xl">
        <h2 className="max-w-4xl font-display text-3xl font-light leading-[1.15] sm:text-4xl md:text-5xl">
          <span className="text-foreground">
            The daily control loop of a business, in one place.
          </span>{" "}
          <span className="text-muted-foreground">
            Athena is an operating system for an owner-led store — sell in
            person and online, track stock, fulfill orders, and manage cash,
            with enough evidence to trust the day without watching it happen.
          </span>
        </h2>

        <div className="mt-24 grid grid-cols-1 gap-x-layout-xl gap-y-layout-2xl md:grid-cols-3">
          {CONTROL_LOOP_PILLARS.map(({ Figure, title, copy }) => (
            <div
              key={title}
              className="flex flex-col border-t border-border pt-layout-md md:border-l md:border-t-0 md:pl-layout-lg md:pt-0 md:first:border-l-0 md:first:pl-0"
            >
              {/* Fixed-height band (not flex-1) so the three titles below sit on one line. */}
              <div className="flex h-[220px] items-center justify-center py-layout-xl text-foreground/80">
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
        className={`flex min-h-svh items-start ${topBorder} px-layout-md pb-[8rem] pt-[8rem] sm:px-layout-xl ${background ?? ""}`}
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
      className={`flex min-h-svh items-start ${topBorder} px-layout-md pb-[8rem] pt-[8rem] sm:px-layout-xl`}
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
  // Honor the visitor's light/dark choice; pin dark to charcoal to match the
  // captured shots. The nav's toggle (below) flips the mode.
  useLandingTheme();
  useEffect(() => {
    emitLandingFunnelEvent("page_view");
  }, []);

  return (
    <PublicLayout trackFunnelCtas hideSecondaryNav showThemeToggle>
      <LandingGrain />
      <main>
        <HeroSection />

        <ControlLoopSection />

        <StoryAct
          hideTopBorder
          background="bg-app-canvas"
          layout="stacked"
          stackedGap="space-y-layout-3xl"
          workspace="Opening Handoff"
          title="Today opens where yesterday closed."
          copy="Yesterday doesn't leak into today unresolved. Your staff open the store; carry-forward work from last night's close arrives as their checklist, the float is confirmed, and the day starts from a known state — visible to you before you've walked in, or without walking in at all."
          automation="Athena starts the opening and flags anything that needs a manager's eyes."
        >
          <LandingWorkspaceShot
            alt="Athena's Opening Handoff workspace on a Wednesday morning: the prior day's close cleared, a carried-forward inventory review, and the store day started automatically by Athena."
            bordered={false}
            className="max-w-none"
            height={2624}
            src={openingHandoffShot}
            srcDark={openingHandoffShotDark}
            width={3072}
          />
        </StoryAct>

        <StoryAct
          background="bg-app-canvas"
          layout="stacked"
          stackedGap="space-y-layout-3xl"
          workspace="Daily Operations"
          title="The whole day's pulse, in one read."
          copy="How the week is tracking, today's trend and best-sellers, how customers are paying, and every sale the moment it syncs — the store's rhythm in full, whether you're on the floor or nowhere near it."
          automation="The numbers keep themselves current as sales sync from the counter — to wherever you're reading them."
        >
          <LandingWorkspaceShot
            alt="Athena's Daily Operations workspace: today's money tiles, the week's sales at a glance, today's sales trend, top items and payment mix, and the live activity timeline."
            bordered={false}
            className="max-w-none"
            height={2720}
            src={dailyOpsMetricsShot}
            srcDark={dailyOpsMetricsShotDark}
            width={3072}
          />
        </StoryAct>

        <StoryAct
          background="bg-background"
          layout="stacked"
          stackedGap="space-y-layout-3xl"
          workspace="Point of Sale"
          title="The network drops. Sales don't."
          copy="Every sale lands on the device first, instantly. Lose the connection and the counter keeps moving — the sale is held safe, then syncs itself the moment the network returns."
          automation="No manual sync, no re-entry, nothing to remember."
        >
          <div className="w-full space-y-layout-xl">
            <div className="max-w-5xl">
              <LandingWorkspaceShot
                alt="The register's POS status reading 'pending sync' — a sale just recorded on the device, held safely before it uploads."
                className="max-w-5xl"
                cropHeightFraction={0.52}
                height={853}
                src={posPendingShot}
                srcDark={posPendingShotDark}
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
                srcDark={posSyncedShotDark}
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

        <section className="flex min-h-svh items-start border-t border-border/70 bg-surface px-layout-md pb-[8rem] pt-[8rem] sm:px-layout-xl">
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
          <>
            <CashControlsScene />
            {/* Drill from the dashboard into the session it holds in review. */}
            <div className="max-w-2xl pt-[12rem]">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                The thread of the day
              </p>
              <h3 className="mt-layout-sm font-display text-3xl font-light leading-[1.05] text-foreground sm:text-4xl">
                One drawer, the whole day on record.
              </h3>
              <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
                A register session isn't a loose till — it's the thread that
                ties the day together. It opens against a float, every synced
                sale lands on it in the moment, and its expected total builds
                itself. At close, the count meets that record, any difference is
                surfaced for judgment instead of buried, and the settled session
                flows straight into the day's reconciliation and the bank
                deposit.
              </p>
            </div>
            {/* Breathing room between the blurb and the session it introduces. */}
            <div className="pt-layout-2xl">
              <RegisterSessionScene />
            </div>
          </>
        </StoryAct>

        <StoryAct
          background="bg-app-canvas"
          layout="stacked"
          stackedGap="space-y-layout-3xl"
          workspace="EOD Review"
          title="Close the day with a clear conscience."
          copy="The close runs under store policy: totals settled, the drawer accounted for, and the one thing that needs judgment flagged for you — reviewable from the back office or from home. Anything unfinished carries forward; tomorrow's opening is already prepared, and no one waited on you to lock up."
          automation="Athena prepared the close; you settle what needs judgment."
        >
          <LandingWorkspaceShot
            alt="Athena's EOD Review workspace on Wednesday evening: the day's net sales, cash, card and mobile money, a small approved cash variance, and the Kente inventory review carried into tomorrow's opening."
            bordered={false}
            className="max-w-none"
            height={2458}
            src={eodReviewShot}
            srcDark={eodReviewShotDark}
            width={3072}
          />
        </StoryAct>

        <section className="flex min-h-svh items-center border-t border-border bg-surface px-layout-md pb-[8rem] pt-[8rem] sm:px-layout-xl">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-layout-2xl lg:grid-cols-2">
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                The day, replayed
              </p>
              <h2 className="mt-layout-sm font-display text-4xl font-light leading-[1.02] text-foreground sm:text-5xl">
                The day didn&apos;t run itself.
              </h2>
              <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
                Athena did. It started the opening, watched the registers,
                synced every sale, and prepared the close — settling what store
                policy allows, and bringing you only the calls that needed you.
                You saw all of it, even the hours you were nowhere near the
                store.
              </p>
            </div>
            <AutomationRevealScene />
          </div>
        </section>

        <section className="flex items-start border-t border-border bg-background px-layout-md pb-[8rem] pt-[8rem] sm:px-layout-xl">
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
