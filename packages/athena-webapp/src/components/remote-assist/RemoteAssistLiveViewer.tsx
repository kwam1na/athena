import {
  CheckCircle2,
  Loader2,
  MousePointerClick,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  RemoteAssistCoBrowseFrame,
  RemoteAssistControlIntent,
  RemoteAssistControlResult,
  RemoteAssistSanitizedSurfaceControl,
} from "@/lib/remote-assist";
import { cn } from "@/lib/utils";

const CONTROL_RESPONSE_TIMEOUT_MS = 8_000;
const APP_NAVIGATION_CONTROL_LABELS = new Set([
  "Active Cases",
  "Analytics",
  "Appointments",
  "Bulk Operations",
  "Cash Controls",
  "Catalog Management",
  "Homepage",
  "Members",
  "Operations",
  "Orders",
  "Point of Sale",
  "Procurement",
  "Products",
  "Promo codes",
  "Reviews",
  "Service Intake",
  "Storefront",
]);
const POS_SURFACE_LABELS: Record<string, string> = {
  "active-sessions": "Active Sessions",
  "expense-products": "Expense Products",
  "expense-reports": "Expense Reports",
  "product-lookup": "Product Lookup",
  sessions: "Active Sessions",
  "terminal-health": "Terminal Health",
  transactions: "Transactions",
};
const STORE_WORKSPACE_LABELS: Record<string, string> = {
  analytics: "Analytics",
  "bulk-operations": "Bulk Operations",
  "cash-controls": "Cash Controls",
  homepage: "Homepage",
  operations: "Operations",
  orders: "Orders",
  pos: "Point of Sale",
  procurement: "Procurement",
  products: "Products",
  "promo-codes": "Promo codes",
  reviews: "Reviews",
  storefront: "Storefront",
};

export function RemoteAssistLiveViewer({
  canControl,
  frame,
  latestControlResult,
  onControl,
}: {
  canControl: boolean;
  frame: RemoteAssistCoBrowseFrame | null;
  latestControlResult?: RemoteAssistControlResult | null;
  onControl: (intent: RemoteAssistControlIntent) => Promise<void> | void;
}) {
  const [lastAction, setLastAction] = useState<RemoteAssistActionFeedback | null>(
    null,
  );
  const returnedToSurfaceActionKeyRef = useRef<string | null>(null);
  const controlGroups = buildControlGroups(frame?.surface?.controls ?? []);
  const visibleControlGroups = controlGroups.filter(
    (group) => group.id === "current" || group.controls.length > 0,
  );
  const [activeSurfaceId, setActiveSurfaceId] = useState<
    RemoteAssistControlGroup["id"]
  >("current");
  const activeControlGroup =
    controlGroups.find((group) => group.id === activeSurfaceId) ??
    controlGroups[0];

  useEffect(() => {
    if (!latestControlResult) {
      return;
    }
    setLastAction((current) => {
      if (current?.idempotencyKey !== latestControlResult.idempotencyKey) {
        return current;
      }
      return {
        ...current,
        result: latestControlResult,
        status: latestControlResult.accepted ? "accepted" : "blocked",
      };
    });
  }, [latestControlResult]);

  useEffect(() => {
    if (lastAction?.status !== "pending") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLastAction((current) =>
        current?.idempotencyKey === lastAction.idempotencyKey &&
        current.status === "pending"
          ? { ...current, status: "no_response" }
          : current,
      );
    }, CONTROL_RESPONSE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [lastAction?.idempotencyKey, lastAction?.status]);

  useEffect(() => {
    if (
      visibleControlGroups.length > 0 &&
      !visibleControlGroups.some((group) => group.id === activeSurfaceId)
    ) {
      setActiveSurfaceId("current");
    }
  }, [activeSurfaceId, visibleControlGroups]);

  useEffect(() => {
    if (
      lastAction?.status === "accepted" &&
      returnedToSurfaceActionKeyRef.current !== lastAction.idempotencyKey &&
      lastAction.surfaceId !== "current"
    ) {
      returnedToSurfaceActionKeyRef.current = lastAction.idempotencyKey;
      setActiveSurfaceId("current");
    }
  }, [
    lastAction?.idempotencyKey,
    lastAction?.status,
    lastAction?.surfaceId,
  ]);

  if (!frame) {
    return (
      <div className="rounded-md border border-dashed border-border bg-background px-layout-md py-layout-lg text-sm text-muted-foreground">
        Waiting for the POS runtime to publish a live Remote Assist frame.
      </div>
    );
  }

  const surfaceLabel = getSurfaceLabel(frame);

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="flex flex-col gap-layout-sm border-b border-border px-layout-md py-layout-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Current surface
          </p>
          <p className="truncate text-base font-semibold text-foreground">
            {surfaceLabel}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {frame.route}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-layout-xs">
          <Badge variant="outline" className="rounded-md">
            Frame {new Date(frame.capturedAt).toLocaleTimeString()}
          </Badge>
          <Badge variant="outline" className="rounded-md">
            {frame.viewport.width} x {frame.viewport.height}
          </Badge>
          <Badge variant="outline" className="rounded-md">
            {frame.redaction.sensitiveRegionCount} masked
          </Badge>
        </div>
      </div>

      <div className="space-y-layout-md px-layout-md py-layout-md">
        <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Controls
            </p>
            <p className="text-sm text-foreground">
              {activeControlGroup.label}
              <span className="ml-2 text-xs text-muted-foreground">
                {activeControlGroup.description}
              </span>
            </p>
          </div>

          <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-center">
            <Badge variant="outline" className="w-fit rounded-md">
              {activeControlGroup.controls.length} target
              {activeControlGroup.controls.length === 1 ? "" : "s"}
            </Badge>
            {visibleControlGroups.length > 1 ? (
              <Tabs
                value={activeControlGroup.id}
                onValueChange={(value) => {
                  if (isControlGroupId(value)) {
                    setActiveSurfaceId(value);
                  }
                }}
              >
                <TabsList className="h-auto w-fit">
                  {visibleControlGroups.map((group) => (
                    <TabsTrigger
                      className="h-7 gap-1.5 px-2.5 text-xs"
                      key={group.id}
                      value={group.id}
                    >
                      <span>{group.label}</span>
                      <span className="rounded-sm bg-muted px-1 text-[10px] font-normal text-muted-foreground">
                        {group.controls.length}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
          </div>
        </div>

        {activeControlGroup.controls.length > 0 ? (
          <div className="grid max-h-96 gap-2 overflow-auto pr-1 md:grid-cols-2">
            {activeControlGroup.controls.map((control) => (
              <ControlTargetButton
                canControl={canControl}
                control={control}
                frame={frame}
                lastAction={lastAction}
                key={control.controlId}
                onControl={async (intent) => {
                  setLastAction({
                    controlId: control.controlId,
                    idempotencyKey: intent.idempotencyKey,
                    issuedAt: intent.issuedAt,
                    label: control.label,
                    role: control.role,
                    status: "pending",
                    surfaceId: getControlSurfaceId(control),
                  });
                  try {
                    await onControl(intent);
                  } catch {
                    setLastAction((current) =>
                      current?.idempotencyKey === intent.idempotencyKey
                        ? { ...current, status: "send_failed" }
                        : current,
                    );
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-border bg-surface px-layout-sm py-layout-sm text-sm text-muted-foreground">
            No safe control targets are visible for this surface.
          </p>
        )}
      </div>

      <ActionFeedbackSummary action={lastAction} />
    </div>
  );
}

type RemoteAssistActionFeedback = {
  controlId: string;
  idempotencyKey: string;
  issuedAt: number;
  label: string;
  result?: RemoteAssistControlResult;
  role: RemoteAssistSanitizedSurfaceControl["role"];
  status: "accepted" | "blocked" | "no_response" | "pending" | "send_failed";
  surfaceId: RemoteAssistControlGroup["id"];
};

type RemoteAssistControlGroup = {
  controls: RemoteAssistSanitizedSurfaceControl[];
  description: string;
  id: "current" | "header" | "navigation";
  label: string;
};

function buildControlGroups(
  controls: RemoteAssistSanitizedSurfaceControl[],
): RemoteAssistControlGroup[] {
  const groups: Record<RemoteAssistControlGroup["id"], RemoteAssistControlGroup> = {
    current: {
      controls: [],
      description: "Controls exposed by the selected workspace surface.",
      id: "current",
      label: "Surface",
    },
    header: {
      controls: [],
      description: "Page header controls such as back navigation.",
      id: "header",
      label: "Header",
    },
    navigation: {
      controls: [],
      description: "App navigation controls available from the runtime shell.",
      id: "navigation",
      label: "Navigation",
    },
  };

  for (const control of controls) {
    groups[getControlSurfaceId(control)].controls.push(control);
  }

  return [groups.current, groups.header, groups.navigation];
}

function getControlSurfaceId(
  control: RemoteAssistSanitizedSurfaceControl,
): RemoteAssistControlGroup["id"] {
  if (control.controlId === "page-header-back") {
    return "header";
  }
  if (
    control.controlId.startsWith("remote-assist-") ||
    APP_NAVIGATION_CONTROL_LABELS.has(control.label)
  ) {
    return "navigation";
  }
  return "current";
}

function isControlGroupId(value: string): value is RemoteAssistControlGroup["id"] {
  return value === "current" || value === "header" || value === "navigation";
}

function getSurfaceLabel(frame: RemoteAssistCoBrowseFrame) {
  const routeLabel = getSurfaceLabelFromRoute(frame.route);
  if (routeLabel) {
    return routeLabel;
  }

  const runtimeTitle = frame.surface?.title?.trim();
  if (runtimeTitle && runtimeTitle !== "Athena") {
    return runtimeTitle;
  }

  return "Athena";
}

function getSurfaceLabelFromRoute(route: string) {
  const pathname = route.split("?")[0] ?? route;
  const segments = pathname.split("/").filter(Boolean);
  const posIndex = segments.indexOf("pos");
  if (posIndex >= 0) {
    const posSurfaceSegment = segments[posIndex + 1] ?? "pos";

    if (posSurfaceSegment === "pos") {
      return "Point of Sale";
    }
    if (POS_SURFACE_LABELS[posSurfaceSegment]) {
      return POS_SURFACE_LABELS[posSurfaceSegment];
    }

    return titleizeRouteSegment(posSurfaceSegment);
  }

  const storeIndex = segments.indexOf("store");
  const workspaceSegment =
    storeIndex >= 0 && segments[storeIndex + 2]
      ? segments[storeIndex + 2]
      : undefined;

  if (!workspaceSegment) {
    return null;
  }

  return STORE_WORKSPACE_LABELS[workspaceSegment] ?? titleizeRouteSegment(workspaceSegment);
}

function titleizeRouteSegment(segment: string) {
  return segment
    .split("-")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function ControlTargetButton({
  canControl,
  control,
  frame,
  lastAction,
  onControl,
}: {
  canControl: boolean;
  control: RemoteAssistSanitizedSurfaceControl;
  frame: RemoteAssistCoBrowseFrame;
  lastAction: RemoteAssistActionFeedback | null;
  onControl: (intent: RemoteAssistControlIntent) => Promise<void> | void;
}) {
  const actionState =
    lastAction?.controlId === control.controlId ? lastAction.status : null;
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
      className={cn(
        "h-auto w-full justify-start gap-2 px-2 py-2 text-left transition-colors",
        actionState === "accepted" &&
          "border-success/25 bg-surface-raised text-foreground",
        (actionState === "blocked" ||
          actionState === "no_response" ||
          actionState === "send_failed") &&
          "border-destructive/40 bg-destructive/5",
        actionState === "pending" && "border-primary/40 bg-primary/5",
      )}
      disabled={!canControl}
      onClick={sendClick}
      type="button"
      variant="outline"
    >
      <ControlTargetIcon canControl={canControl} state={actionState} />
      <span className="min-w-0">
        <span className="block truncate text-sm">{control.label}</span>
        <span className="block text-xs text-muted-foreground">
          {getControlTargetMeta(control.role, actionState)}
        </span>
      </span>
    </Button>
  );
}

function ControlTargetIcon({
  canControl,
  state,
}: {
  canControl: boolean;
  state: RemoteAssistActionFeedback["status"] | null;
}) {
  if (state === "pending") {
    return (
      <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />
    );
  }
  if (state === "accepted") {
    return (
      <CheckCircle2
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-success"
      />
    );
  }
  if (state === "blocked" || state === "no_response" || state === "send_failed") {
    return (
      <XCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" />
    );
  }
  return canControl ? (
    <MousePointerClick aria-hidden="true" className="h-4 w-4 shrink-0" />
  ) : (
    <RefreshCw aria-hidden="true" className="h-4 w-4 shrink-0" />
  );
}

function ActionFeedbackSummary({
  action,
}: {
  action: RemoteAssistActionFeedback | null;
}) {
  if (!action) {
    return (
      <p className="border-t border-border px-layout-md py-layout-sm text-xs text-muted-foreground">
        Select a control to send an action to the runtime.
      </p>
    );
  }

  const copy = getActionFeedbackCopy(action);
  return (
    <div className="flex flex-col gap-1 border-t border-border px-layout-md py-layout-sm text-xs sm:flex-row sm:items-center sm:justify-between">
      <p className={cn("font-medium", copy.className)}>{copy.label}</p>
      <p className="text-muted-foreground">
        {action.label} · {new Date(action.issuedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

function getActionFeedbackCopy(action: RemoteAssistActionFeedback) {
  if (action.status === "pending") {
    return {
      className: "text-primary",
      label: "Sending action to runtime...",
    };
  }
  if (action.status === "accepted") {
    return {
      className: "text-success",
      label: "Action accepted by runtime.",
    };
  }
  if (action.status === "send_failed") {
    return {
      className: "text-destructive",
      label: "Action could not be sent.",
    };
  }
  if (action.status === "no_response") {
    return {
      className: "text-destructive",
      label: "No runtime response after 8 seconds. Reconnect or try again.",
    };
  }
  return {
    className: "text-destructive",
    label: `Action blocked: ${formatControlRejectionReason(action.result)}`,
  };
}

function getControlTargetMeta(
  role: RemoteAssistSanitizedSurfaceControl["role"],
  state: RemoteAssistActionFeedback["status"] | null,
) {
  if (state === "pending") {
    return "sending";
  }
  if (state === "accepted") {
    return "accepted";
  }
  if (state === "blocked") {
    return "blocked";
  }
  if (state === "send_failed") {
    return "send failed";
  }
  if (state === "no_response") {
    return "no response";
  }
  return role;
}

function formatControlRejectionReason(result?: RemoteAssistControlResult) {
  if (!result || result.accepted) {
    return "runtime rejected the action";
  }
  return result.reason.replace(/_/g, " ");
}
