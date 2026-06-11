import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../../_generated/dataModel";
import { buildPosRemoteAssistClientPresence } from "./posRuntimeAdapter";

describe("pos remote assist runtime adapter", () => {
  it("builds a safe generic Remote Assist client presence payload", () => {
    const payload = buildPosRemoteAssistClientPresence({
      receivedAt: 2_000_000,
      runtimeStatus: {
        browserInfo: {
          online: true,
          platform: "MacIntel",
        },
      },
      store: {
        _creationTime: 1,
        _id: "store-1" as Id<"store">,
        name: "Osu",
        organizationId: "org-1" as Id<"organization">,
        slug: "osu",
      } as Doc<"store">,
      terminal: {
        _creationTime: 1,
        _id: "terminal-1" as Id<"posTerminal">,
        browserInfo: {
          userAgent: "test",
        },
        displayName: "Front counter",
        fingerprintHash: "hash",
        registeredAt: 1,
        registeredByUserId: "user-1" as Id<"athenaUser">,
        status: "active",
        storeId: "store-1" as Id<"store">,
      } as Doc<"posTerminal">,
    });

    expect(payload).toMatchObject({
      accessPolicy: "unattended_allowed",
      adapterRef: {
        id: "terminal-1",
        kind: "pos_terminal",
      },
      browserSummary: {
        online: "true",
        platform: "MacIntel",
      },
      capabilities: {
        boundedControl: true,
        sensitiveMasking: true,
        unattendedCoBrowsing: true,
      },
      enrollmentStatus: "active",
      organizationId: "org-1",
      runtimeIdentity: "terminal-1",
      runtimeType: "pos_terminal",
      storeId: "store-1",
    });
    expect(JSON.stringify(payload)).not.toMatch(/secret|token|proof|payment|customer/i);
  });
});
