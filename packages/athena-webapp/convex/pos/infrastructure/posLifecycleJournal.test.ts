import { describe, expect, it, vi } from "vitest";

import { appendPosLifecycleJournalWithCtx } from "./posLifecycleJournal";

function createCtx(
  existing: Record<string, unknown> | null = null,
  cursor: Record<string, unknown> | null = null,
) {
  const insert = vi.fn(
    async (_table: string, _value: Record<string, unknown>) => "journal-1",
  );
  const unique = vi.fn(async () => existing);
  const patch = vi.fn(async () => undefined);
  const cursorUnique = vi.fn(async () => cursor);
  const eq = vi.fn(function (this: unknown) {
    return { eq, unique };
  });
  const withIndex = vi.fn((_name, apply) => {
    apply({ eq });
    return { unique };
  });
  const cursorWithIndex = vi.fn((_name, apply) => {
    apply({ eq });
    return { unique: cursorUnique };
  });
  return {
    ctx: {
      db: {
        insert,
        patch,
        query: vi.fn((table: string) => ({
          withIndex:
            table === "posLifecycleJournalCursor"
              ? cursorWithIndex
              : withIndex,
        })),
      },
    },
    eq,
    insert,
    patch,
    withIndex,
  };
}

const input = {
  organizationId: "org-1",
  storeId: "store-1",
  transactionId: "txn-1",
  eventKind: "completed" as const,
  eventKey: "pos:txn-1:completed",
  contentFingerprint: "completed:v1:txn-1:1200",
  occurredAt: 4_102_444_800_000,
  origin: "cloud" as const,
};

describe("POS lifecycle journal", () => {
  it("appends sanitized immutable evidence for a new stable identity", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_102_444_800_100);
    const { ctx, insert, patch, withIndex } = createCtx();

    await expect(
      appendPosLifecycleJournalWithCtx(ctx as never, input as never),
    ).resolves.toEqual({ disposition: "created", journalId: "journal-1" });

    expect(withIndex).toHaveBeenCalledWith(
      "by_storeId_eventKey",
      expect.any(Function),
    );
    expect(insert).toHaveBeenCalledWith("posLifecycleJournal", {
      ...input,
      recordedAt: 4_102_444_800_100,
      sequence: 1,
    });
    expect(insert).toHaveBeenCalledWith("posLifecycleJournalCursor", {
      nextSequence: 2,
      storeId: "store-1",
      updatedAt: 4_102_444_800_100,
    });
    const journalInsert = insert.mock.calls.find(
      ([table]) => table === "posLifecycleJournal",
    )?.[1];
    expect(journalInsert).not.toHaveProperty("payments");
    expect(journalInsert).not.toHaveProperty("customerInfo");
    expect(journalInsert).not.toHaveProperty("reason");
    expect(patch).not.toHaveBeenCalled();
  });

  it("treats an identical retry as an idempotent no-op", async () => {
    const { ctx, insert } = createCtx({
      _id: "journal-existing",
      recordedAt: 4_102_444_800_100,
      ...input,
    });

    await expect(
      appendPosLifecycleJournalWithCtx(ctx as never, input as never),
    ).resolves.toEqual({
      disposition: "existing",
      journalId: "journal-existing",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("uses distinct system sequences when wall-clock milliseconds collide", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_102_444_800_100);
    const first = createCtx(null, {
      _id: "cursor-1",
      nextSequence: 41,
      storeId: "store-1",
    });
    const second = createCtx(null, {
      _id: "cursor-1",
      nextSequence: 42,
      storeId: "store-1",
    });

    await appendPosLifecycleJournalWithCtx(first.ctx as never, input as never);
    await appendPosLifecycleJournalWithCtx(
      second.ctx as never,
      { ...input, eventKey: "pos:txn-2:completed" } as never,
    );

    expect(first.insert.mock.calls.at(-1)?.[1]).toMatchObject({
      recordedAt: 4_102_444_800_100,
      sequence: 41,
    });
    expect(second.insert.mock.calls.at(-1)?.[1]).toMatchObject({
      recordedAt: 4_102_444_800_100,
      sequence: 42,
    });
    expect(first.patch).toHaveBeenCalledWith("cursor-1", {
      nextSequence: 42,
      updatedAt: 4_102_444_800_100,
    });
    expect(second.patch).toHaveBeenCalledWith("cursor-1", {
      nextSequence: 43,
      updatedAt: 4_102_444_800_100,
    });
  });

  it("rejects a stable identity reused with different material evidence", async () => {
    const { ctx, insert } = createCtx({
      _id: "journal-existing",
      recordedAt: 4_102_444_800_100,
      ...input,
      contentFingerprint: "completed:v1:txn-1:9999",
    });

    await expect(
      appendPosLifecycleJournalWithCtx(ctx as never, input as never),
    ).rejects.toThrow(
      "POS lifecycle journal identity conflict for pos:txn-1:completed.",
    );
    expect(insert).not.toHaveBeenCalled();
  });
});
