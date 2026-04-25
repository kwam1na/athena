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
          <p className="text-xs uppercase tracking-[0.24em] text-amber-700/80">
            Cashroom Ops
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="flex flex-wrap gap-2 rounded-xl border border-stone-200 bg-white/80 p-1.5">
          <Button
            asChild
            className={
              activeView === "cash-controls"
                ? "rounded-lg bg-stone-950 text-stone-50 hover:bg-stone-900 hover:text-stone-50"
                : "rounded-lg border-stone-200 bg-white/80 text-stone-700 hover:bg-white"
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
                ? "rounded-lg bg-stone-950 text-stone-50 hover:bg-stone-900 hover:text-stone-50"
                : "rounded-lg border-stone-200 bg-white/80 text-stone-700 hover:bg-white"
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
