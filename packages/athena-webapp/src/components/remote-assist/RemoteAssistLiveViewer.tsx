import { MousePointerClick, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  RemoteAssistCoBrowseFrame,
  RemoteAssistControlIntent,
  RemoteAssistSanitizedSurfaceControl,
} from "@/lib/remote-assist";
import { cn } from "@/lib/utils";

export function RemoteAssistLiveViewer({
  canControl,
  frame,
  onControl,
}: {
  canControl: boolean;
  frame: RemoteAssistCoBrowseFrame | null;
  onControl: (intent: RemoteAssistControlIntent) => void;
}) {
  if (!frame) {
    return (
      <div className="rounded-md border border-dashed border-border bg-background px-layout-md py-layout-lg text-sm text-muted-foreground">
        Waiting for the POS runtime to publish a live Remote Assist frame.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="flex flex-col gap-layout-sm border-b border-border px-layout-md py-layout-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">
            {frame.surface?.title ?? "Athena POS"}
          </p>
          <p className="text-xs text-muted-foreground">{frame.route}</p>
        </div>
        <div className="flex flex-wrap items-center gap-layout-xs">
          <Badge variant="outline" className="rounded-md">
            {frame.viewport.width} x {frame.viewport.height}
          </Badge>
          <Badge variant="outline" className="rounded-md">
            {frame.redaction.sensitiveRegionCount} masked
          </Badge>
        </div>
      </div>

      <div className="grid gap-layout-md px-layout-md py-layout-md lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-h-64 rounded-md border border-border bg-surface px-layout-md py-layout-md">
          <div className="mb-layout-sm flex items-center justify-between">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Runtime screen
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(frame.capturedAt).toLocaleTimeString()}
            </p>
          </div>
          <div className="space-y-2">
            {(frame.surface?.visibleText ?? []).slice(0, 16).map((item, index) => (
              <div
                className="rounded-sm border border-border/70 bg-background px-2 py-1 text-sm text-foreground"
                key={`${item}-${index}`}
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-layout-sm">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Controls
          </p>
          {(frame.surface?.controls ?? []).length > 0 ? (
            <div className="max-h-72 space-y-2 overflow-auto pr-1">
              {frame.surface?.controls.map((control) => (
                <ControlTargetButton
                  canControl={canControl}
                  control={control}
                  frame={frame}
                  key={control.controlId}
                  onControl={onControl}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-border bg-surface px-layout-sm py-layout-sm text-sm text-muted-foreground">
              No safe control targets are visible in the latest frame.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlTargetButton({
  canControl,
  control,
  frame,
  onControl,
}: {
  canControl: boolean;
  control: RemoteAssistSanitizedSurfaceControl;
  frame: RemoteAssistCoBrowseFrame;
  onControl: (intent: RemoteAssistControlIntent) => void;
}) {
  const sendClick = () => {
    onControl({
      event: {
        action: "up",
        pointerId: "support-pointer-1",
        type: "pointer",
        x: control.rect.x + control.rect.width / 2,
        y: control.rect.y + control.rect.height / 2,
      },
      idempotencyKey: `${frame.sessionId}-${control.controlId}-${Date.now()}`,
      issuedAt: Date.now(),
      reason: `Support selected ${control.label}`,
      sessionId: frame.sessionId,
      target: "athena_surface",
    });
  };

  return (
    <Button
      className={cn("h-auto w-full justify-start gap-2 px-2 py-2 text-left")}
      disabled={!canControl}
      onClick={sendClick}
      type="button"
      variant="outline"
    >
      {canControl ? (
        <MousePointerClick aria-hidden="true" className="h-4 w-4 shrink-0" />
      ) : (
        <RefreshCw aria-hidden="true" className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm">{control.label}</span>
        <span className="block text-xs text-muted-foreground">{control.role}</span>
      </span>
    </Button>
  );
}
