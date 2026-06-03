import { describe, expect, it, vi } from "vitest";

import { ATHENA_POS_RECOVERY_CODE_PROVIDER_ID } from "../shared/auth";

const authMocks = vi.hoisted(() => ({
  EmailOTP: { id: "athena-email-otp" },
  PosRecoveryCode: { id: "athena-pos-recovery-code" },
  convexAuth: vi.fn(() => ({
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    store: vi.fn(),
  })),
}));

vi.mock("@convex-dev/auth/server", () => ({
  convexAuth: authMocks.convexAuth,
}));

vi.mock("./otp/EmailOTP", () => ({
  EmailOTP: authMocks.EmailOTP,
}));

vi.mock("./auth/PosRecoveryCode", () => ({
  PosRecoveryCode: authMocks.PosRecoveryCode,
}));

describe("Convex Auth provider composition", () => {
  it("registers email OTP and POS recovery-code providers", async () => {
    await import("./auth");

    expect(authMocks.convexAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: [
          expect.objectContaining({ id: "athena-email-otp" }),
          expect.objectContaining({ id: ATHENA_POS_RECOVERY_CODE_PROVIDER_ID }),
        ],
      }),
    );
  });
});
