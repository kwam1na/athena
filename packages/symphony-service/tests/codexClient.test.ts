import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAppServerClient } from "../src/codex/client";

const TEST_READ_TIMEOUT_MS = 75;
const TEST_TURN_TIMEOUT_MS = 75;

describe("CodexAppServerClient", () => {
  it("fails fast when cwd is not absolute", async () => {
    const client = new CodexAppServerClient({
      command: "codex app-server",
      readTimeoutMs: 100,
      turnTimeoutMs: 100,
    });

    await expect(client.startSession({ cwd: "relative/path" })).rejects.toMatchObject({
      code: "invalid_workspace_cwd",
    });
  });

  it("maps missing codex command to codex_not_found", async () => {
    const client = new CodexAppServerClient({
      command: "bash -lc \"echo command not found >&2; exit 127\"",
      readTimeoutMs: 1000,
      turnTimeoutMs: TEST_TURN_TIMEOUT_MS,
    });

    await expect(client.startSession({ cwd: process.cwd() })).rejects.toMatchObject({
      code: "codex_not_found",
    });
    client.stop();
  });

  it("enforces request/response read timeout", async () => {
    const client = new CodexAppServerClient({
      command: "node -e \"setInterval(() => {}, 10_000)\"",
      readTimeoutMs: TEST_READ_TIMEOUT_MS,
      turnTimeoutMs: TEST_TURN_TIMEOUT_MS,
    });

    try {
      await expect(client.startSession({ cwd: process.cwd() })).rejects.toMatchObject({
        code: "response_timeout",
      });
    } finally {
      client.stop();
    }
  });

  it("completes initialize + thread/start handshake and returns thread id", async () => {
    const serverPath = await writeMockServer(
      "basic",
      `
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    console.log(JSON.stringify({ id: msg.id, result: { protocolVersion: "test" } }));
    continue;
  }

  if (msg.method === "thread/start") {
    console.log(JSON.stringify({ id: msg.id, result: { thread: { id: "thread-abc" } } }));
  }
}
`,
    );

    const client = new CodexAppServerClient({
      command: `node ${serverPath}`,
      readTimeoutMs: 1000,
      turnTimeoutMs: 1000,
    });

    try {
      const session = await client.startSession({ cwd: process.cwd() });
      expect(session.threadId).toBe("thread-abc");
    } finally {
      client.stop();
    }
  });

  it("returns turn_input_required when protocol signals user input requirement", async () => {
    const serverPath = await writeMockServer(
      "input-required",
      `
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    console.log(JSON.stringify({ id: msg.id, result: { protocolVersion: "test" } }));
    continue;
  }
  if (msg.method === "thread/start") {
    console.log(JSON.stringify({ id: msg.id, result: { thread: { id: "thread-abc" } } }));
    continue;
  }

  if (msg.method === "turn/start") {
    console.log(JSON.stringify({ id: msg.id, result: { turn: { id: "turn-1" } } }));
    console.log(JSON.stringify({ method: "item/tool/requestUserInput", params: { reason: "confirm" } }));
  }
}
`,
    );

    const events: unknown[] = [];
    const client = new CodexAppServerClient({
      command: `node ${serverPath}`,
      readTimeoutMs: 1000,
      turnTimeoutMs: 1000,
    }, (event) => events.push(event));

    try {
      const session = await client.startSession({ cwd: process.cwd() });
      const result = await client.runTurn({
        threadId: session.threadId,
        cwd: process.cwd(),
        title: "ATH-1",
        prompt: "hello",
      });

      expect(result.outcome).toBe("turn_input_required");
      expect(events).toContainEqual(expect.objectContaining({ event: "turn_input_required" }));
    } finally {
      client.stop();
    }
  });

  it("auto-approves approval requests, rejects unsupported tools, and completes turn", async () => {
    const serverPath = await writeMockServer(
      "approval-and-tool-call",
      `
import readline from "node:readline";

let approvalHandled = false;
let toolHandled = false;
const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const msg = JSON.parse(line);

  if (msg.method === "initialize") {
    console.error("mock server stderr line");
    console.log(JSON.stringify({ id: msg.id, result: { protocolVersion: "test" } }));
    continue;
  }

  if (msg.method === "thread/start") {
    console.log(JSON.stringify({ id: msg.id, result: { thread: { id: "thread-tool" } } }));
    continue;
  }

  if (msg.method === "turn/start") {
    console.log(JSON.stringify({ id: msg.id, result: { turnId: "turn-tool-1" } }));
    console.log(JSON.stringify({ id: "approval-1", method: "approval/request", params: { action: "shell" } }));
    continue;
  }

  if (msg.id === "approval-1") {
    if (!msg.result || msg.result.approved !== true) {
      process.exitCode = 1;
      break;
    }
    approvalHandled = true;
    console.log(JSON.stringify({ id: "tool-1", method: "item/tool/call", params: { name: "unsupported" } }));
    continue;
  }

  if (msg.id === "tool-1") {
    if (!msg.result || msg.result.success !== false || msg.result.error !== "unsupported_tool_call") {
      process.exitCode = 1;
      break;
    }
    toolHandled = true;
  }

  if (approvalHandled && toolHandled) {
    console.log(JSON.stringify({
      method: "turn/completed",
      params: {
        usage: { input_tokens: 7, output_tokens: 4, total_tokens: 11 },
        rate_limits: { rpm: { remaining: 900 } }
      }
    }));
  }
}
`,
    );

    const events: unknown[] = [];
    const client = new CodexAppServerClient(
      {
        command: `node ${serverPath}`,
        readTimeoutMs: 1000,
        turnTimeoutMs: 1000,
      },
      (event) => events.push(event),
    );

    try {
      const session = await client.startSession({ cwd: process.cwd() });
      const turn = await client.runTurn({
        threadId: session.threadId,
        cwd: process.cwd(),
        title: "ATH-7",
        prompt: "run",
      });

      expect(turn.outcome).toBe("completed");
      expect(turn.usage).toEqual({ input_tokens: 7, output_tokens: 4, total_tokens: 11 });
      expect(events).toContainEqual(expect.objectContaining({ event: "approval_auto_approved" }));
      expect(events).toContainEqual(expect.objectContaining({ event: "unsupported_tool_call" }));
      expect(events).toContainEqual(expect.objectContaining({ event: "other_message", message: "mock server stderr line" }));
      expect(events).toContainEqual(
        expect.objectContaining({
          event: "turn_completed",
          usage: { input_tokens: 7, output_tokens: 4, total_tokens: 11 },
          rate_limits: { rpm: { remaining: 900 } },
        }),
      );
    } finally {
      client.stop();
    }
  });

  it("sends decision field for command execution approval requests", async () => {
    const serverPath = await writeMockServer(
      "command-exec-approval",
      `
import readline from "node:readline";

let approvalHandled = false;
const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const msg = JSON.parse(line);

  if (msg.method === "initialize") {
    console.log(JSON.stringify({ id: msg.id, result: { protocolVersion: "test" } }));
    continue;
  }

  if (msg.method === "thread/start") {
    console.log(JSON.stringify({ id: msg.id, result: { thread: { id: "thread-cmd" } } }));
    continue;
  }

  if (msg.method === "turn/start") {
    console.log(JSON.stringify({ id: msg.id, result: { turnId: "turn-cmd-1" } }));
    console.log(JSON.stringify({ id: "approval-cmd-1", method: "item/commandExecution/requestApproval", params: { command: "echo hi" } }));
    continue;
  }

  if (msg.id === "approval-cmd-1") {
    if (!msg.result || msg.result.decision !== "approved" || msg.result.approved !== true) {
      process.exitCode = 1;
      break;
    }
    approvalHandled = true;
  }

  if (approvalHandled) {
    console.log(JSON.stringify({
      method: "turn/completed",
      params: {
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      }
    }));
  }
}
`,
    );

    const client = new CodexAppServerClient({
      command: `node ${serverPath}`,
      readTimeoutMs: 1000,
      turnTimeoutMs: 1000,
    });

    try {
      const session = await client.startSession({ cwd: process.cwd() });
      const turn = await client.runTurn({
        threadId: session.threadId,
        cwd: process.cwd(),
        title: "ATH-8",
        prompt: "run",
      });

      expect(turn.outcome).toBe("completed");
      expect(turn.usage).toEqual({ input_tokens: 3, output_tokens: 2, total_tokens: 5 });
    } finally {
      client.stop();
    }
  });

  it("uses configurable initialize client metadata", async () => {
    const serverPath = await writeMockServer(
      "metadata",
      `
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    const clientInfo = msg.params?.clientInfo ?? {};
    const capabilities = msg.params?.capabilities ?? {};
    if (clientInfo.name !== "athena-symphony" || clientInfo.version !== "9.9.9" || capabilities.tools !== true) {
      console.log(JSON.stringify({ id: msg.id, error: { message: "bad client metadata" } }));
      continue;
    }

    console.log(JSON.stringify({ id: msg.id, result: { protocolVersion: "test" } }));
    continue;
  }

  if (msg.method === "thread/start") {
    console.log(JSON.stringify({ id: msg.id, result: { thread: { id: "thread-meta" } } }));
    continue;
  }
}
`,
    );

    const client = new CodexAppServerClient({
      command: `node ${serverPath}`,
      clientName: "athena-symphony",
      clientVersion: "9.9.9",
      clientCapabilities: {
        tools: true,
      },
      readTimeoutMs: 1000,
      turnTimeoutMs: 1000,
    });

    try {
      const session = await client.startSession({ cwd: process.cwd() });
      expect(session.threadId).toBe("thread-meta");
    } finally {
      client.stop();
    }
  });
});

async function writeMockServer(name: string, source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `symphony-codex-mock-${name}-`));
  const serverPath = join(dir, "mock-app-server.mjs");
  await writeFile(serverPath, source, "utf8");
  return serverPath;
}
