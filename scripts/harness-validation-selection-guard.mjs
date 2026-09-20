#!/usr/bin/env node
import { execFileSync } from "node:child_process";

// First native scoped provider, with full Git context and no dependency setup.
// Expected coordinates are scoped flags; argv stays static across candidates.
try {
  const env = process.env;
  const required = (name) => {
    const value = env[name];
    if (!value || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))
      throw new Error(`Missing or invalid selection coordinate: ${name}`);
    return value;
  };
  const expected = {
    head: required("ATHENA_SELECTION_HEAD"),
    tree: required("ATHENA_SELECTION_TREE"),
    base: required("ATHENA_SELECTION_BASE"),
    mergeBase: required("ATHENA_SELECTION_MERGE_BASE"),
  };
  if (
    expected.head !== required("DELIVERY_CHECK_ORIGIN_HEAD") ||
    expected.tree !== required("DELIVERY_CHECK_ORIGIN_TREE") ||
    expected.mergeBase !== required("DELIVERY_CHECK_MERGE_BASE") ||
    env.DELIVERY_CHECK_BASE_REF !== "refs/delivery/base" ||
    env.DELIVERY_CHECK_CANDIDATE_REF !== "refs/delivery/candidate"
  )
    throw new Error(
      "Native capture differs from the candidate used for selection",
    );
  const git = (ref) =>
    execFileSync("git", ["rev-parse", "--verify", ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  for (const [ref, value] of [
    ["refs/delivery/origin-head", expected.head],
    ["refs/delivery/candidate^{tree}", expected.tree],
    ["refs/delivery/base", expected.base],
    ["refs/delivery/merge-base", expected.mergeBase],
  ]) {
    if (git(ref) !== value)
      throw new Error("Private Git context differs from validation selection");
  }
} catch (error) {
  console.error(
    JSON.stringify({
      schemaVersion: 1,
      blockers: [
        {
          code: "validation_selection_stale",
          source: { kind: "command", id: "harness:selection-guard" },
          summary:
            "Validation selection does not match the native prepared candidate.",
          details: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 8000),
          remediations: [
            {
              id: "recapture-validation-selection",
              kind: "manual_action",
              summary:
                "Finish source repairs and capture a fresh canonical plan before retrying native preparation or validation.",
            },
          ],
        },
      ],
    }),
  );
  process.exitCode = 1;
}
