import { RefreshCw, RadioTower, ShieldCheck, ShieldX } from "lucide-react";

import { RemoteAssistLiveViewer } from "./RemoteAssistLiveViewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Id } from "~/convex/_generated/dataModel";
import {
  useRemoteAssistSupportTransport,
} from "@/lib/remote-assist/support/useRemoteAssistSupportTransport";
import type { RemoteAssistControlResult } from "@/lib/remote-assist";

export function RemoteAssistSupportConsole({
  controlEnabled,
  enabled,
  onEndSession,
  sessionId,
}: {
  controlEnabled: boolean;
  enabled: boolean;
  onEndSession: () => void;
  sessionId: Id<"remoteAssistSession"> | string;
}) {
  const transport = useRemoteAssistSupportTransport({
    enabled,
    sessionId,
  });
  const canControl =
    enabled &&
    controlEnabled &&
    transport.connectionState === "connected" &&
    Boolean(transport.latestFrame);

  return (
    <div className="mt-layout-md space-y-layout-md rounded-md border border-border/80 bg-surface px-layout-md py-layout-md">
      <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">
            Live support console
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Viewing the POS runtime through the Remote Assist transport.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-layout-xs">
          <Badge variant="outline" className="rounded-md">
            <RadioTower aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
            {transport.connectionState}
          </Badge>
          <Badge variant="outline" className="rounded-md">
            {canControl ? (
              <ShieldCheck aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
            ) : (
              <ShieldX aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
            )}
            {canControl ? "Control enabled" : "View only"}
          </Badge>
          <Button
            onClick={transport.reconnect}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
            Reconnect
          </Button>
          <Button onClick={onEndSession} size="sm" type="button" variant="outline">
            End live session
          </Button>
        </div>
      </div>

      <RemoteAssistLiveViewer
        canControl={canControl}
        frame={transport.latestFrame}
        onControl={(intent) => {
          void transport.sendControlIntent(intent);
        }}
      />

      {transport.latestControlResult ? (
        <ControlResultSummary result={transport.latestControlResult} />
      ) : null}
    </div>
  );
}

function ControlResultSummary({
  result,
}: {
  result: RemoteAssistControlResult;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      Last control {result.accepted ? "accepted" : `blocked: ${result.reason}`}.
    </p>
  );
}
