import { describe, expect, it } from "vitest";

import { clearSettledRecoverableDrawerAuthorityBlock } from "./drawerAuthorityReconciliation";
import {
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
} from "./posLocalStore";

describe("drawerAuthorityReconciliation", () => {
  it("does not clear versioned authority_unknown after local lifecycle settles", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 1_000,
    });
    await store.appendEvent({
      initialSyncStatus: "synced",
      localRegisterSessionId: "local-register-1",
      payload: { countedCash: 0 },
      storeId: "store-1",
      terminalId: "local-terminal-1",
      type: "register.closeout_started",
    });
    await store.applyRegisterLifecycleAuthority({
      expectedMapping: {
        cloudRegisterSessionId: "cloud-register-1",
        mappedAt: 1_000,
      },
      observation: {
        classification: "repair_required",
        cloudRegisterSessionId: "cloud-register-1",
        cursor: {
          lifecycleRevision: 1,
          mappingAuthorityRevision: 4,
        },
        localRegisterSessionId: "local-register-1",
        observedAt: 2_000,
        reason: "authority_unknown",
        source: "dedicated_snapshot",
        status: "blocked",
      },
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
    const authority = await store.readDrawerAuthorityState({
      localRegisterSessionId: "local-register-1",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
    const events = await store.listEvents();
    if (!authority.ok || !authority.value || !events.ok) {
      throw new Error("Expected local authority fixtures to persist.");
    }

    await expect(
      clearSettledRecoverableDrawerAuthorityBlock({
        drawerAuthority: authority.value,
        events: events.value,
        store,
      }),
    ).resolves.toEqual({ ok: true, value: false });
    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        reason: "authority_unknown",
        serverAuthority: { source: "dedicated_snapshot" },
      },
    });
  });
});
