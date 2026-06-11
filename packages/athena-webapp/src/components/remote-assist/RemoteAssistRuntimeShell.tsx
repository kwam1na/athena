import { MonitorUp, ShieldCheck, ShieldX, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getRemoteAssistConnectedState,
  type RemoteAssistDisconnectCallback,
  type RemoteAssistDisconnectReason,
  type RemoteAssistRuntimeState,
} from "@/lib/remote-assist";

export type RemoteAssistRuntimeShellProps = {
  state: RemoteAssistRuntimeState;
  onDisconnect?: RemoteAssistDisconnectCallback;
  className?: string;
};

const statusToneClassName = {
  connected: "border-emerald-200 bg-emerald-50 text-emerald-800",
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
  neutral: "border-border bg-surface text-muted-foreground",
  progress: "border-blue-200 bg-blue-50 text-blue-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
} as const;

export function RemoteAssistRuntimeShell({
  state,
  onDisconnect,
  className,
}: RemoteAssistRuntimeShellProps) {
  const connectedState = getRemoteAssistConnectedState(state);
  const canDisconnect =
    state.status === "connected" ||
    state.status === "connecting" ||
    state.status === "reconnecting";

  const handleDisconnect = () => {
    onDisconnect?.({
      sessionId: state.sessionId,
      reason: getDisconnectReason(state.status),
      at: new Date(),
    });
  };

  return (
    <section
      aria-label="Remote assist runtime"
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-3",
        className,
      )}
      data-remote-assist-session-id={state.sessionId}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface">
          <MonitorUp aria-hidden="true" className="size-4 text-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">
              Remote Assist
            </p>
            <Badge
              className={cn(
                "rounded-md border",
                statusToneClassName[connectedState.tone],
              )}
              variant="outline"
            >
              {connectedState.label}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {state.supportAgentName
              ? `${state.supportAgentName} assisting`
              : "Waiting for support connection"}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div
          className={cn(
            "hidden items-center gap-1 rounded-md border px-2 py-1 text-xs sm:flex",
            connectedState.allowsControl
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-border bg-surface text-muted-foreground",
          )}
        >
          {connectedState.allowsControl ? (
            <ShieldCheck aria-hidden="true" className="size-3.5" />
          ) : (
            <ShieldX aria-hidden="true" className="size-3.5" />
          )}
          <span>{connectedState.allowsControl ? "Control on" : "Control off"}</span>
        </div>
        <Badge variant="outline" className="rounded-md">
          {state.viewerCount} viewer{state.viewerCount === 1 ? "" : "s"}
        </Badge>
        <Button
          aria-label="Disconnect remote assist"
          disabled={!canDisconnect}
          onClick={handleDisconnect}
          size="icon"
          type="button"
          variant="utility"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}

function getDisconnectReason(
  status: RemoteAssistRuntimeState["status"],
): RemoteAssistDisconnectReason {
  if (status === "reconnecting") {
    return "connection_lost";
  }

  return "operator_requested";
}
