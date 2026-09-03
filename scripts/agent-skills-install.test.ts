import { describe, expect, it } from "vitest";

import {
  CHECKOUT_ENV_VAR,
  assertInstalled,
  parseArgs,
  resolveCheckout,
  type BuiltRelease,
} from "./agent-skills-install";

const built: BuiltRelease = {
  releaseId: "linear-v2",
  profile: "linear",
  archiveSha256: "a".repeat(64),
};

const cleanStatus = {
  lifecycle: "current",
  blockers: [],
  active: {
    releaseId: built.releaseId,
    profile: built.profile,
    archiveSha256: built.archiveSha256,
  },
};

describe("resolveCheckout", () => {
  it("names the environment variable when the checkout is not declared", () => {
    expect(() => resolveCheckout({})).toThrow(CHECKOUT_ENV_VAR);
    expect(() => resolveCheckout({ [CHECKOUT_ENV_VAR]: "  " })).toThrow(
      CHECKOUT_ENV_VAR
    );
  });

  it("rejects a relative checkout path", () => {
    expect(() => resolveCheckout({ [CHECKOUT_ENV_VAR]: "../skills" })).toThrow(
      /absolute path/
    );
  });

  it("returns the declared absolute checkout", () => {
    expect(resolveCheckout({ [CHECKOUT_ENV_VAR]: "/srv/agent-skills" })).toBe(
      "/srv/agent-skills"
    );
  });
});

describe("assertInstalled", () => {
  it("accepts a status that reports the built release as current", () => {
    expect(() => assertInstalled(cleanStatus, built)).not.toThrow();
  });

  it("fails when the lifecycle is not current", () => {
    expect(() =>
      assertInstalled({ ...cleanStatus, lifecycle: "recovering" }, built)
    ).toThrow(/lifecycle is "recovering", expected "current"/);
  });

  it("fails when status reports blockers", () => {
    expect(() =>
      assertInstalled({ ...cleanStatus, blockers: [{ code: "drift" }] }, built)
    ).toThrow(/1 blocker\(s\)/);
  });

  it("fails when a different release is active", () => {
    expect(() =>
      assertInstalled(
        { ...cleanStatus, active: { ...cleanStatus.active, releaseId: "linear-v1" } },
        built
      )
    ).toThrow(/active release is "linear-v1"/);
  });

  it("fails when the active archive is not the one just built", () => {
    expect(() =>
      assertInstalled(
        {
          ...cleanStatus,
          active: { ...cleanStatus.active, archiveSha256: "b".repeat(64) },
        },
        built
      )
    ).toThrow(/active archive is/);
  });

  it("reports every reason the install did not converge", () => {
    expect(() => assertInstalled({}, built)).toThrow(
      /lifecycle is[\s\S]*active release is[\s\S]*active archive is/
    );
  });
});

describe("parseArgs", () => {
  it("reads the release id and profile", () => {
    expect(parseArgs(["linear-v2", "--profile", "linear"])).toEqual({
      releaseId: "linear-v2",
      profile: "linear",
    });
  });

  it("requires both the release id and the profile", () => {
    expect(() => parseArgs(["linear-v2"])).toThrow(/Usage:/);
    expect(() => parseArgs(["--profile", "linear"])).toThrow(/Usage:/);
  });
});
