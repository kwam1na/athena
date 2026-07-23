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
import posRegisterReadyShot from "@/assets/landing/pos-register-ready.png";
import posRegisterReadyShotDark from "@/assets/landing/pos-register-ready-dark.png";
import posSyncedShot from "@/assets/landing/pos-synced.png";
import posSyncedShotDark from "@/assets/landing/pos-synced-dark.png";
import { LandingGrain } from "@/components/landing/LandingGrain";
import { AutomationRevealScene } from "@/components/landing/story/AutomationRevealScene";
import { CashControlsScene } from "@/components/landing/story/CashControlsScene";
import {
  EvidenceFigure,
  OnePlaceFigure,
  WholeLoopFigure,
} from "@/components/landing/story/ControlLoopFigures";
import { LandingWorkspaceShot } from "@/components/landing/story/LandingWorkspaceShot";
import { PosHubRoleSwitcher } from "@/components/landing/story/PosHubRoleSwitcher";
import { RegisterSessionScene } from "@/components/landing/story/RegisterSessionScene";
import { SyncBridgeScene } from "@/components/landing/story/SyncBridgeScene";
import { AutomationBeat } from "@/components/landing/story/SceneChrome";
import { useLandingTheme } from "@/components/landing/story/useLandingTheme";
import { emitLandingFunnelEvent } from "@/lib/marketing/landingFunnelClient";
import { DEMO_PATH, WALKTHROUGH_PATH } from "@/lib/navigation/appEntryRoutes";
import { PublicLayout } from "./-public-layout";
import { Button } from "../components/ui/button";

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
      el.style.transform = `scale(${HERO_SHOT_MIN_SCALE + (1 - HERO_SHOT_MIN_SCALE) * eased
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
      Demo Athena
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
    const rise = {
      opacity: [0, 1],
      translateY: [12, 0],
      filter: ["blur(8px)", "blur(0px)"],
    };
    const START = 500;

    const timeline = createTimeline({ defaults: { ease } });
    timeline
      .add(glow, { opacity: [0, 1], duration: 3600 }, START)
      .add(eyebrow, { ...rise, duration: 1400 }, START)
      .add(headline, { ...rise, duration: 1500 }, START + 280)
      .add(subhead, { ...rise, duration: 1500 }, START + 560)
      .add(cta, { ...rise, duration: 1500 }, START + 840)
      .add(
        shot,
        { opacity: [0, 1], translateY: [40, 0], duration: 2400 },
        START + 1100,
      );

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
      {/* Hero content — blurb and shot — nudged up ~10% together on desktop.
          On mobile the blurb fills (or exceeds) the first screen, so the
          desktop-only upward nudge and fixed height are dropped to avoid the
          shot colliding with the CTA. */}
      <div className="relative mx-auto w-full max-w-7xl sm:-translate-y-[10vh]">
        {/* Blurb centered in the first screen, cascading in top-down. */}
        <div className="flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center text-center">
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
              className="mt-layout-md text-balance font-display text-5xl font-light leading-[0.96] text-foreground sm:text-7xl"
            >
              The day runs itself. You see all of it — from anywhere.
            </h1>
            <p
              ref={subheadRef}
              style={HERO_COPY_HIDDEN}
              className="mx-auto mt-layout-lg max-w-xl text-lg leading-8 text-muted-foreground sm:text-xl"
            >
              Athena runs the till, the stock, and the cash for your store, from
              opening to the final count, and asks for you only when something
              needs your judgment.
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

        {/* Hero shot peeks above the fold on desktop, then reveals to full
            opacity on scroll. On mobile the blurb leaves no room to peek into,
            so the shot follows it with a normal gap instead of overlapping. */}
        <div ref={shotWrapRef} className="mt-layout-2xl sm:-mt-[22vh]" style={{ opacity: 0 }}>
          <div
            ref={shotRef}
            style={{
              opacity: HERO_SHOT_MIN_OPACITY,
              transform: `scale(${HERO_SHOT_MIN_SCALE})`,
            }}
          >
            <LandingWorkspaceShot
              alt="Athena's Daily Operations workspace mid-week: a pending approval, the open register, today's net sales, cash, card and mobile money tiles, and the week at a glance with Wednesday selected."
              className="max-w-7xl"
              eager
              height={2350}
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
    copy: "The counter, stockroom, orders, and cash drawer share one system: no sales notebook, no piles of receipts, no totals tallied by hand after close.",
  },
  {
    Figure: WholeLoopFigure,
    title: "The daily loop, end to end",
    copy: "Open the store, sell, watch the day, reconcile the drawer, close the books: one workspace for each step, and each step feeding the next.",
  },
  {
    Figure: EvidenceFigure,
    title: "Evidence you can trust",
    copy: "Register sessions, cash counts, and approvals leave a trail as the day runs, so “what happened?” always has an answer.",
  },
] as const;

// Faint horizontal ruling, like the feint lines of a ledger page — used behind
// the bookkeeping acts. Masked so it breathes in from an edge rather than
// covering the whole section.
function LedgerRules({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 text-foreground/[0.14] ${className ?? ""}`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(to bottom, currentColor 0, currentColor 1px, transparent 1px, transparent 44px)",
      }}
    />
  );
}

function ControlLoopSection() {
  return (
    <section className="relative overflow-hidden bg-app-canvas px-layout-md pb-[8rem] pt-[8rem] sm:px-layout-xl">
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
            A store&apos;s whole day, in one place.
          </span>{" "}
          <span className="text-muted-foreground">
            Athena is an operating system for an owner-led store: sell in person
            and online, track stock, fulfill orders, and manage cash, with
            enough evidence to trust the day without watching it happen.
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

        {/* Names the narrative device the rest of the page runs on — one
            specific day at one specific store — and sets up the closing CTA's
            "walk this exact day yourself." */}
        <p className="mt-layout-2xl max-w-2xl text-lg leading-8 text-muted-foreground">
          What follows is one day under Athena, from open to close at Osu
          Studio, a fictional artisanal store in Accra.
        </p>
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
  texture,
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
  texture?: ReactNode;
  title: string;
  workspace: string;
}) {
  const topBorder = hideTopBorder ? "" : "border-t border-border/70";
  if (layout === "stacked") {
    return (
      <section
        className={`relative flex min-h-svh items-start overflow-hidden ${topBorder} px-layout-md pb-[8rem] pt-[8rem] sm:px-layout-xl ${background ?? ""}`}
      >
        {texture}
        <div className={`relative mx-auto w-full max-w-7xl ${stackedGap}`}>
          <ActCopy {...copyProps} className="max-w-2xl" />
          {children}
        </div>
      </section>
    );
  }
  return (
    <section
      className={`relative flex min-h-svh items-start overflow-hidden ${topBorder} px-layout-md pb-[8rem] pt-[8rem] sm:px-layout-xl ${background ?? ""}`}
    >
      {texture}
      <div
        className={`relative mx-auto grid w-full max-w-7xl items-center gap-layout-2xl lg:grid-cols-2 ${reversed ? "lg:[&>*:first-child]:order-2" : ""
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
      {/* Every exhibit on this page reserves its space (explicit width/height),
          so browser scroll anchoring has nothing to protect against — but it
          does misfire on the POS hub role switcher, whose two shots differ by
          ~2400px: with an anchor node picked from a section below the act, the
          swap yanks the viewport. Exclude the whole page from anchor selection. */}
      <main className="[overflow-anchor:none]">
        <HeroSection />

        <ControlLoopSection />

        <StoryAct
          hideTopBorder
          background="bg-app-canvas"
          layout="stacked"
          stackedGap="space-y-layout-3xl"
          workspace="Opening Handoff"
          title="Today opens where yesterday closed."
          copy="Yesterday doesn't leak into today unresolved. Your staff open the store; anything left unfinished at last night's close arrives as their checklist, the opening cash is confirmed, and the day starts from a known state, visible to you before you've walked in, or without walking in at all."
          automation="Under your rules, Athena completes the opening itself and flags only what needs a manager's eyes."
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
          copy="How the week is tracking, today's trend and best-sellers, how customers are paying, and every sale the moment it syncs: the store's rhythm in full, whether you're on the floor or nowhere near it."
          automation="The numbers keep themselves current as sales sync from the counter to wherever you're reading them."
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
          background="bg-app-canvas"
          layout="stacked"
          stackedGap="space-y-layout-3xl"
          workspace="Point of Sale"
          title="One register, two views."
          copy="Everything the counter needs, in one hub. Staff see their tools; you see the whole pulse — today to all time."
          automation="Every synced sale updates the pulse on its own; nothing to refresh, nothing to tally."
          texture={
            // The hub shot's own canvas backdrop sits flush on the canvas
            // section so it reads as the page, not a card; the section's foot
            // then melts into white so the next act's background flows in.
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
          }
        >
          <PosHubRoleSwitcher />
        </StoryAct>

        <StoryAct
          hideTopBorder
          background="bg-background"
          layout="stacked"
          stackedGap="space-y-layout-3xl"
          workspace="Device-first"
          title="The network drops. Sales don't."
          copy="A sale starts at the counter and lands on the device first, instantly. Lose the connection and the counter keeps moving: the sale is held safe, then syncs itself the moment the network returns."
          automation="No manual sync, no re-entry, nothing to remember."
        >
          <div className="w-full space-y-layout-3xl">
            {/* Establishing beat: the full register, clear and waiting, one
                minute before the traced 3:14 PM sale the next two beats follow. */}
            <div>
              <LandingWorkspaceShot
                alt="The POS register ready for the next sale: an empty cart, a fresh sale started, and the product lookup entry in focus."
                bordered={false}
                className="max-w-none"
                height={1318}
                src={posRegisterReadyShot}
                srcDark={posRegisterReadyShotDark}
                width={2506}
              />
              <p className="mt-layout-sm flex items-start gap-layout-sm text-sm leading-6 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="mt-[8px] h-2 w-2 shrink-0 rounded-full bg-primary"
                />
                3:13 PM — the counter is clear and the lookup is in focus. The
                next customer is already walking up.
              </p>
            </div>
            <div className="max-w-5xl">
              <LandingWorkspaceShot
                alt="The register's POS status reading 'pending sync': a sale just recorded on the device, held safely before it uploads."
                bordered={false}
                className="max-w-5xl"
                cropHeightFraction={0.52}
                fadeBottom
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
                alt="The register's POS status reading 'synced': the sale uploaded on its own once the connection returned."
                bordered={false}
                className="max-w-5xl"
                cropHeightFraction={0.52}
                fadeBottom
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

        <section className="relative flex min-h-svh items-start overflow-hidden border-t border-border/70 bg-surface px-layout-md pb-[8rem] pt-[8rem] sm:px-layout-xl">
          {/* Ledger ruling fades in from the right edge — the "books" side of
              the counter-to-books bridge. */}
          <LedgerRules className="[mask-image:linear-gradient(to_left,black,transparent_20%)]" />
          <div className="relative mx-auto w-full max-w-7xl">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                Behind every sale
              </p>
              <h2 className="mt-layout-sm text-balance font-display text-4xl font-light leading-[1.02] text-foreground sm:text-5xl">
                The books keep themselves.
              </h2>
              <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
                Each sale posts to the register session as it happens. It counts
                toward the day, and the drawer expects the cash. Nothing to
                re-enter, nothing to chase at close.
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
          texture={
            // The reconciliation act: ledger ruling in the left margin. The
            // centered content column starts ~21% in, so the mask melts the
            // lines away just before it — no rule ends hard against a card.
            <LedgerRules className="[mask-image:linear-gradient(to_right,black,transparent_20%)]" />
          }
          workspace="Cash Controls"
          title="Know what's in every drawer."
          copy="Expected cash builds from the morning's opening cash and every synced sale, and only you see that number. Staff count the drawer without knowing what it should hold, so the count is honest; any difference is surfaced in the moment, not discovered weeks later."
          automation="Athena reconciles synced register activity. A count within your variance threshold closes out on its own; outside it, the call is yours."
        >
          <>
            <div className="pt-8">
              <CashControlsScene />
            </div>
            {/* Drill from the dashboard into the session it holds in review. */}
            <div className="max-w-2xl pt-[12rem]">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                One register session
              </p>
              <h3 className="mt-layout-sm font-display text-3xl font-light leading-[1.05] text-foreground sm:text-4xl">
                The whole day on record.
              </h3>
              <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
                A register session is the day&apos;s record. It opens on the
                morning&apos;s counted cash, every synced sale lands on it in
                the moment, and its expected total builds itself. At close, the
                count meets the record, any difference is surfaced instead of
                buried — and the settled session flows straight into the books
                and the deposit.
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
          title="Today closes where tomorrow begins."
          copy="The end-of-day review runs under the rules you set: totals settled, the drawer accounted for, and anything that needs judgment flagged for you, reviewable from the back office or from home. Anything unfinished carries forward; tomorrow's opening is already prepared, and no one waited on you to lock up."
          automation="Under your rules, Athena completes the close. Anything needing an approval waits for you."
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

        <section className="relative flex min-h-svh items-center overflow-hidden border-t border-border bg-surface px-layout-md pb-[8rem] pt-[8rem] sm:px-layout-xl">
          {/* The replay: the opening statement's dot grid returns. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 text-foreground/[0.14] [mask-image:radial-gradient(90%_75%_at_72%_50%,black_25%,transparent_70%)]"
            style={{
              backgroundImage:
                "radial-gradient(currentColor 1px, transparent 1.5px)",
              backgroundSize: "26px 26px",
            }}
          />
          <div className="relative mx-auto grid w-full max-w-7xl items-center gap-layout-2xl lg:grid-cols-2">
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                Everywhere you weren&apos;t
              </p>
              <h2 className="mt-layout-sm font-display text-4xl font-light leading-[1.02] text-foreground sm:text-5xl">
                The day didn&apos;t run itself. Athena did.
              </h2>
              <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
                It started the opening, watched the registers, synced every
                sale, and prepared the close. Whatever your rules allowed, it
                handled; whatever needed judgment came to you. You saw every
                minute of it.
              </p>
            </div>
            <AutomationRevealScene />
          </div>
        </section>

        {/* The close: the demo invitation and the availability beat share one
            uninterrupted field — no border or background shift between them —
            so the page settles rather than starts a new act. The demo stays
            the primary CTA; the availability beat below carries the page's one
            interest-capture path to the (otherwise hidden) walkthrough form,
            reached here at the moment of maximum conviction. */}
        <section className="relative flex items-start overflow-hidden bg-surface px-layout-md pb-[8rem] pt-[12rem] sm:px-layout-xl">
          {/* The story's dot grid returns one last time — the same primitive
              that opens the page and closes the reveal above — but faded in
              only over the lower half. It gives the "Behind the demo" beat its
              own quiet floor, separating it from the demo invitation without a
              border, while the demo block up top keeps clean ground. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 text-foreground/[0.12] [mask-image:linear-gradient(to_bottom,transparent_42%,black_88%)]"
            style={{
              backgroundImage:
                "radial-gradient(currentColor 1px, transparent 1.5px)",
              backgroundSize: "26px 26px",
            }}
          />
          {/* A faint primary wash rises from the lower-left, anchoring the
              interest CTA — an echo of the hero's top-right glow. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_92%,hsl(var(--primary)/0.06),transparent_42%)]"
          />
          <div className="relative mx-auto w-full max-w-7xl space-y-[10rem] sm:space-y-[15rem]">
            <div className="flex w-full flex-col gap-layout-xl lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Open the store you just read about
                </p>
                <h2 className="mt-layout-md font-display text-4xl font-light leading-tight text-foreground sm:text-6xl">
                  Walk this exact day yourself.
                </h2>
              </div>
              <DemoCtaButton />
            </div>

            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Behind the demo
              </p>
              <h2 className="mt-layout-md font-display text-4xl font-light leading-tight text-foreground sm:text-5xl">
                Built running a real store. Opening to more.
              </h2>
              <p className="mt-layout-md text-lg leading-8 text-muted-foreground">
                Everything on this page runs a real store today, refined
                daily in live use.
              </p>
              <div className="mt-layout-lg">
                <Link
                  to={WALKTHROUGH_PATH}
                  onClick={() => emitLandingFunnelEvent("walkthrough_cta")}

                >
                  <Button variant={'clear'} className="text-muted-foreground hover:text-foreground font-semibold px-0 group">
                    Tell us about your store
                    <ArrowRight className="ml-layout-xs h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </PublicLayout>
  );
}
