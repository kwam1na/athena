import { describe, expect, it, vi } from "vitest";

import { userError } from "~/shared/commandResult";

import {
  classifyTerminalStaffAuthorityRefreshResult,
  refreshAndStoreTerminalStaffAuthority,
} from "./terminalStaffAuthorityRefresh";
import type { PosLocalStaffAuthorityRecord } from "./posLocalStore";

function buildAuthorityRecord(
  overrides: Partial<PosLocalStaffAuthorityRecord> = {},
): PosLocalStaffAuthorityRecord {
  return {
    activeRoles: ["cashier"],
    credentialId: "credential-1",
    credentialVersion: 1,
    displayName: "Ada",
    expiresAt: 2_000,
    issuedAt: 1_000,
    organizationId: "org-1",
    refreshedAt: 1_000,
    staffProfileId: "staff-1",
    status: "active",
    storeId: "store-1",
    terminalId: "terminal-1",
    username: "ada",
    verifier: {
      algorithm: "PBKDF2-SHA256",
      hash: "hash-1",
      iterations: 120_000,
      salt: "salt-1",
      version: 1,
    },
    ...overrides,
  };
}

describe("terminal staff authority refresh", () => {
  it("preserves existing local authority when refresh returns a user error", async () => {
    const replaceStaffAuthoritySnapshot = vi.fn();

    const result = await refreshAndStoreTerminalStaffAuthority({
      localStore: { replaceStaffAuthoritySnapshot },
      refreshTerminalStaffAuthority: vi.fn(async () =>
        userError({
          code: "precondition_failed",
          message: "Staff sign-in list is too large to refresh safely.",
        }),
      ),
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
    });

    expect(result).toEqual({
      code: "precondition_failed",
      message: "Staff sign-in list is too large to refresh safely.",
      status: "preserved",
    });
    expect(replaceStaffAuthoritySnapshot).not.toHaveBeenCalled();
  });

  it("clears local authority only when the server returns an authoritative empty list", async () => {
    const replaceStaffAuthoritySnapshot = vi.fn(async () => ({
      ok: true as const,
      value: [],
    }));

    const result = await refreshAndStoreTerminalStaffAuthority({
      localStore: { replaceStaffAuthoritySnapshot },
      refreshTerminalStaffAuthority: vi.fn(async () => ({
        data: [],
        kind: "ok" as const,
      })),
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
    });

    expect(result).toEqual({
      records: [],
      status: "authority_cleared",
    });
    expect(replaceStaffAuthoritySnapshot).toHaveBeenCalledWith({
      records: [],
      storeId: "store-1",
      terminalId: "terminal-1",
    });
  });

  it("stores mapped staff authority records when refresh succeeds", async () => {
    const replaceStaffAuthoritySnapshot = vi.fn(async () => ({
      ok: true as const,
      value: [buildAuthorityRecord({ displayName: "Ada synced" })],
    }));

    const result = await refreshAndStoreTerminalStaffAuthority({
      localStore: { replaceStaffAuthoritySnapshot },
      mapRecords: vi.fn(async (records: PosLocalStaffAuthorityRecord[]) =>
        records.map((record) => ({
          ...record,
          displayName: `${record.displayName} synced`,
        })),
      ),
      refreshTerminalStaffAuthority: vi.fn(async () => ({
        data: [buildAuthorityRecord()],
        kind: "ok" as const,
      })),
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
    });

    expect(result).toEqual({
      records: [
        {
          activeRoles: ["cashier"],
          credentialId: "credential-1",
          credentialVersion: 1,
          displayName: "Ada synced",
          expiresAt: 2_000,
          issuedAt: 1_000,
          organizationId: "org-1",
          refreshedAt: 1_000,
          staffProfileId: "staff-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
          username: "ada",
          verifier: {
            algorithm: "PBKDF2-SHA256",
            hash: "hash-1",
            iterations: 120_000,
            salt: "salt-1",
            version: 1,
          },
        },
      ],
      status: "ready",
    });
    expect(replaceStaffAuthoritySnapshot).toHaveBeenCalledWith({
      records: [
        {
          activeRoles: ["cashier"],
          credentialId: "credential-1",
          credentialVersion: 1,
          displayName: "Ada synced",
          expiresAt: 2_000,
          issuedAt: 1_000,
          organizationId: "org-1",
          refreshedAt: 1_000,
          staffProfileId: "staff-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
          username: "ada",
          verifier: {
            algorithm: "PBKDF2-SHA256",
            hash: "hash-1",
            iterations: 120_000,
            salt: "salt-1",
            version: 1,
          },
        },
      ],
      storeId: "store-1",
      terminalId: "terminal-1",
    });
  });

  it("reports write failures without treating authority as refreshed", async () => {
    const result = await refreshAndStoreTerminalStaffAuthority({
      localStore: {
        replaceStaffAuthoritySnapshot: vi.fn(async () => ({
          error: {
            code: "write_failed" as const,
            message: "IndexedDB unavailable",
          },
          ok: false as const,
        })),
      },
      refreshTerminalStaffAuthority: vi.fn(async () => ({
        data: [buildAuthorityRecord()],
        kind: "ok" as const,
      })),
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
    });

    expect(result).toEqual({
      message: "IndexedDB unavailable",
      status: "write_failed",
    });
  });

  it("classifies non-ok results as preserve-existing diagnostics", () => {
    expect(
      classifyTerminalStaffAuthorityRefreshResult(
        userError({
          code: "authorization_failed",
          message: "Not authorized.",
        }),
      ),
    ).toEqual({
      code: "authorization_failed",
      kind: "preserve_existing",
      message: "Not authorized.",
      source: "result",
    });
  });
});
