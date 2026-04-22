import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";

import { buildRegisterSessionTraceSeed } from "./registerSession";

describe("buildRegisterSessionTraceSeed", () => {
  it("creates a stable register-session workflow trace seed from the session id", () => {
    const seed = buildRegisterSessionTraceSeed({
      storeId: "store_1" as Id<"store">,
      organizationId: "org_1" as Id<"organization">,
      registerSessionId: "session_1" as Id<"registerSession">,
      registerNumber: " A1 ",
      terminalId: "terminal_1" as Id<"posTerminal">,
      openedAt: 123,
      openedByStaffProfileId: "staff_1" as Id<"staffProfile">,
      openedByUserId: "user_1" as Id<"athenaUser">,
    });

    expect(seed.trace.traceId).toBe("register_session:session_1");
    expect(seed.trace.workflowType).toBe("register_session");
    expect(seed.trace.primaryLookupType).toBe("register_session_id");
    expect(seed.lookup.lookupType).toBe("register_session_id");
    expect(seed.lookup.lookupValue).toBe("session_1");
    expect(seed.trace.startedAt).toBe(123);
    expect(seed.trace.title).toBe("Register session A1");
    expect(seed.subjectRefs).toEqual({
      registerSessionId: "session_1",
      registerNumber: "A1",
      terminalId: "terminal_1",
      openedByStaffProfileId: "staff_1",
      openedByUserId: "user_1",
    });
    expect(seed.eventSource).toBe("workflow.registerSession");
  });
});
