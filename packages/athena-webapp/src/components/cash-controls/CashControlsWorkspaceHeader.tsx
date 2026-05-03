import { NavigateBackButton } from "../common/PageHeader";

export function CashControlsWorkspaceHeader({
  activeView,
  description,
  orgUrlSlug,
  showBackButton,
  storeUrlSlug,
  title,
}: {
  activeView: "cash-controls" | "closeouts";
  showBackButton?: boolean;
  description?: string;
  orgUrlSlug: string;
  storeUrlSlug: string;
  title: string;
}) {
  return (
    <div className="container mx-auto py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {showBackButton ? <NavigateBackButton /> : null}
          <div className="max-w-2xl space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Cash Ops
            </p>
            <div className="space-y-1">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                {title}
              </h1>
              {description ? (
                <p className="text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
