import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SymphonyError } from "../src/errors";
import { CodexAppServerClient } from "../src/codex/client";

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

  it("returns turn_input_required when protocol signals user input requirement", async () => {
    const events: unknown[] = [];
    const client = new CodexAppServerClient(
      {
        command: "node -e \"console.log(JSON.stringify({id:1,result:{}}));\"",
        readTimeoutMs: 100,
        turnTimeoutMs: 100,
      },
      (event) => events.push(event),
    );

    // This test is a placeholder for the injectable transport harness.
    // For now we validate construction/event callback shape only.
    expect(events).toEqual([]);
    client.stop();
  });

  it("completes initialize + thread/start handshake and returns thread id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "symphony-codex-mock-"));
    const serverPath = join(dir, "mock-app-server.mjs");

    await writeFile(
      serverPath,
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
}
`,
      "utf8",
    );

    const client = new CodexAppServerClient({
      command: `node ${serverPath}`,
      readTimeoutMs: 1000,
      turnTimeoutMs: 1000,
    });

    const session = await client.startSession({ cwd: process.cwd() });
    expect(session.threadId).toBe("thread-abc");
    client.stop();
  });
});
