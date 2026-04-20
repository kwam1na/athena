import type { ComponentType, ReactNode } from "react";

import {
  AlertOctagon,
  ArrowLeftIcon,
  BarChart3,
  BadgePercent,
  Bell,
  ClipboardList,
  Clock3,
  PackageSearch,
  Search,
  Sparkles,
  Store,
  Truck,
  Users,
  CheckCircle2,
  Layers3,
} from "lucide-react";

import MetricCard from "@/components/dashboard/MetricCard";
import DashboardSkeleton from "@/components/states/loading/dashboard-skeleton";
import TableSkeleton from "@/components/states/loading/table-skeleton";
import TransactionsSkeleton from "@/components/states/loading/transactions-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  meta?: string;
  icon: ComponentType<{ className?: string }>;
  active?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Store",
    items: [
      { label: "Dashboard", icon: Layers3, active: true },
      { label: "Analytics", icon: BarChart3, meta: "14 insights" },
      { label: "Point of sale", icon: Store, meta: "Live" },
      { label: "Orders", icon: ClipboardList, meta: "12 open" },
      { label: "Products", icon: PackageSearch, meta: "8 unresolved" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Fulfillment", icon: Truck, meta: "3 in transit" },
      { label: "Reviews", icon: Sparkles, meta: "4 waiting" },
      { label: "Bulk operations", icon: Layers3, meta: "1 lane" },
      { label: "Promo codes", icon: BadgePercent },
    ],
  },
  {
    label: "Customers",
    items: [
      { label: "Segments", icon: Users },
      { label: "Activity", icon: Clock3, meta: "Today" },
      { label: "Issues", icon: AlertOctagon, meta: "2 alerts" },
    ],
  },
];

const METRICS = [
  {
    label: "Open orders",
    value: "42",
    change: 12.4,
    changeLabel: "vs yesterday",
  },
  {
    label: "Pending reviews",
    value: "8",
    change: -18.2,
    changeLabel: "last 24h",
  },
  {
    label: "Unresolved images",
    value: "6",
    change: -5.5,
    changeLabel: "after import pass",
  },
  {
    label: "Revenue today",
    value: "GHS 18.4k",
    change: 7.9,
    changeLabel: "morning trade",
  },
] as const;

const STATUS_CHIPS = [
  "Northwind Atelier",
  "Accra | OS 3",
  "Shift open",
  "Fresh sync 2m ago",
] as const;

function PatternShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_hsl(var(--signal)/0.16),_transparent_34%),radial-gradient(circle_at_top_right,_hsl(var(--primary)/0.12),_transparent_28%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--background))_45%,_hsl(var(--muted)/0.18))] p-4 text-foreground md:p-8">
      <div
        className={cn(
          "mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-7xl overflow-hidden rounded-[2rem] border border-border bg-background/96 shadow-[0_24px_80px_-24px_hsl(var(--foreground)/0.22)] md:min-h-[calc(100vh-4rem)]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function PatternCard({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[1.75rem] border border-border bg-surface-raised/95 p-5 shadow-surface md:p-6",
        className,
      )}
    >
      <div className="space-y-2 border-b border-border/70 pb-4">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          {eyebrow}
        </p>
        <h2 className="font-display text-2xl tracking-[-0.04em] text-foreground">
          {title}
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}

function PatternSidebarItem({
  icon: Icon,
  label,
  meta,
  active,
}: NavItem) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-2xl px-3 py-2.5 transition-colors",
        active
          ? "bg-[hsl(var(--signal)/0.16)] text-shell-foreground"
          : "text-shell-foreground/78 hover:bg-white/6 hover:text-shell-foreground",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl border border-white/8",
            active ? "bg-[hsl(var(--signal))] text-[hsl(var(--signal-foreground))]" : "bg-white/5 text-shell-foreground/80",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      {meta ? (
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-shell-foreground/55">
          {meta}
        </span>
      ) : null}
    </div>
  );
}

function PatternSidebarGroup({ group }: { group: NavGroup }) {
  return (
    <div className="space-y-3">
      <p className="px-3 text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-shell-foreground/52">
        {group.label}
      </p>
      <div className="space-y-1.5">
        {group.items.map((item) => (
          <PatternSidebarItem key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
}

function PatternSidebar() {
  return (
    <aside className="flex h-full w-full flex-col bg-shell text-shell-foreground shadow-overlay">
      <div className="border-b border-white/8 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--signal))] text-[hsl(var(--signal-foreground))] shadow-[0_12px_24px_-10px_hsl(var(--signal)/0.65)]">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="space-y-0.5">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-shell-foreground/56">
              Athena Admin
            </p>
            <h3 className="font-display text-xl tracking-[-0.03em]">
              Northwind Atelier
            </h3>
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-[1.5rem] border border-white/8 bg-black/12 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.24em] text-shell-foreground/52">
              Active store
            </span>
            <Badge variant="outline" className="border-white/10 text-xs text-shell-foreground">
              Open
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/8 text-shell-foreground">
              <Store className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">Kente House Goods</p>
              <p className="text-xs text-shell-foreground/60">Accra, Ghana</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-auto p-4">
        {NAV_GROUPS.map((group) => (
          <PatternSidebarGroup key={group.label} group={group} />
        ))}
      </div>

      <div className="border-t border-white/8 p-4">
        <div className="flex items-center justify-between rounded-[1.35rem] border border-white/8 bg-white/5 px-3 py-3">
          <div>
            <p className="text-sm font-semibold">Grace Mensah</p>
            <p className="text-xs text-shell-foreground/60">Operations lead</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-white/10 bg-transparent text-shell-foreground hover:bg-white/8 hover:text-shell-foreground"
          >
            Profile
          </Button>
        </div>
      </div>
    </aside>
  );
}

function PatternHeader() {
  return (
    <PatternCard
      eyebrow="Page header"
      title="Today’s admin pulse"
      description="A focused header that carries store context, navigation affordances, and a clear action rail without collapsing into a generic toolbar."
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full border border-border/60 bg-background/50">
                <ArrowLeftIcon className="h-4 w-4" />
              </Button>
              {STATUS_CHIPS.map((chip) => (
                <Badge
                  key={chip}
                  variant="outline"
                  className="rounded-full border-border/70 bg-background/60 px-3 py-1 text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground"
                >
                  {chip}
                </Badge>
              ))}
            </div>
            <div className="space-y-2">
              <h3 className="font-display text-[clamp(2.4rem,3.8vw,3.4rem)] leading-none tracking-[-0.05em] text-foreground">
                A calm command surface for the store team.
              </h3>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
                Keep the workspace anchored with store identity, search, and key
                actions at the top of the page. The shell should feel purposeful,
                not like a placeholder scaffold.
              </p>
            </div>
          </div>

          <div className="flex min-w-[280px] flex-1 flex-col gap-3 sm:flex-none">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value="Search products, orders, reviews"
                readOnly
                className="h-11 rounded-full border-border/70 pl-10 text-sm shadow-none"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="rounded-full">
                <Bell className="h-4 w-4" />
                Alerts
              </Button>
              <Button className="rounded-full">
                <CheckCircle2 className="h-4 w-4" />
                Publish updates
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
          <Badge className="rounded-full bg-[hsl(var(--signal)/0.15)] text-[hsl(var(--signal))] hover:bg-[hsl(var(--signal)/0.15)]">
            Shift open
          </Badge>
          <Badge variant="outline" className="rounded-full">
            4 urgent tasks
          </Badge>
          <Badge variant="outline" className="rounded-full">
            2 approvals pending
          </Badge>
        </div>
      </div>
    </PatternCard>
  );
}

function PatternMetrics() {
  return (
    <PatternCard
      eyebrow="Metric surface"
      title="A quick read on the store"
      description="Small, deliberate metric cards should feel like operator tools. They need enough hierarchy to answer the first question fast and enough warmth to feel authored."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {METRICS.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>
    </PatternCard>
  );
}

function PatternLoading() {
  return (
    <PatternCard
      eyebrow="Loading surfaces"
      title="Stable shells while data arrives"
      description="Loading states should preserve the overall admin rhythm instead of collapsing into a wall of generic gray bars."
      className="overflow-hidden"
    >
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
          <DashboardSkeleton />
        </div>
        <div className="grid gap-4">
          <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
            <TableSkeleton />
          </div>
          <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
            <TransactionsSkeleton />
          </div>
        </div>
      </div>
    </PatternCard>
  );
}

export function AthenaSidebarPattern() {
  return <PatternShell className="bg-background/94"><div className="grid min-h-[760px] w-full lg:grid-cols-[320px_1fr]"><PatternSidebar /><div className="hidden lg:block bg-[linear-gradient(180deg,_hsl(var(--surface-raised)),_hsl(var(--background)))] p-6"><PatternHeader /></div></div></PatternShell>;
}

export function AthenaPageHeaderPattern() {
  return (
    <PatternShell>
      <div className="flex w-full items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-6xl">
          <PatternHeader />
        </div>
      </div>
    </PatternShell>
  );
}

export function AthenaMetricPattern() {
  return (
    <PatternShell>
      <div className="w-full p-4 md:p-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <PatternHeader />
          <PatternMetrics />
        </div>
      </div>
    </PatternShell>
  );
}

export function AthenaLoadingPattern() {
  return (
    <PatternShell>
      <div className="w-full p-4 md:p-8">
        <div className="mx-auto max-w-6xl">
          <PatternLoading />
        </div>
      </div>
    </PatternShell>
  );
}

export function AthenaAdminShellPatterns() {
  return (
    <PatternShell>
      <div className="grid min-h-[860px] w-full lg:grid-cols-[320px_1fr]">
        <PatternSidebar />
        <main className="flex min-w-0 flex-col gap-6 overflow-hidden bg-[linear-gradient(180deg,_hsl(var(--surface-raised)),_hsl(var(--background))_35%)] p-4 md:p-6">
          <div className="rounded-[1.75rem] border border-border/70 bg-background/75 p-5 shadow-surface">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              Patterns
            </p>
            <h1 className="mt-2 font-display text-[clamp(2.5rem,4vw,3.75rem)] leading-[0.95] tracking-[-0.05em] text-foreground">
              Athena admin shell patterns
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
              A full workspace composition for reviewing the sidebar, page
              header, metric surfaces, and loading states that define Athena’s
              admin experience.
            </p>
          </div>
          <PatternHeader />
          <PatternMetrics />
          <PatternLoading />
        </main>
      </div>
    </PatternShell>
  );
}
