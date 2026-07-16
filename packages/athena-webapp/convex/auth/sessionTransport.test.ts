import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { describe, expect, it } from "vitest";

function contextForSubject(subject: string | null) {
  return {
    auth: {
      getUserIdentity: async () =>
        subject === null
          ? null
          : {
              issuer: "https://example.test",
              subject,
              tokenIdentifier: `https://example.test|${subject}`,
            },
    },
  };
}

describe("Convex Auth session transport", () => {
  it("exposes the exact Auth user and session IDs encoded in the identity subject", async () => {
    const ctx = contextForSubject("auth-user|auth-session");

    await expect(getAuthUserId(ctx as never)).resolves.toBe("auth-user");
    await expect(getAuthSessionId(ctx as never)).resolves.toBe("auth-session");
  });

  it("distinguishes concurrent sessions that share one Auth user", async () => {
    const firstSession = contextForSubject("auth-user|session-one");
    const secondSession = contextForSubject("auth-user|session-two");

    await expect(getAuthUserId(firstSession as never)).resolves.toBe("auth-user");
    await expect(getAuthUserId(secondSession as never)).resolves.toBe("auth-user");
    await expect(getAuthSessionId(firstSession as never)).resolves.toBe("session-one");
    await expect(getAuthSessionId(secondSession as never)).resolves.toBe("session-two");
  });

  it("returns null for both IDs when the request is unauthenticated", async () => {
    const ctx = contextForSubject(null);

    await expect(getAuthUserId(ctx as never)).resolves.toBeNull();
    await expect(getAuthSessionId(ctx as never)).resolves.toBeNull();
  });
});
