import { describe, expect, it } from "vitest";

import {
  buildContextEventEnvelope,
  defineSurfaceContext,
  hashStableValue,
} from "./index";

const surface = defineSurfaceContext({
  surface: "test_surface",
  schemaVersion: 1,
  events: [
    {
      eventId: "test.event",
      schemaVersion: 1,
      visibilityMode: "store_admin",
      retentionClass: "standard",
      requiredPayloadKeys: ["route"],
    },
  ],
});

describe("context tracking primitives", () => {
  it("builds envelopes from surface event definitions", () => {
    expect(
      buildContextEventEnvelope(
        surface,
        {
          eventId: "test.event",
          payload: {
            route: "/workspace",
            empty: undefined as never,
          },
          occurredAt: 1_700_000_000_000,
        },
        { now: () => 1_700_000_000_000 },
      ),
    ).toMatchObject({
      surface: "test_surface",
      eventId: "test.event",
      schemaVersion: 1,
      occurredAt: 1_700_000_000_000,
      payload: {
        route: "/workspace",
      },
      visibilityMode: "store_admin",
      retentionClass: "standard",
    });
  });

  it("rejects payloads missing event-required keys", () => {
    expect(() =>
      buildContextEventEnvelope(surface, {
        eventId: "test.event",
        payload: {},
      }),
    ).toThrow("Missing payload key: route");
  });

  it("hashes payloads independently of object key order", () => {
    expect(hashStableValue({ b: 2, a: 1 })).toBe(
      hashStableValue({ a: 1, b: 2 }),
    );
  });

  it("carries source refs through shared event envelopes", () => {
    const envelope = buildContextEventEnvelope(surface, {
      eventId: "test.event",
      payload: { route: "/workspace" },
      sourceRefs: [
        {
          table: "contextEvent",
          id: "event_123",
          redaction: "none",
        },
      ],
    });

    expect(envelope.sourceRefs).toEqual([
      {
        table: "contextEvent",
        id: "event_123",
        redaction: "none",
      },
    ]);
  });
});
