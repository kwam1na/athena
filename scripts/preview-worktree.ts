#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import {
  mkdir,
  readFile,
  realpath,
  rmdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export type PreviewRecord = {
  command: string[];
  logPath: string;
  packageDir: string;
  pid: number;
  port: number;
  startedAt: string;
  url: string;
  worktreeRoot: string;
};

export type StartedPreview = PreviewRecord & {
  reused: boolean;
};

export type PreviewOptions = {
  command?: string[];
  maxActive?: number;
  packageDir?: string;
  portEnd?: number;
  portStart?: number;
  stateDir?: string;
  worktreeRoot?: string;
};

type PreviewState = {
  previews: PreviewRecord[];
};

const DEFAULT_PORT_START = 5701;
const DEFAULT_PORT_END = 5799;
const DEFAULT_MAX_ACTIVE = 6;
const DEFAULT_PACKAGE_DIR = "packages/athena-webapp";
const STATE_FILE_NAME = "previews.json";

function defaultCommand(port: number) {
  return [
    "bun",
    "run",
    "--filter",
    "@athena/webapp",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ];
}

async function resolveWorktreeRoot(options: PreviewOptions) {
  return realpath(options.worktreeRoot ?? process.cwd());
}

function resolveStateDir(options: PreviewOptions, worktreeRoot: string) {
  return path.resolve(
    options.stateDir ??
      process.env.ATHENA_PREVIEW_STATE_DIR ??
      path.join(worktreeRoot, ".athena-preview")
  );
}

function statePath(stateDir: string) {
  return path.join(stateDir, STATE_FILE_NAME);
}

async function readState(stateDir: string): Promise<PreviewState> {
  try {
    return JSON.parse(await readFile(statePath(stateDir), "utf8"));
  } catch {
    return { previews: [] };
  }
}

async function writeState(stateDir: string, state: PreviewState) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(statePath(stateDir), `${JSON.stringify(state, null, 2)}\n`);
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isReachable(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(750) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitForReachable(url: string) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok || response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(250);
  }

  throw new Error(`Preview server did not become reachable at ${url}: ${lastError}`);
}

async function pruneState(stateDir: string, state: PreviewState) {
  const active: PreviewRecord[] = [];

  for (const preview of state.previews) {
    if (isProcessAlive(preview.pid) && (await isReachable(preview.url))) {
      active.push(preview);
    }
  }

  if (active.length !== state.previews.length) {
    await writeState(stateDir, { previews: active });
  }

  return active;
}

async function withLock<T>(stateDir: string, callback: () => Promise<T>): Promise<T> {
  const lockDir = path.join(stateDir, ".lock");
  await mkdir(stateDir, { recursive: true });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await mkdir(lockDir);
      try {
        return await callback();
      } finally {
        await rmdir(lockDir).catch(() => undefined);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      await Bun.sleep(50);
    }
  }

  throw new Error(`Timed out waiting for preview state lock at ${lockDir}`);
}

async function findPort(portStart: number, portEnd: number, active: PreviewRecord[]) {
  const usedPorts = new Set(active.map((preview) => preview.port));

  for (let port = portStart; port <= portEnd; port += 1) {
    if (usedPorts.has(port)) continue;

    try {
      const server = Bun.serve({
        fetch: () => new Response("ok"),
        hostname: "127.0.0.1",
        port,
      });
      server.stop(true);
      return port;
    } catch {
      continue;
    }
  }

  throw new Error(`No free preview ports in ${portStart}-${portEnd}`);
}

function commandForPort(options: PreviewOptions, port: number) {
  const command = options.command ?? defaultCommand(port);
  return command.map((part) => part.replaceAll("{port}", String(port)));
}

function logPathFor(stateDir: string, worktreeRoot: string) {
  const slug = worktreeRoot.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return path.join(stateDir, `${slug || "preview"}.log`);
}

export async function startPreview(options: PreviewOptions = {}): Promise<StartedPreview> {
  const worktreeRoot = await resolveWorktreeRoot(options);
  const stateDir = resolveStateDir(options, worktreeRoot);
  const portStart = options.portStart ?? Number(process.env.ATHENA_PREVIEW_PORT_START ?? DEFAULT_PORT_START);
  const portEnd = options.portEnd ?? Number(process.env.ATHENA_PREVIEW_PORT_END ?? DEFAULT_PORT_END);
  const maxActive = options.maxActive ?? Number(process.env.ATHENA_PREVIEW_MAX_ACTIVE ?? DEFAULT_MAX_ACTIVE);
  const packageDir = options.packageDir ?? DEFAULT_PACKAGE_DIR;

  return withLock(stateDir, async () => {
    const state = await readState(stateDir);
    const active = await pruneState(stateDir, state);
    const existing = active.find((preview) => preview.worktreeRoot === worktreeRoot);

    if (existing) {
      return { ...existing, reused: true };
    }

    if (active.length >= maxActive) {
      throw new Error(
        `Active preview limit reached (${maxActive}). Stop an existing preview before starting another.`
      );
    }

    const port = await findPort(portStart, portEnd, active);
    const command = commandForPort(options, port);
    const url = `http://127.0.0.1:${port}/`;
    const logPath = logPathFor(stateDir, worktreeRoot);
    const cwd = path.join(worktreeRoot, packageDir);
    const logFd = openSync(logPath, "a");
    const child = spawn(command[0], command.slice(1), {
      cwd,
      detached: true,
      env: {
        ...process.env,
        HARNESS_BEHAVIOR_PORT: String(port),
        PORT: String(port),
      },
      stdio: ["ignore", logFd, logFd],
    });

    child.unref();

    const preview: PreviewRecord = {
      command,
      logPath,
      packageDir,
      pid: child.pid ?? 0,
      port,
      startedAt: new Date().toISOString(),
      url,
      worktreeRoot,
    };

    await writeState(stateDir, { previews: [...active, preview] });

    try {
      await waitForReachable(url);
    } catch (error) {
      if (preview.pid) {
        process.kill(-preview.pid, "SIGTERM");
      }
      await writeState(stateDir, { previews: active });
      throw error;
    }

    return { ...preview, reused: false };
  });
}

export async function listPreviews(options: Pick<PreviewOptions, "stateDir" | "worktreeRoot"> = {}) {
  const worktreeRoot = await resolveWorktreeRoot(options);
  const stateDir = resolveStateDir(options, worktreeRoot);
  const state = await readState(stateDir);
  return pruneState(stateDir, state);
}

export async function stopPreview(options: PreviewOptions = {}) {
  const worktreeRoot = await resolveWorktreeRoot(options);
  const stateDir = resolveStateDir(options, worktreeRoot);

  return withLock(stateDir, async () => {
    const state = await readState(stateDir);
    const active = await pruneState(stateDir, state);
    const preview = active.find((record) => record.worktreeRoot === worktreeRoot);

    if (!preview) return false;

    if (isProcessAlive(preview.pid)) {
      try {
        process.kill(-preview.pid, "SIGTERM");
      } catch {
        process.kill(preview.pid, "SIGTERM");
      }
    }

    await writeState(stateDir, {
      previews: active.filter((record) => record.worktreeRoot !== worktreeRoot),
    });

    return true;
  });
}

export function optionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): PreviewOptions {
  const command = env.ATHENA_PREVIEW_COMMAND_JSON
    ? JSON.parse(env.ATHENA_PREVIEW_COMMAND_JSON)
    : undefined;

  return {
    command,
    maxActive: env.ATHENA_PREVIEW_MAX_ACTIVE
      ? Number(env.ATHENA_PREVIEW_MAX_ACTIVE)
      : undefined,
    portEnd: env.ATHENA_PREVIEW_PORT_END
      ? Number(env.ATHENA_PREVIEW_PORT_END)
      : undefined,
    portStart: env.ATHENA_PREVIEW_PORT_START
      ? Number(env.ATHENA_PREVIEW_PORT_START)
      : undefined,
    stateDir: env.ATHENA_PREVIEW_STATE_DIR,
    worktreeRoot: cwd,
  };
}

export async function runPreviewCli(
  argv = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  writeLine: (line: string) => void = console.log
) {
  const command = argv[0] ?? "start";
  const target = argv[1] ?? "athena";

  if (target !== "athena") {
    throw new Error(`Unsupported preview target "${target}". Expected "athena".`);
  }

  if (command === "start") {
    const preview = await startPreview(optionsFromEnv(env, cwd));
    writeLine(preview.url);
    return;
  }

  if (command === "list") {
    const previews = await listPreviews(optionsFromEnv(env, cwd));
    for (const preview of previews) {
      writeLine(`${preview.url} ${preview.worktreeRoot} pid=${preview.pid}`);
    }
    return;
  }

  if (command === "stop") {
    const stopped = await stopPreview(optionsFromEnv(env, cwd));
    writeLine(stopped ? "Stopped preview." : "No preview running for this worktree.");
    return;
  }

  throw new Error("Usage: bun scripts/preview-worktree.ts [start|list|stop] athena");
}

if (import.meta.main) {
  runPreviewCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
