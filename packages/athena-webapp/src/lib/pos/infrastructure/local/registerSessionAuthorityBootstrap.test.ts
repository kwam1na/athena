import { describe, expect, it } from "vitest";

import {
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
} from "./posLocalStore";
import { seedRegisterSessionAuthorityBootstrap } from "./registerSessionAuthorityBootstrap";

describe("register session authority bootstrap", () => {
  it("seeds one synced local register event and mapping through the command gateway", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const input = {
      bootstrap: {
        cloudRegisterSessionId: "cloud-register-1",
        expectedCash: 350,
        localRegisterSessionId: "cloud-register-1",
        openedAt: 1,
        openingFloat: 300,
        registerNumber: "1",
        staffProfileId: "staff-manager",
        status: "active" as const,
      },
      store,
      storeId: "store-1",
      terminalId: "local-terminal-1",
    };

    await expect(
      seedRegisterSessionAuthorityBootstrap(input),
    ).resolves.toMatchObject({ seeded: true, seedResult: "seeded" });
    await expect(
      seedRegisterSessionAuthorityBootstrap(input),
    ).resolves.toMatchObject({
      seeded: false,
      seedResult: "already_seeded",
    });

    const events = await store.listEvents();
    expect(events).toMatchObject({ ok: true });
    if (!events.ok) throw new Error(events.error.message);
    expect(events.value).toHaveLength(1);
    expect(events.value[0]).toMatchObject({
      localRegisterSessionId: "cloud-register-1",
      sync: { status: "synced" },
      terminalId: "local-terminal-1",
      type: "register.opened",
    });
    await expect(
      store.readLocalCloudMapping({
        entity: "registerSession",
        localId: "cloud-register-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        cloudId: "cloud-register-1",
        localId: "cloud-register-1",
      },
    });
  });
});
