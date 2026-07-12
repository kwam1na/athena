import { Link } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  History,
  PackageSearch,
  Store,
  Users,
} from "lucide-react";

import { emitLandingFunnelEvent } from "@/lib/marketing/landingFunnelClient";
import { WALKTHROUGH_PATH } from "@/lib/navigation/appEntryRoutes";
import { PublicLayout } from "./-public-layout";

const trendBars = [34, 48, 42, 61, 54, 72, 66, 82, 75, 91, 84, 96];

function ProductMoment() {
  return (
    <figure
      className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-shell-foreground/15 bg-background text-foreground shadow-overlay"
    >
      <figcaption className="sr-only">
        Illustration of Athena&apos;s sales overview, including sales activity, history, and products moving.
      </figcaption>
      <div className="flex items-center justify-between border-b border-border bg-surface px-layout-md py-layout-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Store pulse
          </p>
          <p className="mt-1 text-sm font-medium">Today</p>
        </div>
        <span className="rounded-full bg-success/10 px-layout-sm py-layout-xs text-xs font-medium text-success">
          Sales in view
        </span>
      </div>

      <div className="grid gap-layout-lg p-layout-md sm:p-layout-lg">
        <div className="grid grid-cols-3 gap-layout-sm">
          {["Sales", "Transactions", "Items sold"].map((label) => (
            <div key={label} className="border-l border-border pl-layout-sm sm:pl-layout-md">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {label}
              </p>
              <div className="mt-layout-sm h-2 rounded-full bg-muted">
                <div className="h-2 w-2/3 rounded-full bg-signal/75" />
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-layout-lg border-t border-border pt-layout-md sm:grid-cols-[1.35fr_0.65fr]">
          <div>
            <div className="flex items-center justify-between gap-layout-sm">
              <p className="text-sm font-medium">Sales over time</p>
              <span className="text-xs text-muted-foreground">History stays close</span>
            </div>
            <div className="mt-layout-md flex h-32 items-end gap-1.5" aria-hidden="true">
              {trendBars.map((height, index) => (
                <div
                  key={`${height}-${index}`}
                  className="flex-1 rounded-t-sm bg-signal/20 last:bg-signal"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-layout-sm">
            <p className="text-sm font-medium">Products moving</p>
            {["Everyday essentials", "New arrivals", "Repeat favourites"].map(
              (label, index) => (
                <div key={label} className="flex items-center gap-layout-sm text-xs">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-signal/10 font-numeric text-signal">
                    {index + 1}
                  </span>
                  <span className="text-muted-foreground">{label}</span>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}

function StorySection({
  eyebrow,
  title,
  copy,
  icon: Icon,
  children,
  reversed = false,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  icon: typeof History;
  children: ReactNode;
  reversed?: boolean;
}) {
  return (
    <section className="border-t border-border/70 px-layout-md py-layout-3xl sm:px-layout-xl">
      <div
        className={`mx-auto grid w-full max-w-7xl items-center gap-layout-2xl lg:grid-cols-2 ${
          reversed ? "lg:[&>*:first-child]:order-2" : ""
        }`}
      >
        <div className="max-w-xl">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-signal/10 text-signal">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-layout-lg text-xs font-semibold uppercase tracking-[0.22em] text-signal">
            {eyebrow}
          </p>
          <h2 className="mt-layout-sm font-display text-4xl font-light leading-[1.02] text-foreground sm:text-5xl">
            {title}
          </h2>
          <p className="mt-layout-md text-lg leading-8 text-muted-foreground">{copy}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

export function Index() {
  useEffect(() => {
    emitLandingFunnelEvent("page_view");
  }, []);

  return (
    <PublicLayout trackWalkthroughCta>
      <main>
        <section className="relative overflow-hidden bg-shell px-layout-md py-layout-3xl text-shell-foreground sm:px-layout-xl lg:py-[7.5rem]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,hsl(var(--signal)/0.22),transparent_34%)]" />
          <div className="relative mx-auto grid w-full max-w-7xl items-center gap-layout-2xl lg:grid-cols-[0.86fr_1.14fr]">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-shell-foreground/80">
                Athena for owner-led retail
              </p>
              <h1 className="mt-layout-md font-display text-5xl font-light leading-[0.96] sm:text-7xl">
                See today&apos;s sales. Know what needs attention.
              </h1>
              <p className="mt-layout-lg max-w-xl text-lg leading-8 text-shell-foreground/75 sm:text-xl">
                Athena keeps each day&apos;s sales, the products behind them, and your business history in one clear operating view.
              </p>
              <div className="mt-layout-xl flex flex-col gap-layout-sm sm:flex-row sm:items-center">
                <Link
                  to={WALKTHROUGH_PATH}
                  onClick={() => emitLandingFunnelEvent("walkthrough_cta")}
                  className="inline-flex min-h-12 items-center justify-center rounded-md bg-signal px-layout-lg text-sm font-semibold text-signal-foreground transition-[background-color,transform] duration-standard ease-standard hover:bg-signal/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-shell"
                >
                  Request a walkthrough
                  <ArrowRight className="ml-layout-sm h-4 w-4" aria-hidden="true" />
                </Link>
                <span className="text-sm text-shell-foreground/60">
                  Built for a small team with a lot to keep in view.
                </span>
              </div>
            </div>
            <ProductMoment />
          </div>
        </section>

        <StorySection
          eyebrow="Sales history"
          title="Today is only the beginning."
          copy="Move from the current day into the history Athena has recorded without searching through notebooks, receipts, or memory. Compare periods and keep the business story close to the work."
          icon={History}
        >
          <div className="grid gap-layout-sm border-y border-border py-layout-md">
            {["Today", "This week", "This month", "All recorded sales"].map(
              (period, index) => (
                <div key={period} className="flex items-center gap-layout-md py-layout-sm">
                  <span className="font-numeric text-xs text-muted-foreground">0{index + 1}</span>
                  <span className="text-lg text-foreground">{period}</span>
                  <span className="ml-auto h-px w-12 bg-signal/50 sm:w-24" aria-hidden="true" />
                </div>
              ),
            )}
          </div>
        </StorySection>

        <StorySection
          eyebrow="Product movement"
          title="See which products shaped the day."
          copy="Sales totals tell you where the day landed. Product movement helps explain why. Athena keeps units, sales, and the products customers chose within the same view."
          icon={PackageSearch}
          reversed
        >
          <div className="space-y-layout-md rounded-xl border border-border bg-surface p-layout-lg shadow-surface">
            {["Fast-moving products", "Products gaining attention", "Items to review"].map(
              (label, index) => (
                <div key={label} className="flex items-center gap-layout-md border-b border-border pb-layout-md last:border-0 last:pb-0">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-signal/10 text-signal">
                    {index === 2 ? <Boxes className="h-5 w-5" /> : <BarChart3 className="h-5 w-5" />}
                  </span>
                  <div>
                    <p className="font-medium text-foreground">{label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">Ready for the owner&apos;s review</p>
                  </div>
                </div>
              ),
            )}
          </div>
        </StorySection>

        <StorySection
          eyebrow="Owner decision"
          title="Decide what needs your attention next."
          copy="Bring product movement beside current stock pressure, then make the call. Athena highlights the operating facts; you stay responsible for the restocking decision."
          icon={Boxes}
        >
          <div className="rounded-xl bg-shell p-layout-lg text-shell-foreground shadow-overlay">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-shell-foreground/80">Owner review</p>
            <div className="mt-layout-lg space-y-layout-md">
              {["What moved", "What is under pressure", "What to act on"].map((label) => (
                <div key={label} className="flex items-center gap-layout-sm border-b border-shell-foreground/10 pb-layout-md last:border-0 last:pb-0">
                  <Check className="h-4 w-4 text-shell-foreground/80" aria-hidden="true" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </StorySection>

        <section className="border-t border-border bg-surface px-layout-md py-layout-3xl sm:px-layout-xl">
          <div className="mx-auto grid max-w-7xl gap-layout-xl lg:grid-cols-2">
            <article className="border-l-2 border-signal pl-layout-lg">
              <Store className="h-5 w-5 text-signal" aria-hidden="true" />
              <h2 className="mt-layout-md font-display text-3xl font-light">In-person and online sales stay connected.</h2>
              <p className="mt-layout-sm max-w-lg leading-7 text-muted-foreground">Keep the operating record together as customers buy in person or online.</p>
            </article>
            <article className="border-l-2 border-signal pl-layout-lg">
              <Users className="h-5 w-5 text-signal" aria-hidden="true" />
              <h2 className="mt-layout-md font-display text-3xl font-light">Give your team room to work.</h2>
              <p className="mt-layout-sm max-w-lg leading-7 text-muted-foreground">Staff permissions, approvals, and activity records help the owner delegate without losing the thread.</p>
            </article>
          </div>
        </section>

        <section className="bg-shell px-layout-md py-layout-3xl text-shell-foreground sm:px-layout-xl">
          <div className="mx-auto flex max-w-7xl flex-col gap-layout-xl lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-shell-foreground/80">Start with the day in front of you</p>
              <h2 className="mt-layout-md font-display text-4xl font-light leading-tight sm:text-6xl">See the business clearly enough to act.</h2>
            </div>
            <Link
              to={WALKTHROUGH_PATH}
              onClick={() => emitLandingFunnelEvent("walkthrough_cta")}
              className="inline-flex min-h-12 items-center justify-center rounded-md bg-signal px-layout-lg text-sm font-semibold text-signal-foreground transition-[background-color,transform] duration-standard ease-standard hover:bg-signal/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-shell"
            >
              Request a walkthrough
              <ArrowRight className="ml-layout-sm h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
    </PublicLayout>
  );
}
