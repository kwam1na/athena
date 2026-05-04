import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  FileText,
  ReceiptText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import View from "@/components/View";
import { cn } from "@/lib/utils";

import {
  StorybookCallout,
  StorybookList,
  StorybookSection,
  StorybookShell,
} from "../storybook-shell";

const VIEW_MODES = [
  {
    title: "Contained workspace",
    description:
      "Default shell for bounded work: a header, a bordered surface, and an internal scroll region.",
  },
  {
    title: "Full-width operations",
    description:
      "Use full width when the operator needs more canvas for registers, ledgers, or multi-column review.",
  },
  {
    title: "Page-scrolling view",
    description:
      "Use page scroll when the content should read as stacked sections instead of a fixed workspace.",
  },
  {
    title: "Borderless nested pane",
    description:
      "Use borderless mode when another parent surface already provides the frame.",
  },
] as const;

const JOURNEY_ROWS = [
  ["checkout start", "Started", "101"],
  ["bag view", "Viewed", "256"],
  ["payment submission", "Needs attention", "12"],
  ["receipt issued", "Succeeded", "84"],
] as const;

const SETTINGS_SECTIONS: readonly {
  title: string;
  detail: string;
  Icon: LucideIcon;
}[] = [
  {
    title: "Pickup rules",
    detail: "Set handoff windows and team ownership.",
    Icon: CheckCircle2,
  },
  {
    title: "Payment methods",
    detail: "Keep supported tender routes visible.",
    Icon: ReceiptText,
  },
  {
    title: "Exception handling",
    detail: "Route blocked changes to operator review.",
    Icon: AlertTriangle,
  },
] as const;

function ExampleHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: string;
}) {
  return (
    <div className="flex min-h-[72px] items-center justify-between gap-4 px-layout-md py-layout-sm">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          {eyebrow}
        </p>
        <h3 className="mt-1 truncate font-display text-xl tracking-[-0.03em] text-foreground">
          {title}
        </h3>
      </div>
      {action ? (
        <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm">
          {action}
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </button>
      ) : null}
    </div>
  );
}

function MetricStrip() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {[
        ["Open adjustments", "18", "7 awaiting review"],
        ["Stock variance", "GHS 4.8k", "Across 3 departments"],
        ["Resolved today", "42", "12 more than baseline"],
      ].map(([label, value, detail]) => (
        <div
          key={label}
          className="rounded-lg border border-border bg-surface-raised p-layout-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-3 font-display text-3xl leading-none text-foreground">
            {value}
          </p>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">{detail}</p>
        </div>
      ))}
    </div>
  );
}

function JourneyTable() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="grid grid-cols-[1fr_160px_80px] border-b border-border bg-muted/40 px-layout-sm py-3 text-sm font-medium text-muted-foreground">
        <span>Step</span>
        <span>Status</span>
        <span className="text-right">Events</span>
      </div>
      {JOURNEY_ROWS.map(([step, status, count]) => (
        <div
          key={step}
          className="grid grid-cols-[1fr_160px_80px] items-center border-b border-border px-layout-sm py-3 text-sm last:border-b-0"
        >
          <span className="font-medium text-foreground">{step}</span>
          <span
            className={cn(
              "w-fit rounded-full px-2.5 py-1 text-xs font-semibold",
              status === "Needs attention"
                ? "bg-danger text-danger-foreground"
                : "bg-muted text-foreground",
            )}
          >
            {status}
          </span>
          <span className="text-right tabular-nums text-muted-foreground">
            {count}
          </span>
        </div>
      ))}
    </div>
  );
}

function ContainedWorkspaceExample() {
  return (
    <div className="h-[420px] rounded-[calc(var(--radius)*1.35)] bg-muted/35 p-layout-md">
      <View
        header={<ExampleHeader eyebrow="Inventory" title="Stock adjustments" action="Review" />}
        mainClassName="p-layout-md"
      >
        <div className="space-y-layout-md">
          <MetricStrip />
          <JourneyTable />
        </div>
      </View>
    </div>
  );
}

function FullWidthOperationsExample() {
  return (
    <div className="h-[420px] rounded-[calc(var(--radius)*1.35)] bg-muted/35 p-layout-md">
      <View
        width="full"
        header={<ExampleHeader eyebrow="Cash controls" title="Register closeout" />}
        mainClassName="grid gap-layout-md p-layout-md lg:grid-cols-[1.25fr_0.75fr]"
      >
        <div className="rounded-lg border border-border bg-surface-raised p-layout-md">
          <p className="text-sm font-semibold text-foreground">Drawer movement</p>
          <div className="mt-5 grid h-44 grid-cols-8 items-end gap-2">
            {[54, 72, 48, 86, 64, 92, 76, 88].map((height, index) => (
              <div
                key={`${height}-${index}`}
                className="rounded-t-md bg-[hsl(var(--signal)/0.55)]"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>
        <div className="grid gap-3">
          {[
            ["Expected cash", "GHS 3,420.00"],
            ["Counted cash", "GHS 3,400.00"],
            ["Variance", "GHS -20.00"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-background p-layout-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {label}
              </p>
              <p className="mt-2 font-display text-2xl text-foreground">{value}</p>
            </div>
          ))}
        </div>
      </View>
    </div>
  );
}

function PageScrollingExample() {
  return (
    <div className="h-[420px] rounded-[calc(var(--radius)*1.35)] bg-muted/35 p-layout-md">
      <View
        fullHeight
        scrollMode="page"
        header={<ExampleHeader eyebrow="Settings" title="Store operations" />}
        mainClassName="space-y-layout-md p-layout-md"
      >
        {SETTINGS_SECTIONS.map(({ title, detail, Icon }) => (
          <section
            key={String(title)}
            className="grid gap-layout-md border-b border-border pb-layout-md last:border-b-0 md:grid-cols-[220px_1fr]"
          >
            <div>
              <Icon className="mb-3 h-5 w-5 text-muted-foreground" />
              <h4 className="font-display text-xl tracking-[-0.03em] text-foreground">
                {title}
              </h4>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
          </section>
        ))}
      </View>
    </div>
  );
}

function BorderlessNestedExample() {
  return (
    <div className="rounded-[calc(var(--radius)*1.35)] border border-border bg-surface-raised p-layout-md shadow-surface">
      <div className="mb-layout-md flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Parent surface
          </p>
          <h3 className="mt-1 font-display text-xl tracking-[-0.03em] text-foreground">
            Order review
          </h3>
        </div>
        <Boxes className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="h-[280px] rounded-lg border border-border bg-background/70 p-layout-sm">
        <View
          hideBorder
          hideHeaderBottomBorder
          header={<ExampleHeader eyebrow="Nested pane" title="Line items" />}
          mainClassName="space-y-3 p-layout-sm"
        >
          {["Lace front install", "Conditioning service", "Pickup packaging"].map(
            (item) => (
              <div
                key={item}
                className="flex items-center justify-between border-b border-border pb-3 text-sm last:border-b-0"
              >
                <span className="font-medium text-foreground">{item}</span>
                <span className="text-muted-foreground">Ready</span>
              </div>
            ),
          )}
        </View>
      </div>
    </div>
  );
}

function EmptyStateExample() {
  return (
    <div className="h-[280px] rounded-[calc(var(--radius)*1.35)] bg-muted/35 p-layout-md">
      <View
        header={<ExampleHeader eyebrow="State wrapper" title="No exceptions" />}
        mainClassName="grid place-items-center p-layout-md"
      >
        <div className="max-w-sm text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <h4 className="mt-4 font-display text-2xl tracking-[-0.03em] text-foreground">
            Nothing needs review
          </h4>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Keep the same shell in calm states so the page does not jump when data arrives.
          </p>
        </div>
      </View>
    </div>
  );
}

export function ViewUsagePatterns() {
  return (
    <StorybookShell
      eyebrow="Patterns"
      title="View component usage"
      description="The View component frames Athena workspaces. Use it deliberately: choose the shell mode, scroll behavior, width, and border treatment that match the operator task."
    >
      <StorybookCallout title="Design contract">
        `View` is the bounded workspace shell. It owns the optional header slot, the surface
        border, page-vs-content scrolling, contained-vs-full width, and the cases where a
        nested pane should inherit framing from its parent.
      </StorybookCallout>

      <StorybookSection
        title="Usage map"
        description="These are the app-level modes worth preserving as the primitive gets refined."
      >
        <StorybookList items={VIEW_MODES.map((mode) => `${mode.title}: ${mode.description}`)} />
      </StorybookSection>

      <StorybookSection
        title="Contained workspace"
        description="Default mode for product, order, stock, and review workflows that need their own header and internal scroll."
      >
        <ContainedWorkspaceExample />
      </StorybookSection>

      <StorybookSection
        title="Full-width operations"
        description="Use `width='full'` when the workspace should span the shell and support wider comparisons."
      >
        <FullWidthOperationsExample />
      </StorybookSection>

      <StorybookSection
        title="Page-scrolling sections"
        description="Use `scrollMode='page'` when the content should move as a document inside the shell."
      >
        <PageScrollingExample />
      </StorybookSection>

      <StorybookSection
        title="Borderless nested panes"
        description="Use `hideBorder` and `hideHeaderBottomBorder` when a parent card or workflow surface already provides the outer frame."
      >
        <BorderlessNestedExample />
      </StorybookSection>

      <StorybookSection
        title="State wrappers"
        description="Use the same shell for empty, blocked, or loading states so resolved data does not cause a page-level layout shift."
      >
        <EmptyStateExample />
      </StorybookSection>
    </StorybookShell>
  );
}
