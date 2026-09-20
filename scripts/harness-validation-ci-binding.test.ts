import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

it.each(["harness-validation-ci-binding.ts", "harness-validation-trust.ts"])(
  "imports %s without evaluating opt-in harness configuration",
  (name) => {
    const module = fileURLToPath(new URL(`./${name}`, import.meta.url));
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `const m = await import(${JSON.stringify(module)}); console.log(typeof (m.resolveHostedValidationBinding ?? m.guardValidationCandidate));`,
      ],
      {
        env: {
          ...process.env,
          ATHENA_VALIDATION_MODE: "INVALID_CONFIG_SENTINEL",
        },
        encoding: "utf8",
      },
    );
    expect(output.trim()).toBe("function");
  },
);
