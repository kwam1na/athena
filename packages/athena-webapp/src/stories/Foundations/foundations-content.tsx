import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import {
  StorybookCallout,
  StorybookSection,
  StorybookShell,
} from "../storybook-shell";

type ColorRole = {
  label: string;
  token: `--${string}`;
  foregroundToken: `--${string}`;
  detail: string;
};

type TypeSpecimen = {
  label: string;
  sample: string;
  note: string;
  className?: string;
};

type SpaceToken = {
  label: string;
  token: `--${string}`;
  detail: string;
};

type DensityProfile = {
  label: string;
  description: string;
  controlToken: `--${string}`;
  summary: string;
};

type MotionToken = {
  label: string;
  detail: string;
  animationClassName: string;
  durationToken: `--${string}`;
};

type DetailViewRole = {
  label: string;
  detail: string;
  className: string;
};

const COLOR_ROLES: readonly ColorRole[] = [
  {
    label: "Shell / ink",
    token: "--shell",
    foregroundToken: "--shell-foreground",
    detail: "Deep navigation and shell framing that keeps the workspace anchored.",
  },
  {
    label: "Surface / raised",
    token: "--surface-raised",
    foregroundToken: "--foreground",
    detail: "Clean working planes for dialogs, inspectors, and focused content.",
  },
  {
    label: "Canvas / background",
    token: "--background",
    foregroundToken: "--foreground",
    detail: "Warm neutral canvas that softens contrast without losing scan speed.",
  },
  {
    label: "Signal / action",
    token: "--signal",
    foregroundToken: "--signal-foreground",
    detail: "Single-action accent for primary buttons, focus, and key decisions.",
  },
  {
    label: "Success / trust",
    token: "--success",
    foregroundToken: "--success-foreground",
    detail: "Confirmation states that stay operational instead of celebratory.",
  },
  {
    label: "Warning / risk",
    token: "--warning",
    foregroundToken: "--warning-foreground",
    detail: "Attention states for pending follow-up, limits, and degraded flows.",
  },
];

const TYPOGRAPHY_SPECIMENS: readonly TypeSpecimen[] = [
  {
    label: "Display sans",
    sample: "Retail operations, sharply framed.",
    note: "Use for page anchors, hero numerics, and authored section titles.",
    className:
      "font-display text-[clamp(2rem,3vw,3rem)] leading-[1.02] tracking-[-0.04em]",
  },
  {
    label: "Shell heading",
    sample: "Current store performance",
    note: "Primary hierarchy for shells, headers, and workspace landmarks.",
    className: "font-display text-3xl leading-tight tracking-[-0.03em]",
  },
  {
    label: "UI sans",
    sample: "Filters, controls, and table labels stay calm and easy to scan.",
    note: "Default copy for controls, labels, table content, and helper text.",
    className: "font-sans text-base leading-7 tracking-[-0.01em]",
  },
  {
    label: "Numeric emphasis",
    sample: "GHS 128,450",
    note: "Pair with the display family when numbers are the main signal.",
    className: "font-display text-[2.4rem] leading-none tracking-[-0.05em]",
  },
  {
    label: "Operational numerics",
    sample: "GH₵0",
    note: "Use the theme family with tabular number styling for cash totals and ledger amounts.",
    className: "font-numeric text-[2.4rem] leading-none tabular-nums",
  },
];

const SPACE_TOKENS: readonly SpaceToken[] = [
  {
    label: "Micro",
    token: "--space-xs",
    detail: "Tight label-to-control rhythm and compact table chrome.",
  },
  {
    label: "Component",
    token: "--space-md",
    detail: "Default spacing between related controls and content blocks.",
  },
  {
    label: "Section",
    token: "--space-xl",
    detail: "Standard breathing room between shell modules on a working page.",
  },
  {
    label: "Scene",
    token: "--space-2xl",
    detail: "Large editorial spacing for shell transitions and staged templates.",
  },
];

const DENSITY_PROFILES: readonly DensityProfile[] = [
  {
    label: "Standard workspace",
    description: "Comfort-first rhythm for dashboards, forms, and empty states.",
    controlToken: "--control-height-standard",
    summary: "Balanced density for everyday orientation and decision-making.",
  },
  {
    label: "Compact review lane",
    description: "Higher-density rhythm for tables, filters, and inventory review.",
    controlToken: "--control-height-compact",
    summary: "Tighter controls when the priority is comparison, not narrative.",
  },
];

const MOTION_TOKENS: readonly MotionToken[] = [
  {
    label: "Focus sweep",
    detail: "Use for selected rails, hovered rows, and guided attention.",
    animationClassName: "motion-safe:animate-focus-sweep",
    durationToken: "--motion-standard",
  },
  {
    label: "Presence lift",
    detail: "Use for drawers, dialogs, and staged shell reveals.",
    animationClassName: "motion-safe:animate-presence-lift",
    durationToken: "--motion-standard",
  },
  {
    label: "Status breathe",
    detail: "Use for long-running activity and calm pending feedback.",
    animationClassName: "motion-safe:animate-status-breathe",
    durationToken: "--motion-slow",
  },
];

const DETAIL_VIEW_ROLES: readonly DetailViewRole[] = [
  {
    label: "Receipt rail",
    detail: "A narrow left column for status, actor, payment, receipt actions, and totals.",
    className: "xl:col-span-4",
  },
  {
    label: "Item canvas",
    detail: "A broad right column for line items, traces, and review content with room to breathe.",
    className: "xl:col-span-8",
  },
];

const ELEVATION_STYLES = [
  {
    label: "Base plane",
    className: "bg-surface text-foreground",
    shadow: "none",
  },
  {
    label: "Raised surface",
    className: "bg-surface-raised text-foreground shadow-surface",
    shadow: "var(--shadow-surface)",
  },
  {
    label: "Overlay",
    className: "bg-shell text-shell-foreground shadow-overlay",
    shadow: "var(--shadow-overlay)",
  },
] as const;

const hslVar = (token: `--${string}`): CSSProperties => ({
  backgroundColor: `hsl(var(${token}))`,
});

const textVar = (token: `--${string}`): CSSProperties => ({
  color: `hsl(var(${token}))`,
});

function ColorRoleCard({ detail, foregroundToken, label, token }: ColorRole) {
  return (
    <div className="overflow-hidden rounded-[calc(var(--radius)*1.4)] border border-border bg-surface shadow-surface">
      <div
        className="flex min-h-28 items-end px-layout-md py-layout-sm"
        style={{
          ...hslVar(token),
          ...textVar(foregroundToken),
        }}
      >
        <span className="rounded-full border border-current/20 bg-black/10 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.24em]">
          {label}
        </span>
      </div>
      <div className="space-y-2 px-layout-md py-layout-md">
        <p className="text-sm font-semibold tracking-[-0.01em] text-foreground">
          {label}
        </p>
        <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function TypeSpecimenCard({ className, label, note, sample }: TypeSpecimen) {
  return (
    <div className="rounded-[calc(var(--radius)*1.2)] border border-border bg-surface-raised p-layout-md shadow-surface">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {label}
          </p>
          <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            token driven
          </span>
        </div>
        <p className={cn("text-balance text-foreground", className)}>{sample}</p>
        <p className="text-sm leading-6 text-muted-foreground">{note}</p>
      </div>
    </div>
  );
}

function SpaceTokenRow({ detail, label, token }: SpaceToken) {
  return (
    <div className="grid gap-3 rounded-[calc(var(--radius)*1.1)] border border-border/80 bg-surface p-layout-sm md:grid-cols-[140px_140px_1fr] md:items-center">
      <div className="text-sm font-semibold tracking-[-0.01em] text-foreground">
        {label}
      </div>
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 rounded-full bg-signal" />
        <span
          className="block rounded-full bg-signal/25"
          style={{ height: "0.5rem", width: `var(${token})` }}
        />
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}

function DensityCard({
  controlToken,
  description,
  label,
  summary,
}: DensityProfile) {
  return (
    <div className="rounded-[calc(var(--radius)*1.2)] border border-border bg-surface-raised p-layout-md shadow-surface">
      <div className="space-y-3">
        <div>
          <h3 className="font-display text-xl tracking-[-0.03em] text-foreground">
            {label}
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="space-y-3 rounded-[calc(var(--radius)*0.95)] border border-border/70 bg-background p-layout-sm">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-sm font-medium text-foreground">Store status</p>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Connected and collecting signals
              </p>
            </div>
            <button
              className="rounded-full bg-signal px-4 text-sm font-semibold text-signal-foreground opacity-80"
              disabled
              style={{ height: `var(${controlToken})` }}
              type="button"
            >
              Review
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-[calc(var(--radius)*0.8)] border border-border bg-surface p-layout-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Revenue
              </p>
              <p className="mt-1 font-display text-2xl tracking-[-0.04em] text-foreground">
                GHS 18.4k
              </p>
            </div>
            <div className="rounded-[calc(var(--radius)*0.8)] border border-border bg-surface p-layout-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Returns
              </p>
              <p className="mt-1 font-display text-2xl tracking-[-0.04em] text-foreground">
                1.8%
              </p>
            </div>
          </div>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{summary}</p>
      </div>
    </div>
  );
}

function MotionCard({ animationClassName, detail, durationToken, label }: MotionToken) {
  return (
    <div className="rounded-[calc(var(--radius)*1.1)] border border-border bg-surface p-layout-md shadow-surface">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[-0.01em] text-foreground">
            {label}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {`var(${durationToken})`}
        </span>
      </div>
      <div className="mt-4 overflow-hidden rounded-full bg-shell/10 p-1">
        <div className={cn("h-3 w-1/3 rounded-full bg-signal", animationClassName)} />
      </div>
    </div>
  );
}

function DetailViewRoleCard({ className, detail, label }: DetailViewRole) {
  return (
    <div
      className={cn(
        "rounded-[calc(var(--radius)*1.15)] border border-border/80 bg-background p-layout-sm",
        className,
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6 text-foreground/85">{detail}</p>
    </div>
  );
}

function DetailViewSpecimen() {
  return (
    <div className="rounded-[calc(var(--radius)*1.35)] border border-border bg-surface-raised p-layout-md shadow-surface">
      <div className="mb-layout-md flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-layout-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Detail view
          </p>
          <h3 className="mt-2 font-display text-2xl tracking-[-0.04em] text-foreground">
            Transaction workspace
          </h3>
        </div>
        <span className="rounded-full border border-[hsl(var(--success)/0.24)] bg-[hsl(var(--success)/0.08)] px-3 py-1 text-xs font-semibold text-[hsl(var(--success))]">
          Completed
        </span>
      </div>

      <div className="grid gap-layout-md xl:grid-cols-12">
        {DETAIL_VIEW_ROLES.map((role) => (
          <DetailViewRoleCard key={role.label} {...role} />
        ))}
      </div>

      <div className="mt-layout-md grid gap-layout-md xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-[calc(var(--radius)*1.2)] border border-border/80 bg-surface shadow-surface">
          <div className="border-b border-border/70 px-layout-md py-layout-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Transaction summary
            </p>
            <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-foreground">
              Sale recorded
            </p>
          </div>
          <div className="space-y-3 px-layout-md py-layout-md text-sm">
            {[
              ["Transaction", "#195161"],
              ["Payment", "Cash payment"],
              ["Cashier", "Kwamina M."],
              ["Items", "1 item"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-foreground">{value}</span>
              </div>
            ))}
            <div className="border-t border-border/70 pt-layout-sm">
              <div className="flex items-end justify-between gap-4">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Total
                </span>
                <span className="font-display text-3xl tracking-[-0.05em] text-foreground">
                  GHS 350
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[calc(var(--radius)*1.2)] border border-border/80 bg-[linear-gradient(145deg,hsl(var(--surface-raised))_0%,hsl(var(--surface))_56%,hsl(var(--muted)/0.55)_100%)] p-layout-md shadow-surface">
          <div className="mb-layout-md flex items-center justify-between gap-4">
            <p className="text-sm font-semibold text-foreground">Items · 1</p>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Review canvas
            </p>
          </div>
          <div className="rounded-[calc(var(--radius)*0.95)] border border-border bg-background p-layout-sm">
            <div className="grid gap-3 sm:grid-cols-[56px_1fr_auto] sm:items-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-[calc(var(--radius)*0.85)] bg-muted text-muted-foreground">
                1
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Og Skywalker</p>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  6N2Y-TZ5-JFF
                </p>
              </div>
              <p className="text-sm font-semibold text-foreground">GHS 350</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function AthenaFoundationsPage() {
  return (
    <StorybookShell
      eyebrow="Foundations"
      title="Athena semantic design foundations"
      description="A retail-operations token system built around warm neutral canvases, inked shell surfaces, a single action signal, and editorial typography that can guide later primitive and shell tickets."
    >
      <StorybookCallout title="Review cues">
        Toggle the Storybook theme toolbar while reviewing these foundations. The
        token set is designed to keep shell hierarchy, numerics, and action states
        legible in both light and dark mode before the next primitive and pattern
        passes land.
      </StorybookCallout>

      <StorybookSection
        title="Color roles"
        description="Athena keeps one action family and a small set of operational feedback roles. The shell stays dark and grounded while working planes stay warm and quiet."
      >
        <div className="grid gap-layout-md lg:grid-cols-2 xl:grid-cols-3">
          {COLOR_ROLES.map((role) => (
            <ColorRoleCard key={role.label} {...role} />
          ))}
        </div>
      </StorybookSection>

      <StorybookSection
        title="Typography system"
        description="Display typography gives Athena identity at the shell level while the UI sans keeps controls, tables, and helper copy steady."
      >
        <div className="grid gap-layout-md lg:grid-cols-2">
          {TYPOGRAPHY_SPECIMENS.map((specimen) => (
            <TypeSpecimenCard key={specimen.label} {...specimen} />
          ))}
        </div>
      </StorybookSection>

      <StorybookSection
        title="Spacing and density"
        description="The spacing scale favors staged shell composition, while density switches are reserved for review-heavy interfaces such as tables, filters, and inventory operations."
      >
        <div className="grid gap-layout-lg xl:grid-cols-[1.1fr_1fr]">
          <div className="space-y-layout-sm">
            {SPACE_TOKENS.map((token) => (
              <SpaceTokenRow key={token.label} {...token} />
            ))}
          </div>
          <div className="grid gap-layout-md">
            {DENSITY_PROFILES.map((profile) => (
              <DensityCard key={profile.label} {...profile} />
            ))}
          </div>
        </div>
      </StorybookSection>

      <StorybookSection
        title="Detail view system"
        description="The transaction view establishes Athena's default detail-view language: a receipt rail paired with a large item canvas."
      >
        <DetailViewSpecimen />
      </StorybookSection>

      <StorybookSection
        title="Elevation and motion"
        description="Elevation stays restrained and practical. Motion is short, deliberate, and reserved for attention guidance, overlays, and status."
      >
        <div className="grid gap-layout-lg xl:grid-cols-[1fr_1.15fr]">
          <div className="grid gap-layout-sm">
            {ELEVATION_STYLES.map((elevation) => (
              <div
                key={elevation.label}
                className={cn(
                  "rounded-[calc(var(--radius)*1.2)] border border-border p-layout-md",
                  elevation.className,
                )}
              >
                <p className="text-sm font-semibold tracking-[-0.01em]">
                  {elevation.label}
                </p>
                <p className="mt-2 text-sm leading-6 text-current/75">
                  {elevation.shadow}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-layout-sm">
            {MOTION_TOKENS.map((motion) => (
              <MotionCard key={motion.label} {...motion} />
            ))}
          </div>
        </div>
      </StorybookSection>
    </StorybookShell>
  );
}
