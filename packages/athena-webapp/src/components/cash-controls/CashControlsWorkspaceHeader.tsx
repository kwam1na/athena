import { Link } from "@tanstack/react-router";

import { Button } from "../ui/button";

export function CashControlsWorkspaceHeader({
  activeView,
  description,
  orgUrlSlug,
  storeUrlSlug,
  title,
}: {
  activeView: "cash-controls" | "closeouts";
  description: string;
  orgUrlSlug: string;
  storeUrlSlug: string;
  title: string;
}) {
  return (
    <div className="container mx-auto py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-1">
          <p className="text-xs uppercase tracking-[0.24em] text-signal">
            Cashroom Ops
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-surface-raised p-1.5 shadow-surface">
          <Button
            asChild
            className={
              activeView === "cash-controls"
                ? "rounded-md border-transparent bg-shell text-shell-foreground hover:bg-shell/90 hover:text-shell-foreground"
                : "rounded-md border-border bg-background text-muted-foreground hover:bg-surface hover:text-foreground"
            }
            size="sm"
            variant="outline"
          >
            <Link
              params={{ orgUrlSlug, storeUrlSlug }}
              to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls"
            >
              Cash Controls
            </Link>
          </Button>
          <Button
            asChild
            className={
              activeView === "closeouts"
                ? "rounded-md border-transparent bg-shell text-shell-foreground hover:bg-shell/90 hover:text-shell-foreground"
                : "rounded-md border-border bg-background text-muted-foreground hover:bg-surface hover:text-foreground"
            }
            size="sm"
            variant="outline"
          >
            <Link
              params={{ orgUrlSlug, storeUrlSlug }}
              to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/closeouts"
            >
              Closeouts
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
