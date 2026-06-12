import {
  createSensitiveRegionSet,
  validateRemoteAssistControlEvent,
  type RemoteAssistControlEvent,
  type RemoteAssistControlRejectionReason,
  type RemoteAssistSensitiveRegion,
  type RemoteAssistViewport,
} from "./guardrails";

export type RemoteAssistParticipantRole = "runtime" | "support";

export type RemoteAssistRuntimeLiveState = {
  connectedSupportCount: number;
  localDisconnectAvailable: boolean;
  route: string;
  sensitiveModeActive: boolean;
  sessionId: string;
  status: "active" | "connecting" | "ended" | "waiting_approval";
  viewport: RemoteAssistViewport;
};

export type RemoteAssistCoBrowseFrame = {
  capturedAt: number;
  frameId: string;
  redaction: {
    inputValuesMasked: true;
    sensitiveRegionCount: number;
  };
  route: string;
  sessionId: string;
  sensitiveRegions: Array<Pick<RemoteAssistSensitiveRegion, "id" | "label">>;
  viewport: RemoteAssistViewport;
};

export type RemoteAssistControlIntent = {
  event: RemoteAssistControlEvent;
  idempotencyKey: string;
  issuedAt: number;
  reason: string;
  sessionId: string;
  target: "athena_surface";
};

export type RemoteAssistControlResult =
  | {
      accepted: true;
      event: RemoteAssistControlEvent;
      idempotencyKey: string;
      sessionId: string;
    }
  | {
      accepted: false;
      idempotencyKey: string;
      reason: RemoteAssistControlRejectionReason;
      regionId?: string;
      sessionId: string;
    };

export function buildRemoteAssistCoBrowseFrame(args: {
  capturedAt: number;
  frameId: string;
  route: string;
  sensitiveRegions?: RemoteAssistSensitiveRegion[];
  sessionId: string;
  viewport: RemoteAssistViewport;
}): RemoteAssistCoBrowseFrame {
  const sensitiveRegions = createSensitiveRegionSet(
    args.sensitiveRegions ?? [],
  ).all();
  return {
    capturedAt: args.capturedAt,
    frameId: args.frameId.trim(),
    redaction: {
      inputValuesMasked: true,
      sensitiveRegionCount: sensitiveRegions.length,
    },
    route: args.route,
    sessionId: args.sessionId,
    sensitiveRegions: sensitiveRegions.map((region) => ({
      id: region.id,
      label: region.label,
    })),
    viewport: { ...args.viewport },
  };
}

export function validateRemoteAssistControlIntent(args: {
  intent: RemoteAssistControlIntent;
  sensitiveRegions?: RemoteAssistSensitiveRegion[];
  viewport: RemoteAssistViewport;
}): RemoteAssistControlResult {
  if (
    args.intent.target !== "athena_surface" ||
    args.intent.idempotencyKey.trim().length === 0 ||
    args.intent.reason.trim().length === 0
  ) {
    return {
      accepted: false,
      idempotencyKey: args.intent.idempotencyKey,
      reason: "invalid_event",
      sessionId: args.intent.sessionId,
    };
  }

  const sensitiveRegionSet = createSensitiveRegionSet(
    args.sensitiveRegions ?? [],
  );
  const validation = validateRemoteAssistControlEvent(
    args.intent.event,
    args.viewport,
    sensitiveRegionSet,
  );
  if (!validation.ok) {
    return {
      accepted: false,
      idempotencyKey: args.intent.idempotencyKey,
      reason: validation.reason,
      regionId:
        validation.reason === "sensitive_region"
          ? validation.regionId
          : undefined,
      sessionId: args.intent.sessionId,
    };
  }

  return {
    accepted: true,
    event: validation.event,
    idempotencyKey: args.intent.idempotencyKey,
    sessionId: args.intent.sessionId,
  };
}
