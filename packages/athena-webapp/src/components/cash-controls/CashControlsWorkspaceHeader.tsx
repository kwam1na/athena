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
        <div className="flex min-w-0 items-center gap-3">
          {showBackButton ? <NavigateBackButton /> : null}
          <div className="max-w-3xl space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
