import { describe, expect, it } from "vitest";

import { registrationCeremonyPolicy, verificationPolicy } from "./passkeys";

describe("waiver passkey ceremony policy", () => {
  it("requires a local platform credential with resident storage and user verification", () => {
    expect(registrationCeremonyPolicy("reviewer@example.com", "athena-os.app"))
      .toMatchObject({
        rpID: "athena-os.app",
        userName: "reviewer@example.com",
        attestationType: "none",
        preferredAuthenticatorType: "localDevice",
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
          userVerification: "required",
        },
      });
  });

  it("binds registration and authentication verification to challenge, origin, RP, and UV", () => {
    expect(verificationPolicy("challenge-1", "https://athena-os.app", "athena-os.app"))
      .toEqual({
        expectedChallenge: "challenge-1",
        expectedOrigin: "https://athena-os.app",
        expectedRPID: "athena-os.app",
        requireUserVerification: true,
      });
  });
});
