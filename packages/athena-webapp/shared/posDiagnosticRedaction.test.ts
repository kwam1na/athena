import { describe, expect, it } from "vitest";

import {
  POS_CLIENT_EVENT_FLOWS as SCHEMA_FLOWS,
  POS_CLIENT_EVENT_LEVELS as SCHEMA_LEVELS,
  POS_DIAGNOSTIC_CLASSIFICATIONS as SCHEMA_CLASSIFICATIONS,
  POS_DIAGNOSTIC_ROUTE_IDS as SCHEMA_ROUTE_IDS,
} from "../convex/schemas/pos/posClientEvent";
import {
  isPosClientEventFlow,
  isPosClientEventLevel,
  POS_CLIENT_EVENT_FLOWS,
  POS_CLIENT_EVENT_LEVELS,
  POS_DIAGNOSTIC_CLASSIFICATIONS,
  POS_DIAGNOSTIC_ROUTE_IDS,
} from "./posDiagnosticRedaction";

describe("POS client diagnostic vocabulary", () => {
  it("keeps browser guards and Convex validators indexed from one contract", () => {
    expect(SCHEMA_LEVELS).toBe(POS_CLIENT_EVENT_LEVELS);
    expect(SCHEMA_FLOWS).toBe(POS_CLIENT_EVENT_FLOWS);
    expect(SCHEMA_CLASSIFICATIONS).toBe(POS_DIAGNOSTIC_CLASSIFICATIONS);
    expect(SCHEMA_ROUTE_IDS).toBe(POS_DIAGNOSTIC_ROUTE_IDS);
    expect(POS_CLIENT_EVENT_LEVELS.every(isPosClientEventLevel)).toBe(true);
    expect(POS_CLIENT_EVENT_FLOWS.every(isPosClientEventFlow)).toBe(true);
    expect(isPosClientEventLevel("fatal")).toBe(false);
    expect(isPosClientEventFlow("customer-email")).toBe(false);
  });
});
