import { describe, expect, it } from "vitest";

import { classifyExecutionContext } from "../.agent-skills/current/runtime/kernel.mjs";
import harnessConfig from "../harness.config";

const target = { config: harnessConfig };

describe("harness execution context", () => {
  it.each([
    "CODEX_THREAD_ID",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    "CODEX_CI",
    "CLAUDE_CODE",
  ])("classifies %s as an agent even with a TTY", (signal) => {
    expect(
      classifyExecutionContext({
        ...target,
        env: { [signal]: "1" },
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toMatchObject({ kind: "agent", signal });
  });

  it("does not treat IDE presentation hints as agent authority", () => {
    expect(
      classifyExecutionContext({
        ...target,
        env: { CURSOR_TRACE_ID: "trace", TERM_PROGRAM: "cursor" },
        stdinIsTTY: false,
        stdoutIsTTY: false,
      }),
    ).toEqual({ kind: "unknown", reason: "noninteractive_unrecognized" });
  });

  it("does not delegate the retired repository CI policy", () => {
    expect(
      classifyExecutionContext({
        ...target,
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_WORKFLOW: "Athena PR Tests",
          GITHUB_JOB: "harness-validation",
          GITHUB_EVENT_NAME: "pull_request",
          ATHENA_HARNESS_CI_POLICY: "athena-pr-tests",
        },
        stdinIsTTY: false,
        stdoutIsTTY: false,
      }).kind,
    ).not.toBe("ci");
  });

  it.each([
    { CI: "true" },
    { CODEX_CI: "1", CI: "true" },
    {
      GITHUB_ACTIONS: "true",
      GITHUB_WORKFLOW: "Athena PR Tests",
      GITHUB_JOB: "another-job",
      GITHUB_EVENT_NAME: "pull_request",
      ATHENA_HARNESS_CI_POLICY: "athena-pr-tests",
    },
    {
      GITHUB_ACTIONS: "true",
      GITHUB_WORKFLOW: "Athena PR Tests",
      GITHUB_JOB: "harness-validation",
      GITHUB_EVENT_NAME: "push",
      ATHENA_HARNESS_CI_POLICY: "athena-pr-tests",
    },
  ])("does not delegate unsupported automation markers", (env) => {
    expect(
      classifyExecutionContext({
        ...target,
        env,
        stdinIsTTY: false,
        stdoutIsTTY: false,
      }).kind,
    ).not.toBe("ci");
  });

  it.each([
    { GITHUB_ACTIONS: "true" },
    { ATHENA_HARNESS_CI_POLICY: "athena-pr-tests" },
    { DELIVERY_HARNESS_CI_POLICY: "athena-pr-tests" },
  ])("does not promote an automation claim into a human under a TTY", (env) => {
    const context = classifyExecutionContext({
      ...target,
      env,
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });
    expect(context.kind).not.toBe("human");
    expect(context.kind).not.toBe("ci");
  });

  it("classifies only a fully interactive unmarked process as human", () => {
    expect(
      classifyExecutionContext({
        ...target,
        env: {},
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toEqual({ kind: "human", interactive: true });
    expect(
      classifyExecutionContext({
        ...target,
        env: {},
        stdinIsTTY: true,
        stdoutIsTTY: false,
      }),
    ).toEqual({ kind: "unknown", reason: "noninteractive_unrecognized" });
  });
});
