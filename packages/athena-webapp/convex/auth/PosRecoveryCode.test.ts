import { describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import { ATHENA_POS_RECOVERY_CODE_PROVIDER_ID } from "../../shared/auth";

const providerMocks = vi.hoisted(() => ({
  ConvexCredentials: vi.fn((config) => config),
}));

vi.mock("@convex-dev/auth/providers/ConvexCredentials", () => ({
  ConvexCredentials: providerMocks.ConvexCredentials,
}));

import { PosRecoveryCode } from "./PosRecoveryCode";

const AUTH_USER_ID = "auth-user-pos" as Id<"users">;
const AUTH_SESSION_ID = "auth-session-pos" as Id<"authSessions">;
const TERMINAL_ID = "terminal-1" as Id<"posTerminal">;

describe("PosRecoveryCode auth provider", () => {
  it("registers the Athena POS recovery-code provider id", () => {
    expect(PosRecoveryCode.id).toBe(ATHENA_POS_RECOVERY_CODE_PROVIDER_ID);
  });

  it("returns null when exact terminal recovery credentials are missing", async () => {
    const ctx = {
      auth: { getUserIdentity: vi.fn(async () => null) },
      runMutation: vi.fn(),
    };

    await expect(
      PosRecoveryCode.authorize(
        { code: "abc-123", terminalId: TERMINAL_ID },
        ctx as never,
      ),
    ).resolves.toBeNull();
    await expect(
      PosRecoveryCode.authorize(
        {
          recoveryCorrelationKey: "recovery-correlation-1",
          terminalId: TERMINAL_ID,
          terminalProof: "terminal-proof",
        },
        ctx as never,
      ),
    ).resolves.toBeNull();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("maps preparation to the exact Convex Auth user and session", async () => {
    const ctx = {
      auth: { getUserIdentity: vi.fn(async () => null) },
      runMutation: vi.fn(async () => ({
        authSessionId: AUTH_SESSION_ID,
        authUserId: AUTH_USER_ID,
      })),
    };

    await expect(
      PosRecoveryCode.authorize(
        {
          code: "abc-123",
          recoveryCorrelationKey: "recovery-correlation-1",
          terminalId: TERMINAL_ID,
          terminalProof: "terminal-proof",
        },
        ctx as never,
      ),
    ).resolves.toEqual({
      userId: AUTH_USER_ID,
      sessionId: AUTH_SESSION_ID,
    });
    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
      code: "abc-123",
      recoveryCorrelationKey: "recovery-correlation-1",
      terminalId: TERMINAL_ID,
      terminalProof: "terminal-proof",
    });
  });

  it("rejects recovery when an Auth session is already attached", async () => {
    const ctx = {
      auth: {
        getUserIdentity: vi.fn(async () => ({ subject: "user|session" })),
      },
      runMutation: vi.fn(),
    };

    await expect(
      PosRecoveryCode.authorize(
        {
          code: "abc-123",
          recoveryCorrelationKey: "recovery-correlation-1",
          terminalId: TERMINAL_ID,
          terminalProof: "terminal-proof",
        },
        ctx as never,
      ),
    ).resolves.toBeNull();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("returns null when internal verification rejects", async () => {
    const ctx = {
      auth: { getUserIdentity: vi.fn(async () => null) },
      runMutation: vi.fn(async () => {
        throw new Error("POS recovery sign-in failed.");
      }),
    };

    await expect(
      PosRecoveryCode.authorize(
        {
          code: "abc-123",
          recoveryCorrelationKey: "recovery-correlation-1",
          terminalId: TERMINAL_ID,
          terminalProof: "terminal-proof",
        },
        ctx as never,
      ),
    ).resolves.toBeNull();
  });
});
