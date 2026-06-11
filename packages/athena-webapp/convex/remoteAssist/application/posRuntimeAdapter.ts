import type { Doc, Id } from "../../_generated/dataModel";

type PosRemoteAssistRuntimeStatus = {
  browserInfo?: {
    online?: boolean;
    platform?: string;
  };
};

export function buildPosRemoteAssistClientPresence(args: {
  receivedAt: number;
  runtimeStatus: PosRemoteAssistRuntimeStatus;
  store: Doc<"store">;
  terminal: Doc<"posTerminal">;
}) {
  return {
    organizationId: args.store.organizationId,
    storeId: args.terminal.storeId,
    runtimeType: "pos_terminal" as const,
    runtimeIdentity: args.terminal._id as Id<"posTerminal">,
    displayName: args.terminal.displayName,
    enrollmentStatus: "active" as const,
    accessPolicy: "unattended_allowed" as const,
    capabilities: {
      attendedScreenShare: true,
      boundedControl: true,
      sensitiveMasking: true,
      unattendedCoBrowsing: true,
    },
    adapterRef: {
      kind: "pos_terminal",
      id: args.terminal._id,
      label: args.terminal.displayName,
    },
    presenceStatus: "online" as const,
    lastPresenceAt: args.receivedAt,
    browserSummary: args.runtimeStatus.browserInfo
      ? {
          online:
            typeof args.runtimeStatus.browserInfo.online === "boolean"
              ? String(args.runtimeStatus.browserInfo.online)
              : "unknown",
          platform: args.runtimeStatus.browserInfo.platform ?? "unknown",
        }
      : undefined,
    createdAt: args.receivedAt,
    updatedAt: args.receivedAt,
  };
}
