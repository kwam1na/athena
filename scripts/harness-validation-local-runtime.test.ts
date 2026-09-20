import { expect, test } from "bun:test";
import { ATHENA_LEGACY_CONFIG } from "../harness.config.ts";
import { configureLocalScopedValidation } from "./harness-validation-local-runtime.ts";

test("unavailable trusted authority refuses before source capture or environment publication", async () => {
  const env = { ATHENA_VALIDATION_HEALTH_REVISION: "previous" };
  let captures = 0;
  const failure = new Error("trusted inventory unavailable");
  await expect(
    configureLocalScopedValidation(
      "unused",
      ATHENA_LEGACY_CONFIG,
      "comparison",
      env,
      {
        readAuthority: async () => {
          throw failure;
        },
        capture: () => {
          captures++;
          throw new Error("capture must not run");
        },
      },
    ),
  ).rejects.toBe(failure);
  expect(captures).toBe(0);
  expect(env).toEqual({ ATHENA_VALIDATION_HEALTH_REVISION: "previous" });
});
