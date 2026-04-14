import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

import {
  createAthenaArchitectureBoundaryConfig,
  createStorefrontArchitectureBoundaryConfig,
  getAthenaArchitectureBoundaryTargets,
  getStorefrontArchitectureBoundaryTargets,
} from "./eslint/architecture-boundaries.mjs";

const CHECKS = {
  "athena-webapp": {
    label: "@athena/webapp",
    relativeDir: path.join("packages", "athena-webapp"),
    files: getAthenaArchitectureBoundaryTargets(),
    config: createAthenaArchitectureBoundaryConfig(),
  },
  "storefront-webapp": {
    label: "@athena/storefront-webapp",
    relativeDir: path.join("packages", "storefront-webapp"),
    files: getStorefrontArchitectureBoundaryTargets(),
    config: createStorefrontArchitectureBoundaryConfig(),
  },
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function run() {
  const requestedChecks = process.argv.slice(2);
  const checkNames =
    requestedChecks.length > 0
      ? requestedChecks
      : Object.keys(CHECKS);

  let hasErrors = false;

  for (const checkName of checkNames) {
    const check = CHECKS[checkName];

    if (!check) {
      throw new Error(`Unknown architecture check target: ${checkName}`);
    }

    const eslint = new ESLint({
      cwd: path.join(repoRoot, check.relativeDir),
      overrideConfigFile: true,
      overrideConfig: tseslint.config(
        {
          files: ["**/*.{ts,tsx}"],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
              ecmaVersion: 2020,
              sourceType: "module",
              ecmaFeatures: {
                jsx: true,
              },
            },
          },
          plugins: {
            "react-hooks": reactHooks,
          },
        },
        ...check.config,
      ),
    });

    const results = await eslint.lintFiles(check.files);
    const errorResults = ESLint.getErrorResults(results);

    if (errorResults.length === 0) {
      console.log(`Architecture boundary check passed for ${check.label}.`);
      continue;
    }

    hasErrors = true;

    const formatter = await eslint.loadFormatter("stylish");
    const output = await formatter.format(errorResults);

    if (output.trim()) {
      console.error(output);
    }
  }

  if (hasErrors) {
    throw new Error("Architecture boundary check failed.");
  }
}

await run();
