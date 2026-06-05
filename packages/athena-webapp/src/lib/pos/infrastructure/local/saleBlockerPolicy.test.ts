import { describe, expect, it } from "vitest";

import { deriveLocalSaleBlocker } from "./saleBlockerPolicy";

describe("deriveLocalSaleBlocker", () => {
  it("does not hard-block local sales for cloud-validation uncertainty", () => {
    expect(
      deriveLocalSaleBlocker({
        activeRegisterSession: {
          status: "active",
          localRegisterSessionId: "drawer-1",
          canReopen: false,
        },
        hasLocalEventDestination: true,
        hasRequiredIdentities: true,
      }),
    ).toBeNull();
  });

  it("hard-blocks terminal integrity, missing destination, missing identities, and non-reopenable closed drawers", () => {
    expect(
      deriveLocalSaleBlocker({
        activeRegisterSession: {
          status: "active",
          localRegisterSessionId: "drawer-1",
          canReopen: false,
        },
        hasLocalEventDestination: true,
        hasRequiredIdentities: true,
        terminalIntegrity: {
          status: "requires_reprovision",
        },
      })?.reason,
    ).toBe("terminal_integrity");

    expect(
      deriveLocalSaleBlocker({
        activeRegisterSession: {
          status: "active",
          localRegisterSessionId: "drawer-1",
          canReopen: false,
        },
        hasLocalEventDestination: false,
        hasRequiredIdentities: true,
      })?.reason,
    ).toBe("missing_event_destination");

    expect(
      deriveLocalSaleBlocker({
        activeRegisterSession: {
          status: "active",
          localRegisterSessionId: "drawer-1",
          canReopen: false,
        },
        hasLocalEventDestination: true,
        hasRequiredIdentities: false,
      })?.reason,
    ).toBe("missing_identity");

    expect(
      deriveLocalSaleBlocker({
        activeRegisterSession: {
          status: "closing",
          localRegisterSessionId: "drawer-1",
          canReopen: false,
        },
        hasLocalEventDestination: true,
        hasRequiredIdentities: true,
      })?.reason,
    ).toBe("drawer_closed");
  });
});
