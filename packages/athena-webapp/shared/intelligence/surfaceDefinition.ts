import type { ContextPayload } from "./contextTypes";
import type {
  ContextEventDefinition,
  ContextEventValidationResult,
} from "./contextEventTypes";

export type SurfaceContextDefinition<
  Surface extends string = string,
  Definition extends ContextEventDefinition = ContextEventDefinition,
> = {
  surface: Surface;
  schemaVersion: number;
  events: readonly Definition[];
};

export function defineSurfaceContext<
  const Surface extends string,
  const Definition extends ContextEventDefinition,
>(definition: SurfaceContextDefinition<Surface, Definition>) {
  return definition;
}

export function findContextEventDefinition(
  surface: SurfaceContextDefinition,
  eventId: string,
) {
  return surface.events.find((event) => event.eventId === eventId);
}

export function validateContextEventPayload(
  definition: ContextEventDefinition,
  payload: ContextPayload,
): ContextEventValidationResult {
  for (const key of definition.requiredPayloadKeys ?? []) {
    if (!(key in payload)) {
      return { ok: false, reason: `Missing payload key: ${key}` };
    }
  }

  return { ok: true };
}
