export type RemoteAssistConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "disconnected"
  | "blocked"
  | "error";

export type RemoteAssistDisconnectReason =
  | "operator_requested"
  | "support_requested"
  | "connection_lost"
  | "policy_blocked"
  | "session_replaced";

export type RemoteAssistDisconnectEvent = {
  sessionId: string;
  reason: RemoteAssistDisconnectReason;
  at: Date;
};

export type RemoteAssistDisconnectCallback = (
  event: RemoteAssistDisconnectEvent,
) => void;

export type RemoteAssistRuntimeState = {
  sessionId: string;
  status: RemoteAssistConnectionStatus;
  supportAgentName?: string | null;
  controlEnabled: boolean;
  viewerCount: number;
  blockedReason?: string | null;
};

export type RemoteAssistConnectedStatePrimitive = {
  label: string;
  tone: "neutral" | "progress" | "connected" | "warning" | "danger";
  isConnected: boolean;
  allowsControl: boolean;
};

export function getRemoteAssistConnectedState(
  state: Pick<
    RemoteAssistRuntimeState,
    "status" | "controlEnabled" | "blockedReason"
  >,
): RemoteAssistConnectedStatePrimitive {
  switch (state.status) {
    case "connected":
      return {
        label: state.controlEnabled ? "Connected" : "View only",
        tone: "connected",
        isConnected: true,
        allowsControl: state.controlEnabled,
      };
    case "connecting":
      return {
        label: "Connecting",
        tone: "progress",
        isConnected: false,
        allowsControl: false,
      };
    case "reconnecting":
      return {
        label: "Reconnecting",
        tone: "warning",
        isConnected: true,
        allowsControl: false,
      };
    case "disconnecting":
      return {
        label: "Disconnecting",
        tone: "progress",
        isConnected: true,
        allowsControl: false,
      };
    case "blocked":
      return {
        label: state.blockedReason ?? "Blocked",
        tone: "danger",
        isConnected: false,
        allowsControl: false,
      };
    case "error":
      return {
        label: "Connection error",
        tone: "danger",
        isConnected: false,
        allowsControl: false,
      };
    case "disconnected":
      return {
        label: "Disconnected",
        tone: "neutral",
        isConnected: false,
        allowsControl: false,
      };
    case "idle":
    default:
      return {
        label: "Ready",
        tone: "neutral",
        isConnected: false,
        allowsControl: false,
      };
  }
}
