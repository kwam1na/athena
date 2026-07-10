import { describe, expect, it } from "vitest";

import {
  buildRegisterSessionAuthorityPatch,
  initialRegisterSessionAuthorityRevision,
  insertRegisterSessionWithAuthority,
  patchRegisterSessionWithAuthority,
} from "./registerSessionAuthorityRevision";

describe("register session lifecycle authority revision", () => {
  it("starts new register sessions at revision one", () => {
    expect(initialRegisterSessionAuthorityRevision()).toBe(1);
  });

  it("increments every real lifecycle transition, including non-monotonic status order", () => {
    const current = {
      status: "active" as const,
      lifecycleAuthorityRevision: 1,
    };

    const closing = buildRegisterSessionAuthorityPatch(current, {
      status: "closing",
    });
    expect(closing.lifecycleAuthorityRevision).toBe(2);

    const reopened = buildRegisterSessionAuthorityPatch(
      { status: "closing" as const, lifecycleAuthorityRevision: 2 },
      { status: "active" },
    );
    expect(reopened.lifecycleAuthorityRevision).toBe(3);

    const closed = buildRegisterSessionAuthorityPatch(
      { status: "active", lifecycleAuthorityRevision: 3 },
      { status: "closed" },
    );
    expect(closed.lifecycleAuthorityRevision).toBe(4);
  });

  it("uses revision zero as the deterministic legacy baseline", () => {
    expect(
      buildRegisterSessionAuthorityPatch(
        { status: "active", lifecycleAuthorityRevision: undefined },
        { status: "closing" },
      ).lifecycleAuthorityRevision,
    ).toBe(1);
  });

  it("does not increment for same-status or non-lifecycle patches", () => {
    expect(
      buildRegisterSessionAuthorityPatch(
        { status: "closing", lifecycleAuthorityRevision: 7 },
        { status: "closing", countedCash: 10 },
      ),
    ).toEqual({ status: "closing", countedCash: 10 });
    expect(
      buildRegisterSessionAuthorityPatch(
        { status: "active", lifecycleAuthorityRevision: 7 },
        { expectedCash: 25 },
      ),
    ).toEqual({ expectedCash: 25 });
  });

  it("never accepts a caller-supplied lifecycle revision", () => {
    expect(
      buildRegisterSessionAuthorityPatch(
        { status: "active", lifecycleAuthorityRevision: 7 },
        {
          expectedCash: 25,
          lifecycleAuthorityRevision: 999,
        } as never,
      ),
    ).toEqual({ expectedCash: 25 });
  });

  it("persists insert and transition revisions through the centralized writer", async () => {
    const writes: unknown[] = [];
    const ctx = {
      db: {
        async get() {
          return { status: "active", lifecycleAuthorityRevision: 4 };
        },
        async insert(_table: string, value: unknown) {
          writes.push(value);
          return "register-session-1";
        },
        async patch(_table: string, _id: string, value: unknown) {
          writes.push(value);
        },
      },
    };

    await insertRegisterSessionWithAuthority(ctx as never, {
      status: "open",
    } as never);
    await patchRegisterSessionWithAuthority(
      ctx as never,
      "register-session-1" as never,
      { status: "closing" },
    );

    expect(writes).toEqual([
      expect.objectContaining({ lifecycleAuthorityRevision: 1, status: "open" }),
      expect.objectContaining({ lifecycleAuthorityRevision: 5, status: "closing" }),
    ]);
  });
});
