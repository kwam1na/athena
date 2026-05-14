import { describe, expect, it } from "vitest";

import { posTerminalSchema } from "./posTerminal";

describe("posTerminalSchema", () => {
  it("keeps syncSecretHash optional during rollout for existing terminals", () => {
    expect((posTerminalSchema as any).json.value.syncSecretHash).toEqual(
      expect.objectContaining({
        fieldType: { type: "string" },
        optional: true,
      }),
    );
  });
});
