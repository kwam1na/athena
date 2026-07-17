import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  PosSyncStatusPresentation,
  PosSyncStatusTone,
} from "@/lib/pos/presentation/syncStatusPresentation";
import { cn } from "@/lib/utils";

// Shared chrome for the landing scenes. The frame mirrors the product's
// workspace header vocabulary (uppercase eyebrow, display title); the scene
// bodies inside are the product's real presentational components.

export function WorkspaceFrame({
  eyebrow,
  title,
  meta,
  children,
  ariaLabel,
  className,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  eyebrow: string;
  meta?: ReactNode;
  title: string;
}) {
  return (
    <figure
      aria-label={ariaLabel}
      className={cn(
        "relative mx-auto w-full overflow-hidden rounded-xl border border-border bg-background text-left text-foreground shadow-overlay",
        className ?? "max-w-2xl",
      )}
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

// Display-only wrapper for real workspace components rendered as exhibits:
// `inert` removes them from focus order and the accessibility tree (the
// enclosing figure's aria-label describes the exhibit), and pointer events
// are disabled so embedded links/controls stay inactive on the marketing page.
export function WorkspaceExhibit({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      {...({ inert: "" } as Record<string, unknown>)}
      className={cn("pointer-events-none select-none", className)}
    >
      {children}
    </div>
  );
}

const SYNC_TONE_CLASSES: Record<PosSyncStatusTone, string> = {
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning-foreground",
};

// The product's sync-status language (via buildPosSyncStatusPresentation)
// rendered with the app's Badge primitive.
export function PosSyncBadge({
  presentation,
  chipRole,
}: {
  chipRole?: string;
  presentation: Pick<PosSyncStatusPresentation, "label" | "tone">;
}) {
  return (
    <Badge
      data-sync-chip={chipRole}
      variant="outline"
      className={cn(
        "whitespace-nowrap border-transparent font-medium",
        SYNC_TONE_CLASSES[presentation.tone],
      )}
    >
      {presentation.label}
    </Badge>
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
