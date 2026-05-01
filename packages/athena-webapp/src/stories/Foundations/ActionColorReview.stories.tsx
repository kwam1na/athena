import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { cn } from "@/lib/utils";

import {
  StorybookCallout,
  StorybookSection,
  StorybookShell,
} from "../storybook-shell";

type AppColorTokenStyle = CSSProperties & Record<`--app-${string}`, string>;

const APP_COLOR_TOKENS: AppColorTokenStyle = {
  "--app-canvas": "42 44% 98%",
  "--app-surface": "0 0% 100%",
  "--app-surface-subtle": "38 34% 94%",
  "--app-border": "218 17% 86%",
  "--app-text": "222 28% 16%",
  "--app-text-muted": "219 12% 39%",
  "--app-shell": "223 34% 14%",
  "--app-shell-text": "35 42% 95%",

  "--app-action-commit": "338 62% 43%",
  "--app-action-commit-text": "336 100% 98%",
  "--app-action-workflow": "232 42% 45%",
  "--app-action-workflow-text": "232 100% 98%",
  "--app-action-workflow-soft": "232 58% 96%",
  "--app-action-workflow-border": "232 38% 82%",
  "--app-action-neutral": "215 18% 37%",
  "--app-action-neutral-soft": "220 20% 96%",

  "--app-success": "151 42% 34%",
  "--app-success-soft": "146 48% 94%",
  "--app-warning": "35 79% 52%",
  "--app-warning-soft": "39 92% 93%",
  "--app-danger": "4 71% 54%",
  "--app-danger-soft": "4 84% 96%",
  "--app-info": "205 56% 38%",
  "--app-info-soft": "204 68% 95%",

  "--app-data-1": "338 62% 43%",
  "--app-data-2": "232 42% 45%",
  "--app-data-3": "156 40% 34%",
  "--app-data-4": "37 82% 59%",
  "--app-data-5": "278 34% 48%",
};

type ColorRole = {
  name: string;
  token: string;
  value: string;
  textToken?: string;
  description: string;
  use: string;
};

const CORE_ROLES: ColorRole[] = [
  {
    name: "Canvas",
    token: "--background",
    value: "42 44% 98%",
    description: "The default app page background.",
    use: "Workspace backgrounds, app shell content area.",
  },
  {
    name: "Surface",
    token: "--surface-raised",
    value: "0 0% 100%",
    description: "Primary elevated working surface.",
    use: "Cards, forms, rails, dialogs, popovers.",
  },
  {
    name: "Subtle Surface",
    token: "--surface-muted",
    value: "38 34% 94%",
    description: "Quiet surface for grouped controls.",
    use: "Table headers, nested panels, inactive rows.",
  },
  {
    name: "Border",
    token: "--border",
    value: "218 17% 86%",
    description: "Low-contrast structural boundary.",
    use: "Cards, dividers, inputs, table rows.",
  },
  {
    name: "Text",
    token: "--foreground",
    value: "222 28% 16%",
    description: "Primary reading color.",
    use: "Headings, body text, critical values.",
  },
  {
    name: "Muted Text",
    token: "--muted-foreground",
    value: "219 12% 39%",
    description: "Secondary text without disappearing.",
    use: "Labels, helper text, timestamps, metadata.",
  },
];

const ACTION_ROLES: ColorRole[] = [
  {
    name: "Commit",
    token: "--action-commit",
    value: "338 62% 43%",
    textToken: "--action-commit-foreground",
    description: "Final or high-consequence action.",
    use: "Submit correction, complete sale, close drawer, confirm.",
  },
  {
    name: "Workflow",
    token: "--action-workflow",
    value: "232 42% 45%",
    textToken: "--action-workflow-foreground",
    description: "Enter, inspect, or navigate a reversible tool state.",
    use: "Correct, view trace, selected correction, lookup workflows.",
  },
  {
    name: "Neutral",
    token: "--action-neutral",
    value: "215 18% 37%",
    description: "Useful but secondary utility action.",
    use: "View receipt, cancel, exit, dismiss.",
  },
];

const STATUS_ROLES: ColorRole[] = [
  {
    name: "Success",
    token: "--success",
    value: "151 42% 34%",
    description: "Completed or healthy state.",
    use: "Completed sale, active session, successful sync.",
  },
  {
    name: "Warning",
    token: "--warning",
    value: "35 79% 52%",
    description: "Attention without failure.",
    use: "Pending counts, variance review, degraded workflow.",
  },
  {
    name: "Danger",
    token: "--danger",
    value: "4 71% 54%",
    description: "Failed, destructive, or blocking state.",
    use: "Voids, destructive actions, negative variance.",
  },
  {
    name: "Info",
    token: "--info",
    value: "205 56% 38%",
    description: "Operational context and review states.",
    use: "Trace metadata, informative banners, workflow notes.",
  },
];

const DATA_ROLES: ColorRole[] = [
  { name: "Data 1", token: "--chart-1", value: "338 62% 43%", description: "Primary business measure.", use: "Revenue or primary metric." },
  { name: "Data 2", token: "--chart-2", value: "232 42% 45%", description: "Secondary comparison measure.", use: "Orders, sessions, or conversion." },
  { name: "Data 3", token: "--chart-3", value: "156 40% 34%", description: "Positive operational measure.", use: "Completion, retention, stock health." },
  { name: "Data 4", token: "--chart-4", value: "37 82% 59%", description: "Attention measure.", use: "Pending, review, variance." },
  { name: "Data 5", token: "--chart-5", value: "278 34% 48%", description: "Tertiary distinction.", use: "Optional segment in dense charts." },
];

function TokenScope({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[calc(var(--radius)*1.35)] bg-[hsl(var(--app-canvas))] p-5 text-[hsl(var(--app-text))]"
      style={APP_COLOR_TOKENS}
    >
      {children}
    </div>
  );
}

function Swatch({ role }: { role: ColorRole }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--app-border))] bg-[hsl(var(--app-surface))] p-3">
      <div
        className="h-16 rounded-md border border-black/5"
        style={{ background: `hsl(${role.value})` }}
      />
      <div className="mt-3 space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">{role.name}</p>
          <code className="text-[11px] text-[hsl(var(--app-text-muted))]">
            {role.token}
          </code>
        </div>
        <p className="text-xs text-[hsl(var(--app-text-muted))]">{role.value}</p>
        <p className="text-xs leading-5 text-[hsl(var(--app-text-muted))]">
          {role.use}
        </p>
      </div>
    </div>
  );
}

function SwatchGrid({ roles }: { roles: ColorRole[] }) {
  return (
    <TokenScope>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => (
          <Swatch key={role.token} role={role} />
        ))}
      </div>
    </TokenScope>
  );
}

function AppButton({
  children,
  tone,
}: {
  children: string;
  tone: "commit" | "workflow" | "workflowSoft" | "neutral" | "danger";
}) {
  const className =
    tone === "commit"
      ? "border-[hsl(var(--app-action-commit))] bg-[hsl(var(--app-action-commit))] text-[hsl(var(--app-action-commit-text))] hover:bg-[hsl(var(--app-action-commit)/0.9)]"
      : tone === "workflow"
        ? "border-[hsl(var(--app-action-workflow))] bg-[hsl(var(--app-action-workflow))] text-[hsl(var(--app-action-workflow-text))] hover:bg-[hsl(var(--app-action-workflow)/0.9)]"
        : tone === "workflowSoft"
          ? "border-[hsl(var(--app-action-workflow-border))] bg-[hsl(var(--app-action-workflow-soft))] text-[hsl(var(--app-action-workflow))] hover:bg-[hsl(var(--app-action-workflow-soft)/0.74)]"
          : tone === "danger"
            ? "border-[hsl(var(--app-danger))] bg-[hsl(var(--app-danger))] text-white hover:bg-[hsl(var(--app-danger)/0.9)]"
            : "border-[hsl(var(--app-border))] bg-[hsl(var(--app-surface))] text-[hsl(var(--app-action-neutral))] hover:bg-[hsl(var(--app-action-neutral-soft))]";

  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors",
        className,
      )}
      type="button"
    >
      {children}
    </button>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "danger" | "info";
}) {
  const className = {
    success:
      "border-[hsl(var(--app-success)/0.2)] bg-[hsl(var(--app-success-soft))] text-[hsl(var(--app-success))]",
    warning:
      "border-[hsl(var(--app-warning)/0.28)] bg-[hsl(var(--app-warning-soft))] text-[hsl(var(--app-warning))]",
    danger:
      "border-[hsl(var(--app-danger)/0.24)] bg-[hsl(var(--app-danger-soft))] text-[hsl(var(--app-danger))]",
    info: "border-[hsl(var(--app-info)/0.22)] bg-[hsl(var(--app-info-soft))] text-[hsl(var(--app-info))]",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
        className,
      )}
    >
      {label}
    </span>
  );
}

function ProductFitExample() {
  return (
    <TokenScope>
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="overflow-hidden rounded-xl border border-[hsl(var(--app-border))] bg-[hsl(var(--app-surface))]">
          <div className="space-y-4 border-b border-[hsl(var(--app-border))] p-5">
            <StatusPill label="Completed · 2 hours ago" tone="success" />
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-[hsl(var(--app-text-muted))]">
                  Cashier
                </dt>
                <dd className="mt-1 font-medium">Kwamina M.</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-[hsl(var(--app-text-muted))]">
                  Payment
                </dt>
                <dd className="mt-1 font-medium">Mobile Money</dd>
              </div>
            </dl>
            <div className="grid grid-cols-2 gap-3">
              <AppButton tone="workflow">Correct</AppButton>
              <AppButton tone="neutral">View receipt</AppButton>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <h3 className="text-lg font-semibold">Transaction correction</h3>
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[hsl(var(--app-text-muted))]">
                Direct corrections
              </p>
              <AppButton tone="workflowSoft">Customer attribution</AppButton>
              <div className="rounded-lg border border-[hsl(var(--app-border))] bg-[hsl(var(--app-surface-subtle))] p-4">
                <p className="text-sm font-medium">Customer correction</p>
                <p className="mt-1 text-sm leading-6 text-[hsl(var(--app-text-muted))]">
                  Staff sign-in and customer lookup will update attribution only.
                </p>
                <div className="mt-3">
                  <AppButton tone="commit">Submit customer correction</AppButton>
                </div>
              </div>
              <AppButton tone="neutral">Payment method</AppButton>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[hsl(var(--app-border))] bg-[hsl(var(--app-surface))] p-5">
          <div className="flex flex-wrap gap-2">
            <StatusPill label="Active" tone="success" />
            <StatusPill label="Needs count" tone="warning" />
            <StatusPill label="Variance" tone="danger" />
            <StatusPill label="Trace available" tone="info" />
          </div>
          <div className="mt-6 grid h-48 grid-cols-5 items-end gap-3 rounded-lg bg-[hsl(var(--app-surface-subtle))] p-4">
            {DATA_ROLES.map((role, index) => (
              <div
                key={role.token}
                className="rounded-t-md"
                style={{
                  background: `hsl(${role.value})`,
                  height: `${42 + index * 12}%`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </TokenScope>
  );
}

function AppColorSystemPage() {
  return (
    <StorybookShell
      eyebrow="Foundations"
      title="App Color System"
      description="Storybook-only proposal for the semantic colors Athena should use across product UI before any product token changes."
    >
      <StorybookSection
        title="System rule"
        description="Colors should communicate role before mood. A user should be able to tell whether something is a surface, a workflow action, a final commit, a status, or a data series without decoding the local feature."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <StorybookCallout title="Foundation">
            Neutral surfaces and text do most of the work. They should stay calm,
            readable, and consistent across admin workflows.
          </StorybookCallout>
          <StorybookCallout title="Actions">
            Split reversible workflow actions from final commit actions. This
            keeps orange from becoming the only way to say “important.”
          </StorybookCallout>
          <StorybookCallout title="Status and data">
            Status colors describe state. Chart colors describe comparison. They
            can share hues, but not component meaning.
          </StorybookCallout>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Core neutrals"
        description="The app should feel quiet and operational before any accent appears."
      >
        <SwatchGrid roles={CORE_ROLES} />
      </StorybookSection>

      <StorybookSection
        title="Action roles"
        description="This is the core change: keep warm signal for final commits, add a cooler workflow role for reversible mode changes and selections."
      >
        <SwatchGrid roles={ACTION_ROLES} />
        <TokenScope>
          <div className="flex flex-wrap gap-2">
            <AppButton tone="commit">Submit correction</AppButton>
            <AppButton tone="workflow">Correct</AppButton>
            <AppButton tone="workflowSoft">Selected correction</AppButton>
            <AppButton tone="neutral">View receipt</AppButton>
            <AppButton tone="danger">Void transaction</AppButton>
          </div>
        </TokenScope>
      </StorybookSection>

      <StorybookSection
        title="Status roles"
        description="Status tokens should be constrained to state labels, banners, and operational feedback."
      >
        <SwatchGrid roles={STATUS_ROLES} />
      </StorybookSection>

      <StorybookSection
        title="Data roles"
        description="Chart colors remain a separate sequence so reports do not overload action or status semantics."
      >
        <SwatchGrid roles={DATA_ROLES} />
      </StorybookSection>

      <StorybookSection
        title="Product fit"
        description="The same palette applied to the POS correction problem and a compact operational chart."
      >
        <ProductFitExample />
      </StorybookSection>
    </StorybookShell>
  );
}

const meta = {
  title: "Foundations/App Color System",
  component: AppColorSystemPage,
} satisfies Meta<typeof AppColorSystemPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
