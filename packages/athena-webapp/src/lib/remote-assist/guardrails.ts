export type RemoteAssistViewport = {
  width: number;
  height: number;
};

export type RemoteAssistRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RemoteAssistSensitiveRegion = {
  id: string;
  label: string;
  rect: RemoteAssistRect;
};

export type RemoteAssistPointerControlEvent = {
  type: "pointer";
  action: "move" | "down" | "up" | "cancel";
  pointerId: string;
  x: number;
  y: number;
};

export type RemoteAssistKeyControlEvent = {
  type: "key";
  action: "down" | "up";
  code: RemoteAssistAllowedKeyCode;
};

export type RemoteAssistControlEvent =
  | RemoteAssistPointerControlEvent
  | RemoteAssistKeyControlEvent;

export type RemoteAssistControlRejectionReason =
  | "invalid_event"
  | "invalid_viewport"
  | "pointer_out_of_bounds"
  | "sensitive_region"
  | "key_not_allowed";

export type RemoteAssistControlValidation =
  | {
      ok: true;
      event: RemoteAssistControlEvent;
    }
  | {
      ok: false;
      reason: Exclude<RemoteAssistControlRejectionReason, "sensitive_region">;
    }
  | {
      ok: false;
      reason: "sensitive_region";
      regionId: string;
    };

export type RemoteAssistSensitiveRegionSet = {
  all: () => RemoteAssistSensitiveRegion[];
  findBlockedRegion: (point: { x: number; y: number }) =>
    | RemoteAssistSensitiveRegion
    | null;
  isPointBlocked: (point: { x: number; y: number }) => boolean;
};

const ALLOWED_KEY_CODES = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Enter",
  "Escape",
  "Tab",
] as const);

type RemoteAssistAllowedKeyCode =
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "Backspace"
  | "Enter"
  | "Escape"
  | "Tab";

const POINTER_ACTIONS = new Set(["move", "down", "up", "cancel"]);
const KEY_ACTIONS = new Set(["down", "up"]);

export function createSensitiveRegionSet(
  regions: RemoteAssistSensitiveRegion[],
): RemoteAssistSensitiveRegionSet {
  const normalizedRegions = regions
    .filter((region) => region.id.trim().length > 0)
    .filter(
      (region) =>
        isFiniteNumber(region.rect.x) &&
        isFiniteNumber(region.rect.y) &&
        isPositiveFiniteNumber(region.rect.width) &&
        isPositiveFiniteNumber(region.rect.height),
    )
    .map((region) => ({
      ...region,
      id: region.id.trim(),
      label: region.label.trim(),
      rect: { ...region.rect },
    }));

  return {
    all: () =>
      normalizedRegions.map((region) => ({
        ...region,
        rect: { ...region.rect },
      })),
    findBlockedRegion: (point) =>
      normalizedRegions.find((region) => isPointInsideRect(point, region.rect)) ??
      null,
    isPointBlocked: (point) =>
      normalizedRegions.some((region) => isPointInsideRect(point, region.rect)),
  };
}

export function validateRemoteAssistControlEvent(
  event: unknown,
  viewport: RemoteAssistViewport,
  sensitiveRegions?: RemoteAssistSensitiveRegionSet,
): RemoteAssistControlValidation {
  if (!isValidViewport(viewport)) {
    return { ok: false, reason: "invalid_viewport" };
  }

  if (!isRecord(event) || typeof event.type !== "string") {
    return { ok: false, reason: "invalid_event" };
  }

  if (event.type === "pointer") {
    return validatePointerEvent(event, viewport, sensitiveRegions);
  }

  if (event.type === "key") {
    return validateKeyEvent(event);
  }

  return { ok: false, reason: "invalid_event" };
}

export function maskTextForRemoteAssist(value: string): string {
  return value
    .replace(
      /\b(pin|passcode|password|otp|code)(\s*[:#-]?\s*)([A-Za-z0-9-]{4,})\b/gi,
      (_match, label: string, separator: string) =>
        `${label}${separator}[masked]`,
    )
    .replace(/\b\d{12,19}\b/g, "[masked]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[masked]");
}

function validatePointerEvent(
  event: Record<string, unknown>,
  viewport: RemoteAssistViewport,
  sensitiveRegions?: RemoteAssistSensitiveRegionSet,
): RemoteAssistControlValidation {
  if (
    !POINTER_ACTIONS.has(String(event.action)) ||
    typeof event.pointerId !== "string" ||
    event.pointerId.trim().length === 0 ||
    !isFiniteNumber(event.x) ||
    !isFiniteNumber(event.y)
  ) {
    return { ok: false, reason: "invalid_event" };
  }

  const pointerEvent: RemoteAssistPointerControlEvent = {
    type: "pointer",
    action: event.action as RemoteAssistPointerControlEvent["action"],
    pointerId: event.pointerId.trim(),
    x: event.x,
    y: event.y,
  };

  if (!isPointInsideViewport(pointerEvent, viewport)) {
    return { ok: false, reason: "pointer_out_of_bounds" };
  }

  const blockedRegion = sensitiveRegions?.findBlockedRegion(pointerEvent);
  if (blockedRegion) {
    return {
      ok: false,
      reason: "sensitive_region",
      regionId: blockedRegion.id,
    };
  }

  return { ok: true, event: pointerEvent };
}

function validateKeyEvent(
  event: Record<string, unknown>,
): RemoteAssistControlValidation {
  if (
    !KEY_ACTIONS.has(String(event.action)) ||
    typeof event.code !== "string"
  ) {
    return { ok: false, reason: "invalid_event" };
  }

  if (!ALLOWED_KEY_CODES.has(event.code as RemoteAssistAllowedKeyCode)) {
    return { ok: false, reason: "key_not_allowed" };
  }

  return {
    ok: true,
    event: {
      type: "key",
      action: event.action as RemoteAssistKeyControlEvent["action"],
      code: event.code as RemoteAssistAllowedKeyCode,
    },
  };
}

function isPointInsideViewport(
  point: { x: number; y: number },
  viewport: RemoteAssistViewport,
) {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= viewport.width &&
    point.y <= viewport.height
  );
}

function isPointInsideRect(point: { x: number; y: number }, rect: RemoteAssistRect) {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.width &&
    point.y <= rect.y + rect.height
  );
}

function isValidViewport(viewport: RemoteAssistViewport) {
  return (
    isPositiveFiniteNumber(viewport.width) &&
    isPositiveFiniteNumber(viewport.height)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}
