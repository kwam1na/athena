import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import { userError } from "../../../shared/commandResult";
import { registerTerminal } from "./commands/terminals";
import {
  getTerminalByFingerprint,
  getTerminalById,
  getTerminalByStoreIdAndRegisterNumber,
  patchTerminalRecord,
  registerTerminalRecord,
} from "../infrastructure/repositories/terminalRepository";

const browserInfo = {
  userAgent: "tests/terminal-settings",
};

const existingTerminal = {
  _id: "terminal-1" as Id<"posTerminal">,
  _creationTime: 111,
  storeId: "store-1" as Id<"store">,
  fingerprintHash: "fingerprint-1",
  syncSecretHash: "sync-secret-1",
  displayName: "Old Terminal",
  registerNumber: "A1",
  registeredByUserId: "user-1" as Id<"athenaUser">,
  browserInfo,
  registeredAt: 111,
  status: "active" as const,
};

const newTerminal = {
  _id: "terminal-2" as Id<"posTerminal">,
  _creationTime: 222,
  storeId: "store-1" as Id<"store">,
  fingerprintHash: "fingerprint-2",
  syncSecretHash: "sync-secret-2",
  displayName: "New Terminal",
  registerNumber: "B2",
  registeredByUserId: "user-1" as Id<"athenaUser">,
  browserInfo,
  registeredAt: 222,
  status: "active" as const,
};

vi.mock("../infrastructure/repositories/terminalRepository", () => ({
  getTerminalByFingerprint: vi.fn(),
  getTerminalById: vi.fn(),
  getTerminalByStoreIdAndRegisterNumber: vi.fn(),
  mapTerminalRecord: (terminal: typeof existingTerminal) => terminal,
  patchTerminalRecord: vi.fn(),
  registerTerminalRecord: vi.fn(),
  deleteTerminalRecord: vi.fn(),
}));

describe("registerTerminal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers a new terminal and returns ok", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(null);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);
    vi.mocked(registerTerminalRecord).mockResolvedValue(
      "terminal-2" as Id<"posTerminal">,
    );
    vi.mocked(getTerminalById).mockResolvedValue(newTerminal);

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-2",
      syncSecretHash: "sync-secret-2",
      displayName: "New Terminal",
      registerNumber: "B2",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(vi.mocked(registerTerminalRecord)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        storeId: "store-1",
        fingerprintHash: "fingerprint-2",
        syncSecretHash: "sync-secret-2",
        displayName: "New Terminal",
        registerNumber: "B2",
      }),
    );
    expect(result).toEqual({
      kind: "ok",
      data: newTerminal,
    });
  });

  it("updates an existing terminal and returns ok", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(existingTerminal);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);
    vi.mocked(getTerminalById).mockResolvedValue({
      ...existingTerminal,
      displayName: "Updated Terminal",
      registerNumber: "A1",
    });

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-rotated",
      displayName: "Updated Terminal",
      registerNumber: "A1",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(vi.mocked(patchTerminalRecord)).toHaveBeenCalledWith(
      expect.anything(),
      existingTerminal._id,
      expect.objectContaining({
        displayName: "Updated Terminal",
        registeredByUserId: "user-1",
        browserInfo,
        syncSecretHash: "sync-secret-rotated",
        status: "active",
        registerNumber: "A1",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        kind: "ok",
        data: expect.objectContaining({
          syncSecretHash: "sync-secret-rotated",
        }),
      }),
    );
  });

  it("does not rebind an existing terminal to a different signed-in user", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(existingTerminal);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Updated Terminal",
      registerNumber: "A1",
      registeredByUserId: "user-2" as Id<"athenaUser">,
      browserInfo,
    });

    expect(result).toEqual(
      userError({
        code: "authorization_failed",
        message:
          "This terminal is already registered to another signed-in user.",
      }),
    );
    expect(vi.mocked(patchTerminalRecord)).not.toHaveBeenCalled();
  });

  it("does not reassign an existing terminal to another register number", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(existingTerminal);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Updated Terminal",
      registerNumber: "B2",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(result).toEqual(
      userError({
        code: "validation_failed",
        message:
          "This terminal is already assigned to another register number.",
      }),
    );
    expect(vi.mocked(patchTerminalRecord)).not.toHaveBeenCalled();
  });

  it("does not reactivate a revoked terminal through normal registration", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue({
      ...existingTerminal,
      status: "revoked",
    });
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Updated Terminal",
      registerNumber: "A1",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(result).toEqual(
      userError({
        code: "authorization_failed",
        message: "This terminal must be reactivated by an administrator.",
      }),
    );
    expect(vi.mocked(patchTerminalRecord)).not.toHaveBeenCalled();
  });

  it("returns validation failure when register number is missing", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(null);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-2",
      syncSecretHash: "sync-secret-2",
      displayName: "New Terminal",
      registerNumber: " ",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(result).toEqual(
      userError({
        code: "validation_failed",
        message: "A register number is required to identify the terminal.",
      }),
    );
  });

  it("returns validation failure when register number is duplicated in store", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(null);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue({
      ...existingTerminal,
      _id: "terminal-2" as Id<"posTerminal">,
      registerNumber: "A1",
    });

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-2",
      syncSecretHash: "sync-secret-2",
      displayName: "New Terminal",
      registerNumber: "A1",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(result).toEqual(
      userError({
        code: "validation_failed",
        message:
          "A terminal with this register number already exists in this store.",
      }),
    );
  });
});
