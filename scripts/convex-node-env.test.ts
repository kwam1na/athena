import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function withTempDir<T>(callback: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(tmpdir(), "athena-convex-node-"));

  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeNodeShim(dir: string, name: string, version: string) {
  const filePath = path.join(dir, name);
  await writeFile(
    filePath,
    `#!/bin/sh\nprintf '%s\\n' '${version}'\n`,
    { mode: 0o755 }
  );
  return filePath;
}

function resolveWithEnv(env: Record<string, string>) {
  return Bun.spawnSync(
    [
      "bash",
      "-lc",
      "source scripts/convex-node-env.sh && resolve_convex_node_bin",
    ],
    {
      cwd: path.join(import.meta.dirname, ".."),
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.startsWith("NODE"))
        ),
        ATHENA_CONVEX_NODE_BIN: "",
        ...env,
      },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
}

describe("resolve_convex_node_bin", () => {
  it("prefers ATHENA_CONVEX_NODE_BIN when it points to a supported Node release", async () => {
    await withTempDir(async (dir) => {
      const supportedNode = await writeNodeShim(dir, "node24", "v24.14.0");
      await writeNodeShim(dir, "node", "v23.5.0");

      const result = resolveWithEnv({
        ATHENA_CONVEX_NODE_BIN: supportedNode,
        HOME: path.join(dir, "home"),
        PATH: `${dir}:${process.env.PATH ?? ""}`,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe(supportedNode);
      expect(result.stderr.toString()).toBe("");
    });
  });

  it("rejects unsupported Node releases with a clear diagnostic", async () => {
    await withTempDir(async (dir) => {
      await writeNodeShim(dir, "node", "v23.5.0");

      const result = resolveWithEnv({
        HOME: path.join(dir, "home"),
        PATH: dir,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(
        "Convex deploy requires Node.js 18, 20, 22, or 24"
      );
      expect(result.stderr.toString()).toContain("v23.5.0");
    });
  });
});
