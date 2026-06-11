import { describe, expect, it } from "vitest";

import { evaluateRemoteAssistPolicy, type RemoteAssistActor } from "./policy";
import type { RemoteAssistClient } from "./types";

const now = 2_000_000;

describe("remote assist policy", () => {
  it("allows unattended support for a fresh enrolled client under unattended policy", () => {
    const decision = evaluateRemoteAssistPolicy({
      actor: buildActor(),
      client: buildClient(),
      now,
      requestedMode: "unattended",
    });

    expect(decision).toEqual({
      effectiveMode: "unattended",
      kind: "allowed",
      requiresLocalApproval: false,
    });
  });

  it("downgrades unattended requests to attended when local approval is required", () => {
    const decision = evaluateRemoteAssistPolicy({
      actor: buildActor(),
      client: buildClient({
        accessPolicy: "attended_required",
      }),
      now,
      requestedMode: "unattended",
    });

    expect(decision).toEqual({
      effectiveMode: "attended",
      kind: "allowed",
      requiresLocalApproval: true,
    });
  });

  it("denies actors outside the organization or store scope", () => {
    expect(
      evaluateRemoteAssistPolicy({
        actor: buildActor({ organizationId: "other-org" }),
        client: buildClient(),
        now,
        requestedMode: "unattended",
      }),
    ).toMatchObject({
      code: "authorization_failed",
      kind: "denied",
    });

    expect(
      evaluateRemoteAssistPolicy({
        actor: buildActor({ storeIds: ["store-2"] }),
        client: buildClient(),
        now,
        requestedMode: "unattended",
      }),
    ).toMatchObject({
      code: "authorization_failed",
      kind: "denied",
    });
  });

  it("denies disabled, stale, or incapable clients", () => {
    for (const client of [
      buildClient({ enrollmentStatus: "disabled" }),
      buildClient({ accessPolicy: "disabled" }),
      buildClient({ lastPresenceAt: now - 121_000 }),
      buildClient({
        capabilities: {
          ...buildClient().capabilities,
          unattendedCoBrowsing: false,
        },
      }),
    ]) {
      expect(
        evaluateRemoteAssistPolicy({
          actor: buildActor(),
          client,
          now,
          requestedMode: "unattended",
        }),
      ).toMatchObject({
        kind: "denied",
      });
    }
  });
});

function buildActor(overrides: Partial<RemoteAssistActor> = {}): RemoteAssistActor {
  return {
    organizationId: "org-1",
    remoteAssistAllowed: true,
    role: "support",
    storeIds: ["store-1"],
    userId: "user-1",
    ...overrides,
  };
}

function buildClient(overrides: Partial<RemoteAssistClient> = {}): RemoteAssistClient {
  return {
    _id: "client-1",
    accessPolicy: "unattended_allowed",
    capabilities: {
      attendedScreenShare: true,
      boundedControl: true,
      sensitiveMasking: true,
      unattendedCoBrowsing: true,
    },
    createdAt: now - 1_000,
    displayName: "M Supplies Register",
    enrollmentStatus: "active",
    lastPresenceAt: now - 1_000,
    organizationId: "org-1",
    presenceStatus: "online",
    runtimeIdentity: "terminal-1",
    runtimeType: "pos_terminal",
    storeId: "store-1",
    updatedAt: now - 1_000,
    ...overrides,
  };
}
