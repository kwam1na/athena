import type { CSSProperties, ReactNode } from "react";
import {
  BadgePercent,
  Banknote,
  Building,
  CalendarDays,
  ChevronsUpDown,
  CogIcon,
  Gift,
  Layers,
  MessageCircleMore,
  PackageCheckIcon,
  PackageOpenIcon,
  PanelLeftClose,
  PanelTop,
  ScanBarcode,
  ShoppingBag,
  Store,
  Sun,
  Tag,
  Truck,
  UserCircle,
  Users,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

// The app's real navigation, in the sidebar's top-level order. Group breaks
// mirror the Store / Services / Organization / App sidebar groups.
const SHELL_RAIL_GROUPS = [
  [
    { icon: ScanBarcode, key: "pos" },
    { icon: Banknote, key: "cash" },
    { icon: Workflow, key: "operations" },
    { icon: Truck, key: "procurement" },
    { icon: Store, key: "homepage" },
    { icon: ShoppingBag, key: "orders" },
    { icon: Gift, key: "complimentary" },
    { icon: Layers, key: "bulk" },
    { icon: BadgePercent, key: "promo" },
    { icon: MessageCircleMore, key: "reviews" },
    { icon: Tag, key: "products" },
    { icon: PanelTop, key: "storefront" },
  ],
  [
    { icon: PackageOpenIcon, key: "service-intake" },
    { icon: CalendarDays, key: "appointments" },
    { icon: PackageCheckIcon, key: "service-cases" },
  ],
  [{ icon: Users, key: "members" }],
  [{ icon: CogIcon, key: "settings" }],
] as const;

export type ShellRailIconKey =
  (typeof SHELL_RAIL_GROUPS)[number][number]["key"];

// A workspace exhibit wearing the app's actual chrome — the contained shell's
// top bar (brand, environment pill, organization switcher, account chip,
// theme toggle) and the collapsed sidebar icon rail — replicated from
// -authed-layout.tsx / Navbar.tsx / app-sidebar.tsx markup, rendered
// statically for the landing page.
export function AppShellExhibit({
  activeRailIcon,
  ariaLabel,
  children,
  contentScale,
  zoom,
}: {
  activeRailIcon: ShellRailIconKey;
  ariaLabel: string;
  children: ReactNode;
  /** Scales the workspace row (sidebar + content) down within the fixed frame. */
  contentScale?: number;
  zoom?: number;
}) {
  const containedControlSurface =
    "border border-border/70 bg-background/90 shadow-surface backdrop-blur supports-[backdrop-filter]:bg-background/75";

  return (
    <figure
      aria-label={ariaLabel}
      className="mx-auto w-full overflow-hidden rounded-xl border border-border bg-app-canvas text-left text-foreground shadow-surface"
      style={zoom ? ({ zoom } as CSSProperties) : undefined}
    >
      <header className="relative z-20 box-border flex h-16 shrink-0 bg-transparent px-layout-xs pt-layout-xs sm:px-layout-sm sm:pt-layout-sm">
        <div className="flex h-full min-w-0 flex-1 items-center justify-start gap-layout-xs overflow-hidden px-0 sm:px-layout-sm">
          <div className="min-w-0 overflow-hidden rounded-lg px-layout-xs py-layout-2xs">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <p className="font-medium">athena</p>
              <span className="hidden shrink-0 rounded-full border border-primary-border bg-primary-soft px-1.5 py-px text-[10px] font-medium uppercase leading-none text-primary min-[430px]:inline-flex">
                demo
              </span>
              <p className="hidden text-muted-foreground sm:block">/</p>
              <Button
                variant="outline"
                size="sm"
                className="pointer-events-none w-fit min-w-0 max-w-[14rem] justify-start"
                tabIndex={-1}
              >
                <Building className="mr-2 h-4 w-4" />
                <span className="min-w-0 truncate">Osu Studio</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end px-0 sm:px-layout-sm">
          <div className="flex shrink-0 items-center gap-1 sm:gap-layout-xs">
            <span
              className={`pointer-events-none flex h-10 w-10 shrink-0 items-center justify-center gap-layout-xs rounded-lg px-0 text-sm text-foreground sm:h-9 sm:w-auto sm:min-w-0 sm:px-layout-xs ${containedControlSurface}`}
            >
              <UserCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="hidden max-w-[18rem] truncate font-medium sm:block">
                owner@osustudio.com
              </span>
            </span>
            <span
              className={`pointer-events-none flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground sm:h-9 sm:w-9 ${containedControlSurface}`}
            >
              <Sun aria-hidden="true" className="h-4 w-4" />
            </span>
          </div>
        </div>
      </header>

      <div
        className="flex min-h-0 px-layout-xs pb-layout-sm sm:px-layout-sm"
        style={
          contentScale
            ? { transform: `scale(${contentScale})`, transformOrigin: "top left" }
            : undefined
        }
      >
        <div className="hidden shrink-0 flex-col md:flex" aria-hidden="true">
          <aside className="flex w-[3rem] flex-none flex-col items-center gap-layout-xs rounded-lg border border-sidebar-border/60 bg-sidebar py-layout-xs text-sidebar-foreground shadow-surface">
            {SHELL_RAIL_GROUPS.map((group, groupIndex) => (
              <span
                key={groupIndex}
                className={`flex flex-col items-center gap-1 ${
                  groupIndex > 0 ? "mt-1 border-t border-sidebar-border/60 pt-2" : ""
                }`}
              >
                {group.map(({ icon: Icon, key }) => (
                  <span
                    key={key}
                    className={`flex size-8 items-center justify-center rounded-md p-2 ${
                      key === activeRailIcon
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" />
                  </span>
                ))}
              </span>
            ))}
          </aside>
          <span className="mt-layout-xs flex h-9 w-[3rem] shrink-0 items-center justify-center self-start rounded-lg border border-sidebar-border/70 bg-sidebar text-sidebar-foreground shadow-surface">
            <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
          </span>
        </div>
        <main className="box-border min-w-0 flex-1 p-layout-md md:p-8 md:pt-layout-md">
          {children}
        </main>
      </div>
    </figure>
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

// The "Athena acted on its own" beat under each act's copy. The primary dot
// is the same motif the closing AutomationRevealScene uses for its timeline,
// so the payoff reads as a reprise of these moments.
export function AutomationBeat({ children }: { children: ReactNode }) {
  return (
    <p className="mt-layout-md flex items-start gap-layout-sm text-sm leading-6 text-muted-foreground">
      <span
        aria-hidden="true"
        className="mt-[8px] h-2 w-2 shrink-0 rounded-full bg-primary"
      />
      {children}
    </p>
  );
}
