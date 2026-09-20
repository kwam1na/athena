import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

it("loads the native configuration bridge under Node without evaluating Bun-only planning code", () => {
  const file = fileURLToPath(
    new URL("./harness-validation-load.ts", import.meta.url),
  );
  const output = execFileSync(
    "node",
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(file)}); console.log(typeof m.captureNativeValidationSelection)`,
    ],
    { encoding: "utf8" },
  );
  expect(output.trim()).toBe("function");
});
