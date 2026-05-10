import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Banknote,
  BarChart3,
  Boxes,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileClock,
  ScanBarcode,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
  Users,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Capability = {
  description: string;
  icon: typeof Store;
  title: string;
};

const capabilities: Capability[] = [
  {
    description: "In-person checkout, online orders, returns, exchanges, refunds, saved bags, reviews, offers, and rewards share one operating record.",
    icon: ShoppingBag,
    title: "Sales stay connected",
  },
  {
    description: "Catalog, SKUs, adjustments, replenishment, purchase orders, receiving, vendors, and unresolved stock cleanup live in the same control loop.",
    icon: Boxes,
    title: "Inventory has memory",
  },
  {
    description: "Daily open, daily close, open work, register sessions, cash controls, approvals, logs, and workflow traces show what happened and who touched it.",
    icon: Workflow,
    title: "Operations are accountable",
  },
  {
    description: "Service intake, appointments, active cases, catalog setup, deposits, inventory usage, and staff ownership work beside retail flows.",
    icon: CalendarCheck,
    title: "Services are first class",
  },
  {
    description: "Analytics, behavior timelines, storefront observability, and production health views turn scattered activity into owner visibility.",
    icon: BarChart3,
    title: "Signals become decisions",
  },
  {
    description: "Staff profiles, credentials, permissions, manager approval, and audit evidence keep delegation tight without forcing everything through the owner.",
    icon: ShieldCheck,
    title: "Control can be delegated",
  },
];

const workspaceTabs = [
  "Daily operations",
  "Register",
  "Procurement",
  "Services",
  "Analytics",
];

const timelineItems = [
  "Store opened with drawer proof",
  "Register sale completed",
  "Variance needs manager review",
  "Purchase order received",
];

const metricRows = [
  ["Sales", "GH₵ 8,420", "Healthy"],
  ["Cash variance", "GH₵ 0", "Clear"],
  ["Open work", "6", "Review"],
];

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={shouldReduceMotion ? false : { opacity: 1, y: 28 }}
      transition={{ delay, duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
      viewport={{ once: true, margin: "-80px" }}
      whileInView={{ opacity: 1, y: 0 }}
    >
      {children}
    </motion.div>
  );
}

export function AthenaLandingPage() {
  const { scrollYProgress } = useScroll();
  const heroLift = useTransform(scrollYProgress, [0, 0.22], [0, -54]);
  const railShift = useTransform(scrollYProgress, [0, 0.32], [0, 42]);

  return (
    <main className="-m-8 overflow-hidden bg-background text-foreground">
      <section className="relative min-h-screen border-b border-border bg-shell text-shell-foreground">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,hsl(var(--shell))_0%,hsl(var(--action-workflow)/0.42)_58%,hsl(var(--shell))_100%)]" />
        <motion.div
          className="absolute inset-x-4 bottom-4 top-24 overflow-hidden rounded-[calc(var(--radius)*1.4)] border border-action-workflow-border/35 bg-background/10 shadow-overlay backdrop-blur-sm md:inset-x-8 md:bottom-8"
          style={{ y: heroLift }}
        >
          <HeroWorkspace />
        </motion.div>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,hsl(var(--shell))_0%,hsl(var(--shell)/0.92)_22%,hsl(var(--shell)/0.38)_56%,transparent_84%)]" />
        <div className="absolute inset-0 bg-shell/35 md:bg-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[46%] bg-[linear-gradient(0deg,hsl(var(--shell))_0%,hsl(var(--shell)/0.82)_46%,transparent_100%)]" />

        <div className="relative z-10 flex min-h-screen items-end px-layout-lg pb-layout-3xl pt-28 md:px-layout-2xl">
          <motion.div
            className="max-w-5xl space-y-layout-lg"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <Badge className="border-action-workflow-border bg-action-workflow-soft text-action-workflow">
              Built for the owner-operator
            </Badge>
            <div className="space-y-layout-md">
              <h1 className="max-w-3xl font-display text-5xl leading-none text-shell-foreground md:text-7xl">
                Athena is the control room for a solo business.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-shell-foreground/82 md:text-xl">
                Sell, stock, fulfill, close the day, trace exceptions, and see
                the business clearly without becoming a full-time systems
                operator.
              </p>
            </div>
            <div className="flex flex-col gap-layout-sm sm:flex-row">
              <Button
                asChild
                className="h-control-standard bg-action-workflow text-action-workflow-foreground hover:bg-action-workflow/90"
              >
                <Link to="/login">
                  Open Athena
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <a
                href="#capabilities"
                className="inline-flex h-control-standard items-center justify-center rounded-lg border border-shell-foreground/25 px-layout-md text-sm font-medium text-shell-foreground transition duration-standard ease-standard hover:border-shell-foreground/55 hover:bg-shell-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-workflow"
              >
                See the system
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      <section
        id="capabilities"
        className="px-layout-lg py-layout-3xl md:px-layout-2xl"
      >
        <Reveal className="mx-auto max-w-6xl space-y-layout-lg">
          <div className="max-w-4xl space-y-layout-sm border-b border-border pb-layout-lg">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-action-workflow">
              Complete operational control
            </p>
            <h2 className="font-display text-5xl leading-none md:text-7xl">
              One owner. Every loop in view.
            </h2>
            <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
              Athena already covers the daily operating surface of a retail and
              service business: checkout, storefront, stock, procurement, cash,
              staff work, services, analytics, and evidence.
            </p>
          </div>
        </Reveal>

        <div className="mx-auto mt-layout-2xl grid max-w-6xl gap-layout-md md:grid-cols-2 xl:grid-cols-3">
          {capabilities.map((capability, index) => (
            <Reveal key={capability.title} delay={index * 0.04}>
              <motion.article
                className="group h-full rounded-lg border border-border bg-surface p-layout-lg shadow-surface transition duration-standard ease-standard hover:-translate-y-1 hover:border-action-workflow-border hover:bg-action-workflow-soft/30"
                whileHover={{ y: -6 }}
              >
                <capability.icon className="h-5 w-5 text-action-workflow transition duration-standard ease-standard group-hover:scale-110" />
                <div className="mt-layout-lg space-y-layout-sm">
                  <h3 className="text-xl font-semibold">{capability.title}</h3>
                  <p className="leading-7 text-muted-foreground">
                    {capability.description}
                  </p>
                </div>
              </motion.article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bg-surface px-layout-lg py-layout-3xl md:px-layout-2xl">
        <div className="mx-auto grid max-w-7xl gap-layout-2xl xl:grid-cols-[0.8fr_1.2fr]">
          <Reveal className="space-y-layout-lg">
            <div className="space-y-layout-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-action-workflow">
                Workspace depth
              </p>
              <h2 className="font-display text-5xl leading-none md:text-7xl">
                It looks like work because it is work.
              </h2>
              <p className="text-lg leading-8 text-muted-foreground">
                The landing page uses Athena's real workspace language: large
                orientation headers, quiet rails, dense review zones, state
                chips, and workflow-colored actions.
              </p>
            </div>
            <div className="grid gap-layout-sm sm:grid-cols-2">
              {[
                ["Open work", "Exceptions, approvals, and carry-forward tasks."],
                ["Daily close", "Sales, expenses, drawer variance, and evidence."],
                ["Receiving", "Inbound purchase orders tied back to stock."],
                ["Trace review", "Business-readable timelines for what happened."],
              ].map(([title, detail]) => (
                <div
                  key={title}
                  className="rounded-lg border border-border bg-background p-layout-md"
                >
                  <p className="font-semibold">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {detail}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={0.12}>
            <motion.div
              className="rounded-[calc(var(--radius)*1.35)] border border-border bg-background p-layout-md shadow-overlay"
              style={{ y: railShift }}
            >
              <WorkspaceShowcase />
            </motion.div>
          </Reveal>
        </div>
      </section>

      <section className="px-layout-lg py-layout-3xl md:px-layout-2xl">
        <div className="mx-auto max-w-7xl space-y-layout-2xl">
          <Reveal className="max-w-5xl space-y-layout-sm border-b border-border pb-layout-lg">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-action-workflow">
              Operating evidence
            </p>
            <h2 className="font-display text-5xl leading-none md:text-7xl">
              Know what happened without hunting for it.
            </h2>
          </Reveal>

          <div className="grid gap-layout-lg lg:grid-cols-[1fr_0.82fr]">
            <Reveal>
              <TracePanel />
            </Reveal>
            <Reveal delay={0.08}>
              <OwnerPanel />
            </Reveal>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-shell px-layout-lg py-layout-3xl text-shell-foreground md:px-layout-2xl">
        <Reveal className="mx-auto flex max-w-6xl flex-col gap-layout-xl md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl space-y-layout-md">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-action-workflow-foreground/80">
              Athena
            </p>
            <h2 className="font-display text-5xl leading-none md:text-7xl">
              Run the day from one place.
            </h2>
            <p className="text-lg leading-8 text-shell-foreground/78">
              The point is not another dashboard. It is a business operating
              system with enough structure for control and enough calm for daily
              use.
            </p>
          </div>
          <Button
            asChild
            className="h-control-standard bg-action-workflow text-action-workflow-foreground hover:bg-action-workflow/90"
          >
            <Link to="/login">
              Open Athena
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </Reveal>
      </section>
    </main>
  );
}

function HeroWorkspace() {
  return (
    <div className="grid h-full min-h-[560px] grid-cols-[72px_minmax(0,1fr)] bg-background text-foreground">
      <aside className="border-r border-border bg-shell p-layout-sm text-shell-foreground">
        <div className="mb-layout-xl flex h-10 w-10 items-center justify-center rounded-lg bg-action-workflow text-action-workflow-foreground">
          <Store className="h-5 w-5" />
        </div>
        <div className="space-y-layout-sm">
          {[ScanBarcode, Banknote, Workflow, Boxes, Users].map((Icon, index) => (
            <div
              key={index}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-md border border-shell-foreground/10 text-shell-foreground/72",
                index === 2 ? "bg-action-workflow text-action-workflow-foreground" : null,
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
          ))}
        </div>
      </aside>
      <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex items-center justify-between border-b border-border bg-surface px-layout-lg py-layout-md">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Daily operations
            </p>
            <h2 className="mt-1 text-2xl font-semibold">Sunday control room</h2>
          </div>
          <Badge className="border-action-workflow-border bg-action-workflow-soft text-action-workflow">
            Operating
          </Badge>
        </header>
        <div className="grid min-h-0 gap-layout-lg p-layout-lg lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-layout-lg">
            <div className="grid gap-layout-md md:grid-cols-3">
              {metricRows.map(([label, value, status]) => (
                <div
                  key={label}
                  className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface"
                >
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-3 font-numeric text-3xl font-semibold">
                    {value}
                  </p>
                  <p className="mt-2 text-sm text-action-workflow">{status}</p>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border bg-surface-raised p-layout-lg shadow-surface">
              <div className="mb-layout-md flex items-center justify-between">
                <h3 className="font-semibold">Close readiness</h3>
                <span className="text-sm text-muted-foreground">4 lanes</span>
              </div>
              <div className="space-y-layout-sm">
                {["Register proof", "Open work", "Cash summary", "Stock exceptions"].map(
                  (label, index) => (
                    <div
                      key={label}
                      className="flex items-center gap-layout-sm rounded-md border border-border bg-background p-layout-sm"
                    >
                      <div
                        className={cn(
                          "h-2.5 w-2.5 rounded-full",
                          index === 1 ? "bg-warning" : "bg-success",
                        )}
                      />
                      <span className="font-medium">{label}</span>
                      <span className="ml-auto text-sm text-muted-foreground">
                        {index === 1 ? "Review" : "Ready"}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
          <aside className="space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Timeline
            </p>
            {timelineItems.map((item, index) => (
              <div key={item} className="flex gap-layout-sm">
                <div className="flex flex-col items-center">
                  <span className="mt-1 h-3 w-3 rounded-full bg-action-workflow" />
                  {index < timelineItems.length - 1 ? (
                    <span className="h-10 w-px bg-border" />
                  ) : null}
                </div>
                <p className="text-sm leading-6">{item}</p>
              </div>
            ))}
          </aside>
        </div>
      </div>
    </div>
  );
}

function WorkspaceShowcase() {
  return (
    <div className="space-y-layout-lg">
      <div className="flex flex-wrap gap-layout-xs">
        {workspaceTabs.map((tab, index) => (
          <button
            key={tab}
            className={cn(
              "rounded-full border px-layout-sm py-layout-xs text-sm transition duration-standard ease-standard hover:-translate-y-0.5 hover:border-action-workflow-border hover:bg-action-workflow-soft hover:text-action-workflow",
              index === 0
                ? "border-action-workflow bg-action-workflow text-action-workflow-foreground"
                : "border-border bg-surface text-muted-foreground",
            )}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid gap-layout-lg lg:grid-cols-[minmax(0,1fr)_270px]">
        <div className="rounded-lg border border-border bg-surface p-layout-lg">
          <div className="mb-layout-lg flex items-start justify-between gap-layout-md">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Work queue
              </p>
              <h3 className="mt-2 text-3xl font-semibold">Owner attention</h3>
            </div>
            <Badge className="bg-warning text-warning-foreground">
              6 open
            </Badge>
          </div>
          <div className="grid gap-layout-sm">
            {[
              ["Manager approval", "Register variance review", ShieldCheck],
              ["Receiving", "PO-1042 short receipt", Truck],
              ["Customer follow-up", "Refund email pending", FileClock],
              ["Stock adjustment", "Cycle count draft ready", ClipboardCheck],
            ].map(([title, detail, Icon]) => (
              <motion.div
                key={title as string}
                className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-layout-sm rounded-lg border border-border bg-background p-layout-md transition duration-standard ease-standard hover:border-action-workflow-border hover:bg-action-workflow-soft/40"
                whileHover={{ x: 6 }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-action-workflow-soft text-action-workflow">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium">{title as string}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {detail as string}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </motion.div>
            ))}
          </div>
        </div>

        <aside className="space-y-layout-md rounded-lg border border-border bg-surface p-layout-md">
          <div className="rounded-md bg-action-workflow-soft p-layout-md text-action-workflow">
            <Sparkles className="mb-layout-sm h-5 w-5" />
            <p className="font-semibold">Next best action</p>
            <p className="mt-2 text-sm leading-6">
              Clear the variance review before closing today's store day.
            </p>
          </div>
          {["Drawer proof", "Open orders", "Stock exceptions"].map((item) => (
            <div
              key={item}
              className="flex items-center justify-between border-b border-border pb-layout-sm last:border-b-0 last:pb-0"
            >
              <span className="text-sm">{item}</span>
              <CheckCircle2 className="h-4 w-4 text-success" />
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function TracePanel() {
  return (
    <motion.article
      className="rounded-lg border border-border bg-surface p-layout-lg shadow-surface"
      whileHover={{ y: -4 }}
    >
      <div className="flex flex-col gap-layout-md border-b border-border pb-layout-lg sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-action-workflow">
            Workflow trace
          </p>
          <h3 className="mt-2 text-3xl font-semibold">
            Receipt 2026-0510-042
          </h3>
        </div>
        <Badge className="border-success/30 bg-success/10 text-success">
          Complete
        </Badge>
      </div>
      <div className="mt-layout-lg grid gap-layout-md md:grid-cols-2">
        {[
          ["Started", "Staff profile verified"],
          ["Items added", "3 SKUs reserved"],
          ["Payment allocated", "Cash and mobile money reconciled"],
          ["Receipt issued", "Customer timeline updated"],
        ].map(([title, detail], index) => (
          <div key={title} className="flex gap-layout-sm">
            <div className="flex flex-col items-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-action-workflow text-action-workflow-foreground">
                {index + 1}
              </span>
            </div>
            <div>
              <p className="font-semibold">{title}</p>
              <p className="text-sm leading-6 text-muted-foreground">
                {detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </motion.article>
  );
}

function OwnerPanel() {
  return (
    <motion.article
      className="h-full rounded-lg border border-border bg-shell p-layout-lg text-shell-foreground shadow-overlay"
      whileHover={{ y: -4 }}
    >
      <div className="space-y-layout-md">
        <Eye className="h-6 w-6 text-action-workflow-foreground" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-shell-foreground/62">
            Owner visibility
          </p>
          <h3 className="mt-2 text-3xl font-semibold">The audit trail is part of the product.</h3>
        </div>
        <p className="leading-7 text-shell-foreground/76">
          Athena records the operational facts owners actually need: staff
          action, store-day state, payment allocation, stock movement, customer
          follow-up, and exceptions that still need a decision.
        </p>
      </div>
      <div className="mt-layout-xl grid gap-layout-sm">
        {["Store day", "Register session", "Purchase order", "Service case"].map(
          (item, index) => (
            <div
              key={item}
              className="flex items-center justify-between rounded-md border border-shell-foreground/10 bg-shell-foreground/5 px-layout-md py-layout-sm"
            >
              <span>{item}</span>
              <span className="font-numeric text-sm text-action-workflow-foreground">
                {index + 12} events
              </span>
            </div>
          ),
        )}
      </div>
    </motion.article>
  );
}
