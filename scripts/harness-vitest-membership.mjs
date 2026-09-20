#!/usr/bin/env node
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { createVitest } from "vitest/node";

// Vitest positional arguments are substring filters, including './file.test.ts'.
// Discover through the package config, then execute exact public specifications.
async function main(args) {
  const paths = [];
  let maxWorkers;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const value = args[++index];
    if (flag === "--test-file" && value && !value.startsWith("--")) {
      paths.push(value);
    } else if (
      flag === "--max-workers" &&
      /^[1-9]\d*$/.test(value ?? "") &&
      maxWorkers === undefined
    ) {
      maxWorkers = Number(value);
      if (!Number.isSafeInteger(maxWorkers))
        throw new Error("Invalid max-workers value");
    } else {
      throw new Error(`Invalid membership argument: ${flag}`);
    }
  }
  if (!paths.length) throw new Error("At least one --test-file is required");
  const root = await realpath(process.cwd());
  const selected = new Set();
  for (const path of paths) {
    if (
      isAbsolute(path) ||
      path.includes("\\") ||
      path.split("/").includes("..") ||
      /[\x00-\x1f]/.test(path)
    ) {
      throw new Error(`Test path must be package-relative: ${path}`);
    }
    const absolute = resolve(root, path);
    if (
      !absolute.startsWith(`${root}${sep}`) ||
      (await realpath(absolute)) !== absolute ||
      !(await stat(absolute)).isFile()
    ) {
      throw new Error(
        `Test path must be a contained regular file without symlink aliases: ${path}`,
      );
    }
    if (selected.has(absolute))
      throw new Error(`Duplicate test membership: ${path}`);
    selected.add(absolute);
  }
  const options = {
    watch: false,
    ...(maxWorkers === undefined ? {} : { maxWorkers }),
  };
  // Match the pinned CLI's prepareVitest bootstrap before loading Vite config.
  process.env.TEST = "true";
  process.env.VITEST = "true";
  process.env.NODE_ENV ??= "test";
  const vitest = await createVitest("test", options);
  try {
    const discovered = await vitest.globTestSpecifications();
    const specifications = discovered.filter((spec) =>
      selected.has(spec.moduleId),
    );
    // Multiple projects can assign different environments to the same path. Do
    // not silently choose one or execute more than the declared file profile.
    for (const path of selected) {
      const count = specifications.filter(
        (spec) => spec.moduleId === path,
      ).length;
      if (count !== 1)
        throw new Error(
          `Expected one configured specification for ${path}; found ${count}`,
        );
    }
    await vitest.standalone();
    const result = await vitest.runTestSpecifications(specifications);
    const executed = result.testModules.map((module) => module.moduleId);
    if (
      executed.length !== selected.size ||
      executed.some((path) => !selected.has(path)) ||
      new Set(executed).size !== selected.size
    ) {
      throw new Error(
        "Executed test membership differs from requested membership",
      );
    }
    if (
      result.unhandledErrors.length ||
      result.testModules.some((module) => module.state() !== "passed")
    ) {
      process.exitCode = 1;
    }
  } finally {
    await vitest.close();
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(
    JSON.stringify({
      schemaVersion: 1,
      blockers: [
        {
          code: "vitest_membership_failed",
          source: { kind: "command", id: "harness:vitest-membership" },
          summary: "Exact Vitest membership could not be executed.",
          details: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 8000),
          remediations: [
            {
              id: "repair-vitest-membership",
              kind: "code_change",
              summary:
                "Repair the selected test membership or package test configuration, then rerun the canonical validation plan.",
            },
          ],
        },
      ],
    }),
  );
  process.exitCode = 1;
}
