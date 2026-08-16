import { describe, expect, it } from "vitest";

import {
  classifyHarnessExecutionContext,
  resolveHarnessExecutionContext,
} from "./harness-execution-context";

const target = {
  gateId: "athena.pr-validation",
  obligationId: "review.green",
};

describe("harness execution context", () => {
  it.each([
    "CODEX_THREAD_ID",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    "CODEX_CI",
    "CLAUDE_CODE",
  ])("classifies %s as an agent even with a TTY", (signal) => {
    expect(
      classifyHarnessExecutionContext({
        ...target,
        env: { [signal]: "1" },
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toMatchObject({ kind: "agent", signal });
  });

  it("does not treat IDE presentation hints as agent authority", () => {
    expect(
      classifyHarnessExecutionContext({
        ...target,
        env: { CURSOR_TRACE_ID: "trace", TERM_PROGRAM: "cursor" },
        stdinIsTTY: false,
        stdoutIsTTY: false,
      }),
    ).toEqual({ kind: "unknown", reason: "noninteractive_unrecognized" });
  });

  it("authorizes only the exact repository CI policy mapping", () => {
    expect(
      classifyHarnessExecutionContext({
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
      }),
    ).toMatchObject({ kind: "ci", policyId: "athena-pr-tests" });
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
      classifyHarnessExecutionContext({
        ...target,
        env,
        stdinIsTTY: false,
        stdoutIsTTY: false,
      }).kind,
    ).not.toBe("ci");
  });

  it("does not reuse a valid policy for another gate", () => {
    expect(
      classifyHarnessExecutionContext({
        gateId: "another.gate",
        obligationId: "review.green",
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_WORKFLOW: "Athena PR Tests",
          GITHUB_JOB: "harness-validation",
          GITHUB_EVENT_NAME: "pull_request",
          ATHENA_HARNESS_CI_POLICY: "athena-pr-tests",
        },
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toEqual({ kind: "unknown", reason: "unauthorized_automation" });
  });

  it("classifies only a fully interactive unmarked process as human", () => {
    expect(
      classifyHarnessExecutionContext({
        ...target,
        env: {},
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toEqual({ kind: "human", interactive: true });
    expect(
      classifyHarnessExecutionContext({
        ...target,
        env: {},
        stdinIsTTY: true,
        stdoutIsTTY: false,
      }),
    ).toEqual({ kind: "unknown", reason: "noninteractive_unrecognized" });
  });

  it("recognizes a controlling terminal when wrapper output is captured", () => {
    expect(
      resolveHarnessExecutionContext(
        { kind: "unknown", reason: "noninteractive_unrecognized" },
        () => true,
      ),
    ).toEqual({ kind: "human", interactive: true });
  });

  it("never promotes agents or unauthorized automation through a controlling terminal", () => {
    expect(
      resolveHarnessExecutionContext(
        { kind: "agent", signal: "CODEX_THREAD_ID" },
        () => true,
      ),
    ).toEqual({ kind: "agent", signal: "CODEX_THREAD_ID" });
    expect(
      resolveHarnessExecutionContext(
        { kind: "unknown", reason: "unauthorized_automation" },
        () => true,
      ),
    ).toEqual({ kind: "unknown", reason: "unauthorized_automation" });
  });
});
