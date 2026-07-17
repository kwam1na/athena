import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

// Near-pixel chrome shared by the landing scenes: a workspace card that echoes
// the product's PageLevelHeader vocabulary (uppercase eyebrow, display title),
// the POS sync status chip, and the Athena-automation attribution line.

export function WorkspaceFrame({
  eyebrow,
  title,
  meta,
  children,
  ariaLabel,
}: {
  ariaLabel: string;
  children: ReactNode;
  eyebrow: string;
  meta?: ReactNode;
  title: string;
}) {
  return (
    <figure
      aria-label={ariaLabel}
      className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-background text-left text-foreground shadow-overlay"
    >
      <div className="flex items-center justify-between gap-layout-sm border-b border-border bg-surface px-layout-md py-layout-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {eyebrow}
          </p>
          <p className="mt-1 font-display text-lg leading-tight">{title}</p>
        </div>
        {meta}
      </div>
      <div className="p-layout-md sm:p-layout-lg">{children}</div>
    </figure>
  );
}

export type SyncChipStatus = "synced" | "syncing" | "pending_sync" | "offline";

const SYNC_CHIP_PRESENTATION: Record<
  SyncChipStatus,
  { className: string; label: string }
> = {
  offline: {
    className: "bg-warning/10 text-warning-foreground",
    label: "Offline — sales continue",
  },
  pending_sync: {
    className: "bg-muted text-muted-foreground",
    label: "Pending sync",
  },
  synced: { className: "bg-success/10 text-success", label: "Synced" },
  syncing: { className: "bg-signal/10 text-signal", label: "Syncing" },
};

export function SyncChip({
  status,
  chipRole,
}: {
  chipRole?: string;
  status: SyncChipStatus;
}) {
  const presentation = SYNC_CHIP_PRESENTATION[status];
  return (
    <span
      data-sync-chip={chipRole}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-layout-sm py-layout-xs text-xs font-medium ${presentation.className}`}
    >
      {presentation.label}
    </span>
  );
}

export function AutomationBeat({ children }: { children: ReactNode }) {
  return (
    <p className="mt-layout-md flex items-start gap-layout-sm text-sm leading-6 text-muted-foreground">
      <Sparkles className="mt-1 h-4 w-4 shrink-0 text-signal" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
