import { Button } from "@/components/ui/button";

export type CustomRangeState = "pending" | "running" | "completed" | "failed";

const COPY: Record<CustomRangeState, { description: string; title: string }> = {
  pending: {
    title: "Range queued",
    description: "Athena will start building this report shortly.",
  },
  running: {
    title: "Building custom report",
    description:
      "Last verified content stays available while this range is prepared.",
  },
  completed: {
    title: "Custom report ready",
    description: "Verified results are available for the selected range.",
  },
  failed: {
    title: "Custom report could not be built",
    description: "The previous verified report is still available.",
  },
};

export function CustomRangeStatus({
  onRetry,
  progress,
  state,
}: {
  onRetry?: () => void;
  progress?: number;
  state: CustomRangeState;
}) {
  const copy = COPY[state];
  return (
    <section
      aria-live="polite"
      className="rounded-lg border border-border bg-surface-raised p-layout-md"
      role="status"
    >
      <p className="font-medium text-foreground">{copy.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
      {state === "running" && progress !== undefined ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {Math.max(0, Math.min(100, Math.round(progress)))}% complete
        </p>
      ) : null}
      {state === "failed" && onRetry ? (
        <Button className="mt-3" onClick={onRetry} variant="outline">
          Retry
        </Button>
      ) : null}
    </section>
  );
}
