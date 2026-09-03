import { describe, expect, it } from "vitest";

import { PAYLOAD_ENV_VAR, buildEmitArgs } from "./delivery-emit";

describe("buildEmitArgs", () => {
  it("passes the payload to --json as one argument", () => {
    expect(
      buildEmitArgs(["decision.recorded"], '{"fork":"branch name","choice":"x"}')
    ).toEqual([
      "emit",
      "decision.recorded",
      "--json",
      '{"fork":"branch name","choice":"x"}',
    ]);
  });

  it("forwards the CLI's own flags after the kind", () => {
    expect(buildEmitArgs(["run.ended", "--run", "run-abc"], undefined)).toEqual([
      "emit",
      "run.ended",
      "--run",
      "run-abc",
      "--json",
      "{}",
    ]);
  });

  it("defaults an absent or blank payload to an empty object", () => {
    expect(buildEmitArgs(["posture.declared"], "  ")).toContain("{}");
  });

  it("requires a kind", () => {
    expect(() => buildEmitArgs([], "{}")).toThrow(/Usage:/);
  });

  it("rejects a caller-supplied --json rather than silently overriding it", () => {
    expect(() =>
      buildEmitArgs(["run.started", "--json", '{"host":"x"}'], undefined)
    ).toThrow(`The payload travels in ${PAYLOAD_ENV_VAR}, not in --json.`);
  });

  it("rejects a payload that is not JSON", () => {
    expect(() => buildEmitArgs(["run.started"], "posture=sensor-only")).toThrow(
      `${PAYLOAD_ENV_VAR} is not valid JSON.`
    );
  });
});
