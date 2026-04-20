import type { CSSProperties, ReactNode } from "react";

import {
  ArrowRight,
  ChartColumn,
  CheckCircle2,
  Database,
  Filter,
  LayoutDashboard,
  LifeBuoy,
  Settings2,
  Shield,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { StorybookList, StorybookPillRow, StorybookShell } from "../storybook-shell";

type Metric = {
  label: string;
  value: string;
  delta: string;
  detail: string;
};

type Lane = {
  title: string;
  detail: string;
  meta: string;
  tone?: "neutral" | "signal" | "success" | "warning";
};

type RecordRow = {
  name: string;
  status: string;
  owner: string;
  updated: string;
};

type SettingItem = {
  label: string;
  value: string;
  detail: string;
};

const DASHBOARD_METRICS: readonly Metric[] = [
  {
    label: "Gross revenue",
    value: "GHS 128.4k",
    delta: "+18%",
    detail: "Morning trade is outpacing the 7-day baseline.",
  },
  {
    label: "Open actions",
    value: "14",
    delta: "-3",
    detail: "Three decisions moved from review to done overnight.",
  },
  {
    label: "Live exceptions",
    value: "6",
    delta: "2 urgent",
    detail: "Inventory gaps are concentrated in two regions.",
  },
  {
    label: "Operator confidence",
    value: "92%",
    delta: "+4",
    detail: "The team is moving faster after the last cleanup pass.",
  },
] as const;

const DASHBOARD_LANES: readonly Lane[] = [
  {
    title: "Critical signals",
    detail: "A compact alert rail surfaces only the items that need a decision today.",
    meta: "6 items",
    tone: "warning",
  },
  {
    title: "Today's actions",
    detail: "The primary workflow lane keeps the team focused on publish, approve, and re-route steps.",
    meta: "3 pending",
    tone: "signal",
  },
  {
    title: "Revenue pulse",
    detail: "The chart card compresses trend, seasonality, and comparison into one readable block.",
    meta: "24h view",
    tone: "success",
  },
] as const;

const DATA_ROWS: readonly RecordRow[] = [
  {
    name: "Accra Market Images",
    status: "Needs review",
    owner: "Nana",
    updated: "12m ago",
  },
  {
    name: "Q2 Fulfillment Export",
    status: "Validated",
    owner: "Maya",
    updated: "34m ago",
  },
  {
    name: "Returns audit lane",
    status: "Exception",
    owner: "Kojo",
    updated: "Today",
  },
  {
    name: "Promotion sync batch",
    status: "Queued",
    owner: "Esi",
    updated: "2h ago",
  },
] as const;

const SETTINGS_ITEMS: readonly SettingItem[] = [
  {
    label: "Density",
    value: "Compact for review lanes",
    detail: "Use compact spacing for tables, filters, and operational workstreams.",
  },
  {
    label: "Notifications",
    value: "Critical only",
    detail: "Avoid noisy banners; reserve alerts for decision-worthy changes.",
  },
  {
    label: "Brand surface",
    value: "Athena shell framing",
    detail: "Keep the left rail dark, grounded, and calm while the workspace stays warm.",
  },
  {
    label: "Publishing",
    value: "Manual review required",
    detail: "Settings changes should read like deliberate operations, not live state churn.",
  },
] as const;

function ReferencePageShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <StorybookShell eyebrow={eyebrow} title={title} description={description}>
      {children}
    </StorybookShell>
  );
}

function FrameCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[1.75rem] border border-border bg-surface-raised p-layout-md shadow-surface",
        className,
      )}
    >
      <div className="space-y-2 border-b border-border/70 pb-4">
        <h2 className="font-display text-xl tracking-[-0.03em] text-foreground">
          {title}
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {subtitle}
        </p>
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}

function MetricTile({ delta, detail, label, value }: Metric) {
  return (
    <div className="rounded-[calc(var(--radius)*1.15)] border border-border/80 bg-background p-layout-md shadow-[0_12px_28px_-20px_hsl(var(--foreground)/0.22)]">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="font-display text-[clamp(1.7rem,2.8vw,2.35rem)] leading-none tracking-[-0.04em] text-foreground">
          {value}
        </p>
        <span className="rounded-full bg-[hsl(var(--signal)/0.12)] px-3 py-1 text-xs font-semibold text-[hsl(var(--signal))]">
          {delta}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}

function LaneCard({ detail, meta, title, tone = "neutral" }: Lane) {
  const toneStyles: Record<NonNullable<Lane["tone"]>, string> = {
    neutral: "bg-background text-foreground",
    signal: "bg-[hsl(var(--signal)/0.12)] text-[hsl(var(--signal))]",
    success: "bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success))]",
    warning: "bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning-foreground))]",
  };

  return (
    <div className="flex flex-col gap-4 rounded-[calc(var(--radius)*1.15)] border border-border bg-background p-layout-md">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-display text-xl tracking-[-0.03em] text-foreground">
          {title}
        </h3>
        <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", toneStyles[tone])}>
          {meta}
        </span>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
      <div className="mt-2 flex items-center gap-3 text-sm font-medium text-foreground">
        <span>Review lane</span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
}

function MiniTrendChart() {
  const bars = [34, 52, 42, 66, 58, 74, 90, 84, 96, 88];

  return (
    <div className="flex h-48 items-end gap-2 rounded-[calc(var(--radius)*1.15)] border border-border bg-[linear-gradient(180deg,_hsl(var(--surface-raised)),_hsl(var(--background))_55%)] p-4">
      {bars.map((height, index) => (
        <div key={height} className="flex flex-1 flex-col items-center gap-2">
          <div
            className={cn(
              "w-full rounded-t-full",
              index > 6 ? "bg-[hsl(var(--signal))]" : "bg-[hsl(var(--signal)/0.32)]",
            )}
            style={{ height: `${height}%` } as CSSProperties}
          />
          <span className="text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">
            {index + 1}
          </span>
        </div>
      ))}
    </div>
  );
}

function CompactTable({ rows }: { rows: readonly RecordRow[] }) {
  return (
    <div className="overflow-hidden rounded-[calc(var(--radius)*1.15)] border border-border bg-background">
      <div className="grid grid-cols-[1.6fr_0.9fr_0.7fr_0.6fr] gap-3 border-b border-border/80 px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        <span>Dataset</span>
        <span>Status</span>
        <span>Owner</span>
        <span>Updated</span>
      </div>
      <div className="divide-y divide-border/80">
        {rows.map((row) => (
          <div
            key={row.name}
            className="grid grid-cols-[1.6fr_0.9fr_0.7fr_0.6fr] gap-3 px-4 py-4 text-sm"
          >
            <div>
              <p className="font-medium text-foreground">{row.name}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Reference only
              </p>
            </div>
            <p className="text-muted-foreground">{row.status}</p>
            <p className="text-muted-foreground">{row.owner}</p>
            <p className="text-muted-foreground">{row.updated}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsList({ items }: { items: readonly SettingItem[] }) {
  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="grid gap-3 rounded-[calc(var(--radius)*1.05)] border border-border bg-background p-layout-sm md:grid-cols-[180px_1fr]"
        >
          <div>
            <p className="text-sm font-semibold tracking-[-0.01em] text-foreground">
              {item.label}
            </p>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              static reference
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{item.value}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardWorkspaceTemplate() {
  return (
    <ReferencePageShell
      eyebrow="Templates"
      title="Northwind Atlas dashboard"
      description="A hierarchy-first workspace that keeps the top line, the work queue, and the signal rail visible at the same time without falling back to generic analytics cards."
    >
      <div className="grid gap-layout-lg">
        <FrameCard
          title="Workspace header"
          subtitle="The header keeps store identity and decision context at the top while leaving enough room for the page to breathe."
        >
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <StorybookPillRow
                items={["Northwind Atelier", "Accra, GH", "Morning shift", "Last sync 3m ago"]}
              />
              <h2 className="font-display text-[clamp(2.3rem,4vw,3.8rem)] leading-[0.95] tracking-[-0.05em] text-foreground">
                A calm command surface for operators who need the whole store at a glance.
              </h2>
              <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                The reference composition balances editorial hierarchy with compact utility. Big
                numbers stay legible, but the page still makes room for actions, exceptions, and
                the next decision.
              </p>
            </div>
            <div className="grid gap-3">
              <div className="rounded-[calc(var(--radius)*1.1)] border border-border bg-background p-layout-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">Signal posture</p>
                  <span className="rounded-full bg-[hsl(var(--success)/0.14)] px-3 py-1 text-xs font-semibold text-[hsl(var(--success))]">
                    Healthy
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-[hsl(var(--signal))]" />
                  Dashboard reference is fully static.
                </div>
              </div>
              <div className="rounded-[calc(var(--radius)*1.1)] border border-border bg-background p-layout-sm">
                <div className="flex items-center gap-3">
                  <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Primary route</p>
                    <p className="text-sm text-muted-foreground">Inventory, orders, reviews, revenue.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </FrameCard>

        <FrameCard
          title="Critical signals"
          subtitle="High-priority cards should compress the whole morning into a few readable operators' cues."
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {DASHBOARD_METRICS.map((metric) => (
              <MetricTile key={metric.label} {...metric} />
            ))}
          </div>
        </FrameCard>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <FrameCard
            title="Primary revenue curve"
            subtitle="Charts should be simple enough to scan in one glance and specific enough to explain the moment."
          >
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StorybookPillRow items={["24h", "7d baseline", "Month to date"]} />
              </div>
              <MiniTrendChart />
              <p className="text-sm leading-6 text-muted-foreground">
                The chart sits next to supporting context instead of trying to become the whole
                page. That keeps the template readable at a distance and in review mode.
              </p>
            </div>
          </FrameCard>
          <FrameCard
            title="Today's actions"
            subtitle="Action rails work best when they stay tight, time-bound, and intentionally dull."
          >
            <div className="grid gap-3">
              {DASHBOARD_LANES.map((lane) => (
                <LaneCard key={lane.title} {...lane} />
              ))}
            </div>
          </FrameCard>
        </div>

        <FrameCard
          title="Exception notes"
          subtitle="Keep the bottom of the dashboard focused on follow-up, not decoration."
        >
          <StorybookList
            items={[
              "One redlane should surface the thing that would block tomorrow if ignored.",
              "One calm summary should show what changed since the last review pass.",
              "Cards should stay dense enough for operators, but not so tight that reading becomes work.",
            ]}
          />
        </FrameCard>
      </div>
    </ReferencePageShell>
  );
}

export function DataWorkspaceTemplate() {
  return (
    <ReferencePageShell
      eyebrow="Templates"
      title="Northwind Atlas data workspace"
      description="An operational review lane for tables, exception queues, and filters that keeps density high while the structure stays obvious."
    >
      <div className="grid gap-layout-lg">
        <FrameCard
          title="Review posture"
          subtitle="The data workspace should feel like a control room, not a spreadsheet dump."
        >
          <div className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
            <div className="space-y-4">
              <StorybookPillRow
                items={["Table-first", "Exception lanes", "Filters always visible", "Reference only"]}
              />
              <h2 className="font-display text-[clamp(2.15rem,3.5vw,3.4rem)] leading-[0.95] tracking-[-0.05em] text-foreground">
                Review faster without losing the shape of the data.
              </h2>
              <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                This workspace keeps the hierarchy simple: a narrow filter rail, a focused table,
                and a supporting exception column. Everything is static, but the composition still
                mirrors a real operational lane.
              </p>
            </div>
            <div className="grid gap-3">
              <div className="rounded-[calc(var(--radius)*1.05)] border border-border bg-background p-layout-sm">
                <div className="flex items-center gap-3">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Filter stack</p>
                    <p className="text-sm text-muted-foreground">Workspace, owner, state, freshness.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-[calc(var(--radius)*1.05)] border border-border bg-background p-layout-sm">
                <div className="flex items-center gap-3">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Data posture</p>
                    <p className="text-sm text-muted-foreground">Structured, compact, and review-friendly.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </FrameCard>

        <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
          <FrameCard
            title="Primary table"
            subtitle="Rows should carry just enough detail to support a fast decision, then get out of the way."
          >
            <CompactTable rows={DATA_ROWS} />
          </FrameCard>
          <FrameCard
            title="Exception lanes"
            subtitle="Use a side rail for the work that needs escalation or special handling."
          >
            <div className="grid gap-3">
              <LaneCard
                title="Approval queue"
                detail="Pending dataset approvals stay visible until a reviewer clears them."
                meta="4 waiting"
                tone="signal"
              />
              <LaneCard
                title="Stale imports"
                detail="Records that missed a freshness target need a narrow, easy-to-scan lane."
                meta="2 stale"
                tone="warning"
              />
              <LaneCard
                title="Validated lanes"
                detail="A calm summary keeps the team oriented on what already passed review."
                meta="11 done"
                tone="success"
              />
            </div>
          </FrameCard>
        </div>

        <FrameCard
          title="Table rules"
          subtitle="The data workspace is where density matters most, but density still needs rhythm."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[calc(var(--radius)*1.05)] border border-border bg-background p-layout-sm">
              <p className="text-sm font-semibold text-foreground">Scan first</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Keep the first column descriptive and the second column decisive.
              </p>
            </div>
            <div className="rounded-[calc(var(--radius)*1.05)] border border-border bg-background p-layout-sm">
              <p className="text-sm font-semibold text-foreground">Escalate clearly</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Exception rows should read like a lane, not a color change.
              </p>
            </div>
            <div className="rounded-[calc(var(--radius)*1.05)] border border-border bg-background p-layout-sm">
              <p className="text-sm font-semibold text-foreground">Keep actions quiet</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Row actions stay secondary so the data remains the visual lead.
              </p>
            </div>
          </div>
        </FrameCard>
      </div>
    </ReferencePageShell>
  );
}

export function SettingsWorkspaceTemplate() {
  return (
    <ReferencePageShell
      eyebrow="Templates"
      title="Northwind Atlas settings workspace"
      description="A structured admin surface for permissions, density, and publishing decisions that should feel deliberate rather than ornamental."
    >
      <div className="grid gap-layout-lg">
        <FrameCard
          title="Workspace controls"
          subtitle="Settings pages work best when they read like a set of carefully grouped decisions."
        >
          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <StorybookPillRow
                items={["Permissions", "Density", "Brand", "Notifications", "Publishing"]}
              />
              <h2 className="font-display text-[clamp(2.15rem,3.5vw,3.4rem)] leading-[0.95] tracking-[-0.05em] text-foreground">
                Keep administrative decisions structured, calm, and easy to review.
              </h2>
              <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                The settings template gives each control a clear home. Cards group related
                decisions, but the composition stays restrained so the page never feels like a
                marketing layout.
              </p>
            </div>
            <div className="grid gap-3">
              <div className="rounded-[calc(var(--radius)*1.05)] border border-border bg-background p-layout-sm">
                <div className="flex items-center gap-3">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Access surface</p>
                    <p className="text-sm text-muted-foreground">Role-based, reviewable, and static.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-[calc(var(--radius)*1.05)] border border-border bg-background p-layout-sm">
                <div className="flex items-center gap-3">
                  <LifeBuoy className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Support surface</p>
                    <p className="text-sm text-muted-foreground">Help text stays short and contextual.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </FrameCard>

        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <FrameCard
            title="Density guidance"
            subtitle="Density is a setting, not a mood. Reserve compact mode for review-heavy lanes."
          >
            <div className="grid gap-3">
              <div className="rounded-[calc(var(--radius)*1.1)] border border-border bg-background p-layout-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--signal)/0.12)] text-[hsl(var(--signal))]">
                    <Settings2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Standard</p>
                    <p className="text-sm text-muted-foreground">Forms and overview pages.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-[calc(var(--radius)*1.1)] border border-border bg-background p-layout-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning-foreground))]">
                    <ChartColumn className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Compact</p>
                    <p className="text-sm text-muted-foreground">Tables, filters, and audit lanes.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-[calc(var(--radius)*1.1)] border border-border bg-background p-layout-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success))]">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Usage rule</p>
                    <p className="text-sm text-muted-foreground">Compact mode should make comparison easier, not harder.</p>
                  </div>
                </div>
              </div>
            </div>
          </FrameCard>
          <FrameCard
            title="Permission matrix"
            subtitle="Authorization should read like a policy table, not a dashboard widget."
          >
            <div className="grid gap-3">
              <div className="grid gap-3 rounded-[calc(var(--radius)*1.05)] border border-border bg-background p-layout-sm md:grid-cols-[160px_1fr]">
                <div>
                  <p className="text-sm font-semibold text-foreground">Editors</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Workspace updates
                  </p>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Can update copy, reorder sections, and stage changes for review.
                </p>
              </div>
              <div className="grid gap-3 rounded-[calc(var(--radius)*1.05)] border border-border bg-background p-layout-sm md:grid-cols-[160px_1fr]">
                <div>
                  <p className="text-sm font-semibold text-foreground">Approvers</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Policy changes
                  </p>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Validate dense modes, publishing permissions, and visible escalation paths.
                </p>
              </div>
              <div className="grid gap-3 rounded-[calc(var(--radius)*1.05)] border border-border bg-background p-layout-sm md:grid-cols-[160px_1fr]">
                <div>
                  <p className="text-sm font-semibold text-foreground">Operators</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Daily usage
                  </p>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Use the workspace as a stable reference for checking current posture.
                </p>
              </div>
            </div>
          </FrameCard>
        </div>

        <FrameCard
          title="Settings rules"
          subtitle="Cards should group intent, but the page still needs clear section titles and small helper copy."
        >
          <SettingsList items={SETTINGS_ITEMS} />
        </FrameCard>
      </div>
    </ReferencePageShell>
  );
}
