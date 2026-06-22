import {
  buildContextEventEnvelope,
  defineSurfaceContext,
  type ContextEventInput,
} from "../../shared/intelligence";

export const athenaWebappContextSurface = defineSurfaceContext({
  surface: "athena_webapp",
  schemaVersion: 1,
  events: [
    {
      eventId: "athena_webapp.workspace_viewed",
      schemaVersion: 1,
      visibilityMode: "store_admin",
      retentionClass: "standard",
      requiredPayloadKeys: ["route"],
    },
    {
      eventId: "athena_webapp.intelligence_surface_viewed",
      schemaVersion: 1,
      visibilityMode: "store_admin",
      retentionClass: "standard",
      requiredPayloadKeys: ["capability"],
    },
  ],
});

export function buildAthenaWebappContextEvent(input: ContextEventInput) {
  return buildContextEventEnvelope(athenaWebappContextSurface, input);
}
