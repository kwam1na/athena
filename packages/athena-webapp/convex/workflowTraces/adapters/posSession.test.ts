import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";

import { buildPosSessionTraceSeed } from "./posSession";

describe("buildPosSessionTraceSeed", () => {
  it("creates a stable POS session workflow trace seed from the session document identity", () => {
    const seed = buildPosSessionTraceSeed({
      storeId: "store_1" as Id<"store">,
      startedAt: 123,
      sessionNumber: " SES-001 ",
      posSessionId: "session_1" as Id<"posSession">,
      staffProfileId: "staff_1" as Id<"staffProfile">,
      terminalId: "terminal_1" as Id<"posTerminal">,
      posTransactionId: "txn_1" as Id<"posTransaction">,
    });

    expect(seed.trace.traceId).toBe("pos_session:session_1");
    expect(seed.trace.workflowType).toBe("pos_session");
    expect(seed.trace.primaryLookupType).toBe("session_number");
    expect(seed.lookup.lookupType).toBe("session_number");
    expect(seed.lookup.lookupValue).toBe("ses-001");
    expect(seed.trace.startedAt).toBe(123);
    expect(seed.subjectRefs).toEqual({
      posSessionId: "session_1",
      staffProfileId: "staff_1",
      terminalId: "terminal_1",
      posTransactionId: "txn_1",
    });
    expect(seed.eventSource).toBe("workflow.posSession");
  });

  it("uses the POS session document id to avoid merging repeated session numbers", () => {
    const firstSeed = buildPosSessionTraceSeed({
      storeId: "store_1" as Id<"store">,
      sessionNumber: "SES-009",
      posSessionId: "session_1" as Id<"posSession">,
    });
    const secondSeed = buildPosSessionTraceSeed({
      storeId: "store_1" as Id<"store">,
      sessionNumber: "SES-009",
      posSessionId: "session_2" as Id<"posSession">,
    });

    expect(firstSeed.trace.traceId).toBe("pos_session:session_1");
    expect(secondSeed.trace.traceId).toBe("pos_session:session_2");
    expect(firstSeed.lookup.lookupValue).toBe("ses-009");
    expect(secondSeed.lookup.lookupValue).toBe("ses-009");
  });
});
