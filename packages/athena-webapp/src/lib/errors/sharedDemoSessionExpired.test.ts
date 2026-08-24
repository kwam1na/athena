import { beforeEach, describe, expect, it } from "vitest";

import {
  SHARED_DEMO_ACTION_DENIED_CODE,
  SHARED_DEMO_ACTION_DENIED_MESSAGE,
  SHARED_DEMO_SESSION_EXPIRED_CODE,
} from "~/shared/sharedDemoActionError";
import {
  canRenewSharedDemoSession,
  clearSharedDemoRenewalAttempts,
  isSharedDemoSessionExpiredError,
  MAX_SHARED_DEMO_RENEWAL_ATTEMPTS,
  recordSharedDemoRenewalAttempt,
} from "./sharedDemoSessionExpired";

describe("shared demo session expiry", () => {
  it("recognizes the expiry code carried as ConvexError data", () => {
    expect(
      isSharedDemoSessionExpiredError({
        data: { code: SHARED_DEMO_SESSION_EXPIRED_CODE },
        message: "[CONVEX Q(app:getCurrentUser)] Server Error",
      }),
    ).toBe(true);
  });

  it("recognizes the legacy message while Convex still forwards it", () => {
    expect(
      isSharedDemoSessionExpiredError(
        new Error("The demo session has expired. Open the demo again."),
      ),
    ).toBe(true);
  });

  /**
   * The distinction the renewal loop depends on. A policy denial means "the
   * demo does not do this" — renewing changes nothing, so a client that
   * renewed on it would spin forever against a surface that is never coming
   * back.
   */
  it("does not mistake a policy denial for an expired session", () => {
    expect(
      isSharedDemoSessionExpiredError({
        data: {
          code: SHARED_DEMO_ACTION_DENIED_CODE,
          message: SHARED_DEMO_ACTION_DENIED_MESSAGE,
        },
      }),
    ).toBe(false);
  });

  it("ignores unrelated errors and non-objects", () => {
    expect(isSharedDemoSessionExpiredError(new Error("network down"))).toBe(
      false,
    );
    expect(isSharedDemoSessionExpiredError(null)).toBe(false);
    expect(isSharedDemoSessionExpiredError("expired")).toBe(false);
  });
});

describe("shared demo renewal attempts", () => {
  beforeEach(() => {
    clearSharedDemoRenewalAttempts();
  });

  it("stops renewing once the cap is reached", () => {
    expect(canRenewSharedDemoSession()).toBe(true);

    for (let i = 0; i < MAX_SHARED_DEMO_RENEWAL_ATTEMPTS; i += 1) {
      recordSharedDemoRenewalAttempt();
    }

    // Without this the renewal reloads into the same failure and renews again,
    // minting admissions forever and never showing the visitor anything.
    expect(canRenewSharedDemoSession()).toBe(false);
  });

  it("restores automatic renewal once a demo session is live again", () => {
    for (let i = 0; i < MAX_SHARED_DEMO_RENEWAL_ATTEMPTS; i += 1) {
      recordSharedDemoRenewalAttempt();
    }
    expect(canRenewSharedDemoSession()).toBe(false);

    // `SharedDemoRuntime` clears the counter when a live context renders, so
    // the cap is not a one-way door for a visitor who expires again later.
    clearSharedDemoRenewalAttempts();

    expect(canRenewSharedDemoSession()).toBe(true);
  });
});
