import { describe, expect, it } from "vitest";
import {
  createInitializeRequest,
  createThreadStartRequest,
  createTurnStartRequest,
  extractRateLimits,
  extractThreadId,
  extractTurnId,
  extractUsage,
  getTurnTerminalState,
  isApprovalRequest,
  isUnsupportedToolCallRequest,
  isUserInputRequired,
  parseProtocolLine,
} from "../src/codex/protocol";

describe("codex protocol builders", () => {
  it("builds initialize request", () => {
    const msg = createInitializeRequest(1);
    expect(msg).toMatchObject({ id: 1, method: "initialize" });
  });

  it("supports configurable client identity", () => {
    const msg = createInitializeRequest(2, {
      clientName: "athena-symphony",
      clientVersion: "1.2.3",
      capabilities: {
        tools: true,
      },
    });

    expect(msg).toMatchObject({
      id: 2,
      method: "initialize",
      params: {
        clientInfo: {
          name: "athena-symphony",
          version: "1.2.3",
        },
        capabilities: {
          tools: true,
        },
      },
    });
  });

  it("builds thread/start and turn/start requests", () => {
    const thread = createThreadStartRequest(2, {
      cwd: "/tmp/workspace",
      approvalPolicy: "never",
      sandbox: "workspace-write",
    });

    const turn = createTurnStartRequest(3, {
      threadId: "thread-1",
      cwd: "/tmp/workspace",
      title: "ATH-1: test",
      inputText: "prompt",
      approvalPolicy: "never",
      sandboxPolicy: { type: "workspace-write" },
    });

    expect(thread.method).toBe("thread/start");
    expect(turn.method).toBe("turn/start");
  });
});

describe("codex protocol parsing", () => {
  it("parses valid json line", () => {
    const parsed = parseProtocolLine('{"method":"turn/completed"}');
    expect(parsed.kind).toBe("json");
  });

  it("marks malformed json line", () => {
    const parsed = parseProtocolLine("{not-json");
    expect(parsed.kind).toBe("malformed");
  });

  it("extracts thread and turn ids from nested result", () => {
    expect(extractThreadId({ result: { thread: { id: "thread-123" } } })).toBe("thread-123");
    expect(extractTurnId({ result: { turn: { id: "turn-123" } } })).toBe("turn-123");
  });

  it("detects terminal turn methods", () => {
    expect(getTurnTerminalState("turn/completed")).toBe("completed");
    expect(getTurnTerminalState("turn/failed")).toBe("failed");
    expect(getTurnTerminalState("turn/cancelled")).toBe("cancelled");
    expect(getTurnTerminalState("turn/other")).toBeNull();
  });

  it("detects approval/tool/user-input requests", () => {
    expect(isApprovalRequest({ id: "x", method: "approval/request" })).toBe(true);
    expect(isUnsupportedToolCallRequest({ id: "x", method: "item/tool/call" })).toBe(true);
    expect(isUserInputRequired({ method: "item/tool/requestUserInput" })).toBe(true);
    expect(isUserInputRequired({ params: { inputRequired: true } })).toBe(true);
  });

  it("extracts usage and rate limits from payload variants", () => {
    expect(extractUsage({ params: { total_token_usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } })).toEqual({
      input_tokens: 1,
      output_tokens: 2,
      total_tokens: 3,
    });

    expect(extractRateLimits({ params: { rate_limits: { remaining: 10 } } })).toEqual({ remaining: 10 });
  });

  it("extracts usage from thread/tokenUsage/updated total payload", () => {
    expect(
      extractUsage({
        method: "thread/tokenUsage/updated",
        params: {
          tokenUsage: {
            total: {
              inputTokens: 12419,
              outputTokens: 313,
              totalTokens: 12732,
            },
            last: {
              inputTokens: 12419,
              outputTokens: 313,
              totalTokens: 12732,
            },
          },
        },
      }),
    ).toEqual({
      input_tokens: 12419,
      output_tokens: 313,
      total_tokens: 12732,
    });
  });

  it("extracts usage and rate limits from codex/event/token_count msg payload", () => {
    expect(
      extractUsage({
        method: "codex/event/token_count",
        params: {
          msg: {
            info: {
              total_token_usage: {
                input_tokens: 11,
                output_tokens: 5,
                total_tokens: 16,
              },
            },
          },
        },
      }),
    ).toEqual({
      input_tokens: 11,
      output_tokens: 5,
      total_tokens: 16,
    });

    expect(
      extractRateLimits({
        method: "codex/event/token_count",
        params: {
          msg: {
            rate_limits: {
              remaining: 999,
            },
          },
        },
      }),
    ).toEqual({
      remaining: 999,
    });
  });
});
