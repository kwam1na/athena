import type { ContextTrackingEnvelope } from "./contextTypes";
import type { ContextEventInput } from "./contextEventTypes";
import { buildContextEventEnvelope, hashStableValue } from "./eventBuilder";
import type { SurfaceContextDefinition } from "./surfaceDefinition";

export type TrackContextEventResult =
  | { kind: "recorded"; contextEventId?: string; status?: "recorded" }
  | {
      kind: "duplicate";
      contextEventId?: string;
      status?: "recorded" | "rejected";
    };

export type ContextTrackingTransport = (
  envelope: ContextTrackingEnvelope,
) => Promise<TrackContextEventResult>;

export function createContextTracker(
  surface: SurfaceContextDefinition,
  options: {
    transport: ContextTrackingTransport;
    now?: () => number;
  },
) {
  return {
    build(input: ContextEventInput) {
      return buildContextEventEnvelope(surface, input, { now: options.now });
    },
    async track(input: ContextEventInput) {
      return options.transport(this.build(input));
    },
  };
}

export { hashStableValue };
