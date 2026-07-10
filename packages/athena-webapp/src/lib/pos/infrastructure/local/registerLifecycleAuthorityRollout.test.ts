import { describe, expect, it } from "vitest";

import {
  resolveRegisterLifecycleAuthorityRolloutPolicy,
  resolveRegisterLifecycleAuthorityRolloutCohort,
  shouldApplyRegisterLifecycleAuthority,
  shouldSubscribeToRegisterLifecycleAuthority,
} from "./registerLifecycleAuthorityRollout";

describe("register lifecycle authority rollout", () => {
  it("defaults development to broad and production to shadow", () => {
    expect(
      resolveRegisterLifecycleAuthorityRolloutPolicy({ isDevelopment: true })
        .mode,
    ).toBe("broad");
    expect(
      resolveRegisterLifecycleAuthorityRolloutPolicy({ isDevelopment: false })
        .mode,
    ).toBe("shadow");
  });

  it("supports an explicit disable without subscribing or applying", () => {
    const policy = resolveRegisterLifecycleAuthorityRolloutPolicy({
      configuredMode: "disabled",
      isDevelopment: true,
    });
    expect(shouldSubscribeToRegisterLifecycleAuthority(policy)).toBe(false);
    expect(shouldApplyRegisterLifecycleAuthority(policy, "terminal-1")).toBe(
      false,
    );
  });

  it("applies canary authority only to exact configured terminal IDs", () => {
    const policy = resolveRegisterLifecycleAuthorityRolloutPolicy({
      canaryTerminalIds: " terminal-1,terminal-2 ",
      configuredMode: "canary",
      isDevelopment: false,
    });
    expect(shouldSubscribeToRegisterLifecycleAuthority(policy)).toBe(true);
    expect(shouldApplyRegisterLifecycleAuthority(policy, "terminal-1")).toBe(
      true,
    );
    expect(shouldApplyRegisterLifecycleAuthority(policy, "terminal-3")).toBe(
      false,
    );
    expect(resolveRegisterLifecycleAuthorityRolloutCohort(policy, "terminal-1"))
      .toBe("canary");
    expect(resolveRegisterLifecycleAuthorityRolloutCohort(policy, "terminal-3"))
      .toBe("shadow");
  });
});
