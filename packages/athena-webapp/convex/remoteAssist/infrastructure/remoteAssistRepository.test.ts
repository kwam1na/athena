import { describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../../_generated/dataModel";
import { createRemoteAssistRepository } from "./remoteAssistRepository";

const now = 2_000_000;

describe("remote assist repository", () => {
  it("preserves enrollment and access policy when runtime presence refreshes an existing client", async () => {
    const existing = buildClient({
      accessPolicy: "disabled",
      enrollmentStatus: "revoked",
    });
    const ctx = buildCtx(existing);
    const repository = createRemoteAssistRepository(ctx as never);

    await repository.upsertClient({
      ...existing,
      accessPolicy: "unattended_allowed",
      displayName: "Updated terminal",
      enrollmentStatus: "active",
      lastPresenceAt: now + 100,
      presenceStatus: "online",
      updatedAt: now + 100,
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "remoteAssistClient",
      existing._id,
      expect.not.objectContaining({
        accessPolicy: "unattended_allowed",
        enrollmentStatus: "active",
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "remoteAssistClient",
      existing._id,
      expect.objectContaining({
        displayName: "Updated terminal",
        lastPresenceAt: now + 100,
        presenceStatus: "online",
      }),
    );
  });

  it("refuses ambiguous duplicate runtime-client rows", async () => {
    const existing = buildClient();
    const ctx = buildCtx(existing, [existing, buildClient({ _id: "remote-client-2" as Id<"remoteAssistClient"> })]);
    const repository = createRemoteAssistRepository(ctx as never);

    await expect(
      repository.getClientByRuntime({
        organizationId: "org-1" as Id<"organization">,
        runtimeIdentity: "terminal-1",
        runtimeType: "pos_terminal",
      }),
    ).rejects.toThrow("Duplicate Remote Assist clients");
  });

  it("patches only the requested session fields without clearing required ids", async () => {
    const existing = buildClient();
    const ctx = buildCtx(existing);
    const repository = createRemoteAssistRepository(ctx as never);

    await repository.patchSession("session-1", {
      transportRoomId: "athena-remote-assist-session-1",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "remoteAssistSession",
      "session-1",
      {
        transportRoomId: "athena-remote-assist-session-1",
      },
    );
  });
});

function buildCtx(
  existing: Doc<"remoteAssistClient">,
  runtimeMatches: Doc<"remoteAssistClient">[] = [existing],
) {
  return {
    db: {
      get: vi.fn(async () => existing),
      insert: vi.fn(),
      patch: vi.fn(),
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({
          first: vi.fn(async () => existing),
          take: vi.fn(async () => runtimeMatches),
        })),
      })),
    },
  };
}

function buildClient(
  overrides: Partial<Doc<"remoteAssistClient">> = {},
): Doc<"remoteAssistClient"> {
  return {
    _creationTime: now,
    _id: "remote-client-1" as Id<"remoteAssistClient">,
    accessPolicy: "attended_required",
    capabilities: {
      attendedScreenShare: true,
      boundedControl: true,
      sensitiveMasking: true,
      unattendedCoBrowsing: true,
    },
    createdAt: now,
    displayName: "Front counter",
    enrollmentStatus: "active",
    lastPresenceAt: now,
    organizationId: "org-1" as Id<"organization">,
    presenceStatus: "online",
    runtimeIdentity: "terminal-1",
    runtimeType: "pos_terminal",
    storeId: "store-1" as Id<"store">,
    updatedAt: now,
    ...overrides,
  };
}
