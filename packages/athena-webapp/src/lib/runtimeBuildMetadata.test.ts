import { describe, expect, it } from "vitest";

import {
  normalizeDeployMetadata,
  readRuntimeBuildMetadata,
} from "./runtimeBuildMetadata";

describe("runtimeBuildMetadata", () => {
  it("formats deploy metadata into terminal runtime build metadata", () => {
    expect(
      normalizeDeployMetadata({
        fun_name: "gentle-lion-climbs",
        git_sha: "b463caa2d36dabcdef",
        version: "20260608193135",
      }),
    ).toEqual({
      appVersion: "gentle-lion-climbs (20260608193135)",
      buildSha: "b463caa2d36dabcdef",
    });
  });

  it("reads deploy metadata from the deployed app manifest", async () => {
    const metadata = await readRuntimeBuildMetadata(
      async () =>
        new Response(
          JSON.stringify({
            fun_name: "quick-whale-runs",
            git_sha: "abc123def456",
            version: "20260609120000",
          }),
        ),
    );

    expect(metadata).toEqual({
      appVersion: "quick-whale-runs (20260609120000)",
      buildSha: "abc123def456",
    });
  });

  it("ignores missing deploy metadata", async () => {
    const metadata = await readRuntimeBuildMetadata(
      async () => new Response("not found", { status: 404 }),
    );

    expect(metadata).toEqual({});
  });
});
