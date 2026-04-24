import { describe, expect, it, vi } from "vitest";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

import { getActiveRegisterSessionForRegisterState } from "./registerSessionRepository";

describe("getActiveRegisterSessionForRegisterState", () => {
  it("uses the register-state lookup so closing sessions can drive the POS closeout gate", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        _id: "drawer-1" as Id<"registerSession">,
        expectedCash: 5_000,
        openingFloat: 5_000,
        openedAt: 1710000000000,
        registerNumber: "1",
        status: "closing",
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    };

    const session = await getActiveRegisterSessionForRegisterState(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      registerNumber: "1",
    });

    expect(ctx.runQuery).toHaveBeenCalledWith(
      internal.operations.registerSessions.getRegisterSessionForRegisterState,
      {
        storeId: "store-1",
        terminalId: "terminal-1",
        registerNumber: "1",
      },
    );
    expect(session).toEqual(
      expect.objectContaining({
        _id: "drawer-1",
        status: "closing",
        registerNumber: "1",
      }),
    );
  });
});
