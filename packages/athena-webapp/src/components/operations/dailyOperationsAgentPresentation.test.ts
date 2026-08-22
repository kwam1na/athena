import { describe, expect, it } from "vitest";

import type { AgentSourceRef } from "~/shared/agentHarness/results";
import {
  DAILY_OPERATIONS_MANIFESTS,
  DAILY_OPERATIONS_PRESENTATION,
} from "~/convex/agentHarness/profiles/dailyOperations";

import { DAILY_OPERATIONS_AGENT_PRESENTATION } from "./dailyOperationsAgentPresentation";

const context = {
  storeRef: "store-1",
  storeName: "Osu",
  operatingDate: "2026-08-21",
};

function sourceRef(kind: string) {
  return { ref: "source:1", kind, capturedAt: 0 } as unknown as AgentSourceRef;
}

/**
 * The browser cannot import the published profile (it reaches Convex server
 * modules), so the surface declares the same presentation adapter for the host.
 * This test is the drift guard between the two.
 */
describe("the Daily Operations presentation the host renders", () => {
  it("matches the published profile's identity, entry, mount, and context binding", () => {
    expect(DAILY_OPERATIONS_AGENT_PRESENTATION.profileId).toBe(
      DAILY_OPERATIONS_PRESENTATION.profileId,
    );
    expect(DAILY_OPERATIONS_AGENT_PRESENTATION.entry).toEqual(
      DAILY_OPERATIONS_PRESENTATION.entry,
    );
    expect(DAILY_OPERATIONS_AGENT_PRESENTATION.mountMode).toBe(
      DAILY_OPERATIONS_PRESENTATION.mountMode,
    );
    expect(DAILY_OPERATIONS_AGENT_PRESENTATION.contextBinding).toEqual(
      DAILY_OPERATIONS_PRESENTATION.contextBinding,
    );
  });

  it("labels the context and composes the thread key identically", () => {
    expect(DAILY_OPERATIONS_AGENT_PRESENTATION.contextLabel(context)).toBe(
      DAILY_OPERATIONS_PRESENTATION.contextLabel(context),
    );
    expect(
      DAILY_OPERATIONS_AGENT_PRESENTATION.threadKeyPolicy.compose(context),
    ).toBe(DAILY_OPERATIONS_PRESENTATION.threadKeyPolicy.compose(context));
    expect(DAILY_OPERATIONS_AGENT_PRESENTATION.threadKeyPolicy.parts).toEqual(
      DAILY_OPERATIONS_PRESENTATION.threadKeyPolicy.parts,
    );
    expect(
      DAILY_OPERATIONS_AGENT_PRESENTATION.threadKeyPolicy.onContextChange,
    ).toBe(DAILY_OPERATIONS_PRESENTATION.threadKeyPolicy.onContextChange);
    expect(
      DAILY_OPERATIONS_AGENT_PRESENTATION.threadKeyPolicy.activeTurnPolicy,
    ).toBe(DAILY_OPERATIONS_PRESENTATION.threadKeyPolicy.activeTurnPolicy);
  });

  it("offers the same evidence-backed starter intents", () => {
    expect(DAILY_OPERATIONS_AGENT_PRESENTATION.starterIntents).toEqual(
      DAILY_OPERATIONS_PRESENTATION.starterIntents,
    );
  });

  it("resolves every source kind the published resources can mint the same way", () => {
    const kinds = new Set(
      DAILY_OPERATIONS_MANIFESTS.flatMap(
        (manifest) => manifest.citation.sourceRefKinds,
      ),
    );

    expect(kinds.size).toBeGreaterThan(0);
    for (const kind of kinds) {
      const destination =
        DAILY_OPERATIONS_AGENT_PRESENTATION.resolveSourceDestination(
          sourceRef(kind),
        );
      expect(destination, kind).not.toBeNull();
      expect(destination, kind).toEqual(
        DAILY_OPERATIONS_PRESENTATION.resolveSourceDestination(sourceRef(kind)),
      );
    }

    expect(
      DAILY_OPERATIONS_AGENT_PRESENTATION.resolveSourceDestination(
        sourceRef("something_new"),
      ),
    ).toBeNull();
  });
});
