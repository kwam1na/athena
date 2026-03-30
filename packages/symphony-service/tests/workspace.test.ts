import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SymphonyError } from "../src/errors";
import {
  ensureWorkspaceForIssue,
  resolveWorkspaceLocation,
  runAfterRunHook,
  runBeforeRunHook,
  sanitizeWorkspaceKey,
} from "../src/workspace";

describe("workspace keys", () => {
  it("sanitizes issue identifiers to safe directory names", () => {
    expect(sanitizeWorkspaceKey("ATH-12/../bad issue")).toBe("ATH-12_.._bad_issue");
    expect(sanitizeWorkspaceKey("ATH:1?*<>")).toBe("ATH_1____");
  });

  it("resolves paths under workspace root", () => {
    const location = resolveWorkspaceLocation("/tmp/symphony-root", "../ATH-1");
    expect(location.path.startsWith(`${location.root}/`)).toBe(true);
    expect(location.path).toBe("/tmp/symphony-root/.._ATH-1");
  });
});

describe("workspace lifecycle", () => {
  it("creates workspace once and marks reuse correctly", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-workspace-"));
    const first = await ensureWorkspaceForIssue(
      {
        root,
        hooks: { timeoutMs: 1000 },
      },
      "ATH-100",
    );
    const second = await ensureWorkspaceForIssue(
      {
        root,
        hooks: { timeoutMs: 1000 },
      },
      "ATH-100",
    );

    expect(first.createdNow).toBe(true);
    expect(second.createdNow).toBe(false);
    expect(second.path).toBe(first.path);
  });

  it("runs after_create only for newly created workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-workspace-hook-"));
    const marker = join(root, "marker.txt");

    const hook = `echo created > ${JSON.stringify(marker)}`;
    await ensureWorkspaceForIssue(
      {
        root,
        hooks: {
          timeoutMs: 2000,
          afterCreate: hook,
        },
      },
      "ATH-101",
    );

    await writeFile(marker, "mutated", "utf8");

    await ensureWorkspaceForIssue(
      {
        root,
        hooks: {
          timeoutMs: 2000,
          afterCreate: hook,
        },
      },
      "ATH-101",
    );

    const current = await readFile(marker, "utf8");
    expect(current.trim()).toBe("mutated");
  });

  it("treats after_create failure as fatal", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-workspace-after-create-fail-"));

    await expect(
      ensureWorkspaceForIssue(
        {
          root,
          hooks: {
            timeoutMs: 2000,
            afterCreate: "exit 17",
          },
        },
        "ATH-102",
      ),
    ).rejects.toMatchObject({
      code: "hook_failed",
    });
  });

  it("treats before_run failure as fatal", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-workspace-before-run-fail-"));
    const workspace = resolve(root, "ATH-103");
    await mkdir(workspace, { recursive: true });

    await expect(
      runBeforeRunHook(
        {
          root,
          hooks: {
            timeoutMs: 2000,
            beforeRun: "exit 9",
          },
        },
        workspace,
      ),
    ).rejects.toMatchObject({
      code: "hook_failed",
    });
  });

  it("ignores after_run failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-workspace-after-run-fail-"));
    const workspace = resolve(root, "ATH-104");
    await mkdir(workspace, { recursive: true });

    await expect(
      runAfterRunHook(
        {
          root,
          hooks: {
            timeoutMs: 2000,
            afterRun: "exit 23",
          },
        },
        workspace,
      ),
    ).resolves.toBeUndefined();
  });

  it("times out hook scripts", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-workspace-timeout-"));
    const workspace = resolve(root, "ATH-105");
    await mkdir(workspace, { recursive: true });

    await expect(
      runBeforeRunHook(
        {
          root,
          hooks: {
            timeoutMs: 10,
            beforeRun: "sleep 1",
          },
        },
        workspace,
      ),
    ).rejects.toMatchObject({
      code: "hook_timeout",
    });
  });

  it("rejects running hooks outside workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-workspace-path-safety-"));

    await expect(
      runBeforeRunHook(
        {
          root,
          hooks: {
            timeoutMs: 2000,
            beforeRun: "echo ok",
          },
        },
        "/tmp/outside-root",
      ),
    ).rejects.toMatchObject({
      code: "invalid_workspace_path",
    });
  });
});
