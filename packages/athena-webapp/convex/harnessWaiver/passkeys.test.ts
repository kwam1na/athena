import { describe, expect, it } from "vitest";

import {
  authenticationChallengeBytes,
  registrationCeremonyPolicy,
  verificationPolicy,
} from "./passkeys";

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

  it("decodes a stored Base64URL challenge before regenerating browser options", () => {
    const challengeBytes = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);
    const storedChallenge = Buffer.from(challengeBytes).toString("base64url");

    expect(authenticationChallengeBytes(storedChallenge)).toEqual(challengeBytes);
  });
});
