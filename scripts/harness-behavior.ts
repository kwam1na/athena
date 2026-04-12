import path from "node:path";
import { spawn as spawnChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

import { HARNESS_BEHAVIOR_SCENARIOS } from "./harness-behavior-scenarios";

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_HTTP_INTERVAL_MS = 250;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

type LineSource = "stdout" | "stderr";

export type HarnessBehaviorSignalSource = LineSource | "combined";

export type HarnessBehaviorLogger = Pick<Console, "log" | "error">;

export type HarnessBehaviorProcessDefinition = {
  id: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  readyPattern?: string | RegExp;
  readyTimeoutMs?: number;
};

export type HarnessBehaviorHttpReadinessCheck = {
  kind: "http";
  name: string;
  url: string;
  expectedStatus?: number;
  timeoutMs?: number;
  intervalMs?: number;
};

export type HarnessBehaviorLogReadinessCheck = {
  kind: "log";
  name: string;
  processId: string;
  pattern: string | RegExp;
  source?: HarnessBehaviorSignalSource;
  timeoutMs?: number;
};

export type HarnessBehaviorCustomReadinessCheck = {
  kind: "custom";
  name: string;
  check: (context: HarnessBehaviorReadinessContext) => Promise<void>;
};

export type HarnessBehaviorReadinessCheck =
  | HarnessBehaviorHttpReadinessCheck
  | HarnessBehaviorLogReadinessCheck
  | HarnessBehaviorCustomReadinessCheck;

export type HarnessBehaviorRuntimeSignalExpectation = {
  name: string;
  pattern: string | RegExp;
  processId?: string;
  source?: HarnessBehaviorSignalSource;
  minMatches?: number;
};

export type HarnessBehaviorRuntimeSignalResult = {
  name: string;
  processId: string | null;
  source: HarnessBehaviorSignalSource;
  pattern: RegExp;
  matchCount: number;
  matchedLines: string[];
};

export type HarnessBehaviorPlaywrightFlowOptions<TStepResult> = {
  url: string;
  headless?: boolean;
  recordVideo?: boolean;
  videoDir?: string;
  videoSize?: {
    width: number;
    height: number;
  };
  steps: (context: { page: HarnessBehaviorPlaywrightPage }) => Promise<TStepResult>;
};

export type HarnessBehaviorPlaywrightFlowResult<TStepResult> = {
  consoleMessages: string[];
  stepResult: TStepResult;
  videoPath?: string;
};

export type HarnessBehaviorProcessHandle = {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  getOutputLines: (source?: HarnessBehaviorSignalSource) => string[];
  waitForOutput: (
    pattern: string | RegExp,
    options?: { source?: HarnessBehaviorSignalSource; timeoutMs?: number }
  ) => Promise<void>;
};

export type HarnessBehaviorReadinessContext = {
  rootDir: string;
  scenarioName: string;
  logger: HarnessBehaviorLogger;
  processes: Record<string, HarnessBehaviorProcessHandle>;
};

export type HarnessBehaviorBrowserContext = HarnessBehaviorReadinessContext & {
  runPlaywrightFlow: <TStepResult>(
    options: HarnessBehaviorPlaywrightFlowOptions<TStepResult>
  ) => Promise<HarnessBehaviorPlaywrightFlowResult<TStepResult>>;
};

export type HarnessBehaviorAssertionContext<TBrowserResult> =
  HarnessBehaviorReadinessContext & {
    browserResult: TBrowserResult;
    runtimeSignals: Record<string, HarnessBehaviorRuntimeSignalResult>;
  };

export type HarnessBehaviorCleanupContext<TBrowserResult> =
  HarnessBehaviorAssertionContext<TBrowserResult>;

export type HarnessBehaviorScenario<TBrowserResult = unknown> = {
  name: string;
  description?: string;
  processes: HarnessBehaviorProcessDefinition[];
  readiness: HarnessBehaviorReadinessCheck[];
  browser: (
    context: HarnessBehaviorBrowserContext
  ) => Promise<TBrowserResult>;
  runtimeSignals?: HarnessBehaviorRuntimeSignalExpectation[];
  assert: (
    context: HarnessBehaviorAssertionContext<TBrowserResult>
  ) => Promise<void>;
  cleanup?: (
    context: HarnessBehaviorCleanupContext<TBrowserResult>
  ) => Promise<void>;
};

export type HarnessBehaviorPhase =
  | "boot"
  | "readiness"
  | "browser"
  | "runtime"
  | "assertion"
  | "cleanup";

export class HarnessBehaviorPhaseError extends Error {
  phase: HarnessBehaviorPhase;
  details: string;

  constructor(
    phase: HarnessBehaviorPhase,
    details: string,
    cause?: unknown
  ) {
    const formattedDetails = details.trim();
    super(
      `Harness behavior failed in ${phase} phase${
        formattedDetails ? `: ${formattedDetails}` : "."
      }`,
      cause ? { cause } : undefined
    );
    this.name = "HarnessBehaviorPhaseError";
    this.phase = phase;
    this.details = formattedDetails;
  }
}

type ProcessOutputLine = {
  source: LineSource;
  line: string;
};

type ProcessOutputWaiter = {
  pattern: RegExp;
  source: HarnessBehaviorSignalSource;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type RunningProcess = {
  handle: HarnessBehaviorProcessHandle;
  stop: () => Promise<void>;
};

type RunHarnessBehaviorOptions = {
  logger?: HarnessBehaviorLogger;
  fetchImpl?: typeof fetch;
  sleep?: (durationMs: number) => Promise<void>;
  runPlaywrightFlow?: <TStepResult>(
    options: HarnessBehaviorPlaywrightFlowOptions<TStepResult>
  ) => Promise<HarnessBehaviorPlaywrightFlowResult<TStepResult>>;
};

export type ParsedHarnessBehaviorArgs = {
  help: boolean;
  list: boolean;
  recordVideo: boolean;
  scenarioName: string | null;
};

function logPhase(
  logger: HarnessBehaviorLogger,
  phase: HarnessBehaviorPhase,
  message: string
) {
  logger.log(`[${phase}] ${message}`);
}

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function asRegExp(pattern: string | RegExp) {
  if (pattern instanceof RegExp) {
    return pattern;
  }

  return new RegExp(escapeRegExp(pattern));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getLinesForSource(
  outputLines: ProcessOutputLine[],
  source: HarnessBehaviorSignalSource
) {
  if (source === "combined") {
    return outputLines.map((entry) => entry.line);
  }

  return outputLines
    .filter((entry) => entry.source === source)
    .map((entry) => entry.line);
}

async function consumeLines(
  stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream | null | undefined,
  source: LineSource,
  onLine: (source: LineSource, line: string) => void
) {
  if (!stream) {
    return;
  }

  if ("getReader" in stream && typeof stream.getReader === "function") {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        onLine(source, rawLine.replace(/\r$/, ""));
        newlineIndex = buffer.indexOf("\n");
      }
    }

    const trailing = `${buffer}${decoder.decode()}`.replace(/\r$/, "");
    if (trailing) {
      onLine(source, trailing);
    }
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let buffer = "";

    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        onLine(source, rawLine.replace(/\r$/, ""));
        newlineIndex = buffer.indexOf("\n");
      }
    });

    stream.on("end", () => {
      const trailing = buffer.replace(/\r$/, "");
      if (trailing) {
        onLine(source, trailing);
      }
      resolve();
    });

    stream.on("error", reject);
  });
}

async function stopProcess(
  processRef: {
    kill: (signal?: string) => void;
    exited: Promise<number>;
  },
  timeoutMs: number
) {
  processRef.kill();

  const exitCode = await Promise.race([
    processRef.exited,
    sleep(timeoutMs).then(() => Number.NaN),
  ]);

  if (!Number.isNaN(exitCode)) {
    return;
  }

  processRef.kill("SIGKILL");
  await processRef.exited;
}

async function startProcess(
  rootDir: string,
  definition: HarnessBehaviorProcessDefinition,
  logger: HarnessBehaviorLogger
): Promise<RunningProcess> {
  const processCwd = definition.cwd
    ? path.resolve(rootDir, definition.cwd)
    : rootDir;
  const outputLines: ProcessOutputLine[] = [];
  const outputWaiters = new Set<ProcessOutputWaiter>();

  logPhase(logger, "boot", `starting ${definition.id}: ${definition.command}`);

  const subprocess = spawnCommand(definition.command, processCwd, definition.env);

  const maybeResolveWaiters = (source: LineSource, line: string) => {
    for (const waiter of [...outputWaiters]) {
      if (waiter.source !== "combined" && waiter.source !== source) {
        continue;
      }

      if (!waiter.pattern.test(line)) {
        continue;
      }

      clearTimeout(waiter.timeout);
      outputWaiters.delete(waiter);
      waiter.resolve();
    }
  };

  const appendOutputLine = (source: LineSource, line: string) => {
    outputLines.push({ source, line });
    maybeResolveWaiters(source, line);
  };

  const stdoutPump = consumeLines(subprocess.stdout, "stdout", appendOutputLine);
  const stderrPump = consumeLines(subprocess.stderr, "stderr", appendOutputLine);

  void Promise.all([stdoutPump, stderrPump]).catch((error: unknown) => {
    logger.error(
      `[boot] output capture failed for ${definition.id}: ${formatError(error)}`
    );
  });

  void subprocess.exited.then((exitCode) => {
    for (const waiter of [...outputWaiters]) {
      clearTimeout(waiter.timeout);
      outputWaiters.delete(waiter);
      waiter.reject(
        new Error(
          `Process "${definition.id}" exited (${exitCode}) before output match was observed.`
        )
      );
    }
  });

  const handle: HarnessBehaviorProcessHandle = {
    id: definition.id,
    command: definition.command,
    cwd: processCwd,
    pid: subprocess.pid,
    getOutputLines(source = "combined") {
      return getLinesForSource(outputLines, source);
    },
    waitForOutput(pattern, options = {}) {
      const source = options.source ?? "combined";
      const regex = asRegExp(pattern);

      if (getLinesForSource(outputLines, source).some((line) => regex.test(line))) {
        return Promise.resolve();
      }

      const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          outputWaiters.delete(waiter);
          reject(
            new Error(
              `Timed out waiting for ${source} output to match ${regex} from process "${definition.id}".`
            )
          );
        }, timeoutMs);

        const waiter: ProcessOutputWaiter = {
          pattern: regex,
          source,
          resolve,
          reject,
          timeout,
        };

        outputWaiters.add(waiter);
      });
    },
  };

  if (definition.readyPattern) {
    await handle.waitForOutput(definition.readyPattern, {
      timeoutMs: definition.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      source: "combined",
    });
    logPhase(
      logger,
      "boot",
      `${definition.id} emitted readiness pattern ${asRegExp(
        definition.readyPattern
      )}`
    );
  }

  let stopping = false;
  return {
    handle,
    stop: async () => {
      if (stopping) {
        return;
      }
      stopping = true;

      try {
        await stopProcess(subprocess, DEFAULT_STOP_TIMEOUT_MS);
      } catch (error) {
        throw new Error(
          `Failed to stop process "${definition.id}" (pid ${subprocess.pid}): ${formatError(
            error
          )}`
        );
      }
    },
  };
}

function spawnCommand(
  command: string,
  cwd: string,
  envOverrides: Record<string, string> | undefined
) {
  const shellPath = resolveHarnessBehaviorShell({
    env: process.env,
  });
  const runtime = (globalThis as { Bun?: typeof Bun }).Bun;
  const mergedEnv = {
    ...process.env,
    ...envOverrides,
  };

  if (runtime) {
    const bunSubprocess = runtime.spawn([shellPath, "-lc", command], {
      cwd,
      env: mergedEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      pid: bunSubprocess.pid,
      stdout: bunSubprocess.stdout,
      stderr: bunSubprocess.stderr,
      kill: (signal?: string) => {
        bunSubprocess.kill(signal);
      },
      exited: bunSubprocess.exited,
    };
  }

  const nodeSubprocess = spawnChildProcess(shellPath, ["-lc", command], {
    cwd,
    env: mergedEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    pid: nodeSubprocess.pid ?? -1,
    stdout: nodeSubprocess.stdout,
    stderr: nodeSubprocess.stderr,
    kill: (signal?: string) => {
      nodeSubprocess.kill(signal as NodeJS.Signals | undefined);
    },
    exited: new Promise<number>((resolve) => {
      nodeSubprocess.once("close", (code) => {
        resolve(code ?? 0);
      });
    }),
  };
}

export function resolveHarnessBehaviorShell(options: {
  env?: NodeJS.ProcessEnv;
  fileExists?: (filePath: string) => boolean;
} = {}) {
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? existsSync;
  const candidates = [
    env.HARNESS_BEHAVIOR_SHELL,
    env.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return "/bin/sh";
}

async function runHttpReadinessCheck(
  check: HarnessBehaviorHttpReadinessCheck,
  fetchImpl: typeof fetch,
  sleepImpl: (durationMs: number) => Promise<void>
) {
  const timeoutMs = check.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const intervalMs = check.intervalMs ?? DEFAULT_HTTP_INTERVAL_MS;
  const expectedStatus = check.expectedStatus ?? 200;
  const startedAt = Date.now();
  let lastError: string | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchImpl(check.url);
      if (response.status === expectedStatus) {
        return;
      }
      lastError = `received status ${response.status}`;
    } catch (error) {
      lastError = formatError(error);
    }

    await sleepImpl(intervalMs);
  }

  throw new Error(
    `Timed out waiting for ${check.url} (expected status ${expectedStatus}). Last observation: ${
      lastError ?? "no response"
    }.`
  );
}

function collectRuntimeSignalMatches(
  expectations: HarnessBehaviorRuntimeSignalExpectation[],
  processes: Record<string, HarnessBehaviorProcessHandle>
) {
  const results: Record<string, HarnessBehaviorRuntimeSignalResult> = {};

  for (const expectation of expectations) {
    const source = expectation.source ?? "combined";
    const regex = asRegExp(expectation.pattern);
    const processIds = expectation.processId
      ? [expectation.processId]
      : Object.keys(processes);

    if (processIds.length === 0) {
      throw new Error(
        `Runtime signal "${expectation.name}" cannot be evaluated because no processes are running.`
      );
    }

    const matchedLines: string[] = [];
    for (const processId of processIds) {
      const processHandle = processes[processId];
      if (!processHandle) {
        throw new Error(
          `Runtime signal "${expectation.name}" references unknown process "${processId}".`
        );
      }

      const processMatches = processHandle
        .getOutputLines(source)
        .filter((line) => regex.test(line));
      matchedLines.push(...processMatches);
    }

    const minMatches = expectation.minMatches ?? 1;
    if (matchedLines.length < minMatches) {
      throw new Error(
        `Runtime signal "${expectation.name}" expected at least ${minMatches} match(es) for ${regex}, found ${matchedLines.length}.`
      );
    }

    results[expectation.name] = {
      name: expectation.name,
      processId: expectation.processId ?? null,
      source,
      pattern: regex,
      matchCount: matchedLines.length,
      matchedLines,
    };
  }

  return results;
}

type HarnessBehaviorPlaywrightBrowser = {
  close: () => Promise<void>;
  newContext: (options?: {
    recordVideo?: {
      dir: string;
      size?: {
        width: number;
        height: number;
      };
    };
  }) => Promise<HarnessBehaviorPlaywrightContext>;
};

type HarnessBehaviorPlaywrightContext = {
  close: () => Promise<void>;
  newPage: () => Promise<HarnessBehaviorPlaywrightPage>;
};

export type HarnessBehaviorPlaywrightPage = {
  goto: (
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number }
  ) => Promise<unknown>;
  on: (event: "console", handler: (message: { text: () => string }) => void) => void;
  getByRole: (
    role: string,
    options: { name: string | RegExp }
  ) => { click: (options?: { timeout?: number }) => Promise<void> };
  waitForSelector: (
    selector: string,
    options?: { timeout?: number }
  ) => Promise<unknown>;
  textContent: (selector: string) => Promise<string | null>;
  video: () =>
    | {
        path: () => Promise<string>;
      }
    | null;
};

type HarnessBehaviorPlaywrightModule = {
  chromium: {
    launch: (options?: { headless?: boolean }) => Promise<HarnessBehaviorPlaywrightBrowser>;
  };
};

export async function runPlaywrightFlow<TStepResult>(
  options: HarnessBehaviorPlaywrightFlowOptions<TStepResult>
) {
  let browser: HarnessBehaviorPlaywrightBrowser | null = null;
  let browserContext: HarnessBehaviorPlaywrightContext | null = null;
  let page: HarnessBehaviorPlaywrightPage | null = null;
  let recordedVideo:
    | {
        path: () => Promise<string>;
      }
    | null = null;
  let videoPath: string | undefined;
  let hasStepResult = false;
  let stepResult!: TStepResult;
  const consoleMessages: string[] = [];
  let flowError: unknown = null;

  try {
    const playwright = (await import(
      "@playwright/test"
    )) as unknown as HarnessBehaviorPlaywrightModule;

    let contextRecordVideoOptions:
      | {
          dir: string;
          size?: {
            width: number;
            height: number;
          };
        }
      | undefined;

    if (options.recordVideo) {
      const defaultVideoDir = path.join(
        process.cwd(),
        "artifacts",
        "harness-behavior",
        "videos"
      );
      const videoDir = options.videoDir ?? defaultVideoDir;
      await mkdir(videoDir, { recursive: true });
      contextRecordVideoOptions = {
        dir: videoDir,
        size: options.videoSize,
      };
    }

    browser = await playwright.chromium.launch({
      headless: options.headless ?? true,
    });
    browserContext = await browser.newContext({
      recordVideo: contextRecordVideoOptions,
    });
    page = await browserContext.newPage();
    recordedVideo = options.recordVideo ? page.video() : null;
    page.on("console", (message) => {
      consoleMessages.push(message.text());
    });
    await page.goto(options.url, {
      waitUntil: "networkidle",
    });

    stepResult = await options.steps({ page });
    hasStepResult = true;
  } catch (error) {
    flowError = error;
  } finally {
    if (browserContext) {
      await browserContext.close();
    }
    if (browser) {
      await browser.close();
    }

    // Playwright only finalizes video files after the browser context closes.
    if (recordedVideo) {
      try {
        videoPath = await recordedVideo.path();
      } catch (videoError) {
        flowError ??= new Error(
          `Video capture finalization failed: ${formatError(videoError)}`
        );
      }
    }
  }
  if (flowError) {
    throw new Error(
      `Playwright browser flow failed: ${formatError(flowError)}`
    );
  }

  if (!hasStepResult) {
    throw new Error(
      "Playwright browser flow failed: scenario steps did not produce a result."
    );
  }

  return {
    consoleMessages,
    stepResult,
    videoPath,
  } satisfies HarnessBehaviorPlaywrightFlowResult<TStepResult>;
}

function wrapPhaseError(
  phase: HarnessBehaviorPhase,
  error: unknown
): HarnessBehaviorPhaseError {
  if (error instanceof HarnessBehaviorPhaseError) {
    return error;
  }

  return new HarnessBehaviorPhaseError(phase, formatError(error), error);
}

export async function runHarnessBehaviorScenario<TBrowserResult>(
  rootDir: string,
  scenario: HarnessBehaviorScenario<TBrowserResult>,
  options: RunHarnessBehaviorOptions = {}
) {
  const logger = options.logger ?? console;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleep ?? sleep;
  const runPlaywrightImpl = options.runPlaywrightFlow ?? runPlaywrightFlow;
  const runningProcesses = new Map<string, RunningProcess>();
  let browserResult: TBrowserResult | undefined;
  let runtimeSignals: Record<string, HarnessBehaviorRuntimeSignalResult> = {};
  let pendingError: HarnessBehaviorPhaseError | null = null;
  let currentPhase: HarnessBehaviorPhase = "boot";

  const processHandles = () =>
    Object.fromEntries(
      [...runningProcesses.entries()].map(([processId, runningProcess]) => [
        processId,
        runningProcess.handle,
      ])
    ) satisfies Record<string, HarnessBehaviorProcessHandle>;

  const baseContext = () =>
    ({
      rootDir,
      scenarioName: scenario.name,
      logger,
      processes: processHandles(),
    }) satisfies HarnessBehaviorReadinessContext;

  logger.log(`[harness:behavior] Scenario: ${scenario.name}`);
  if (scenario.description) {
    logger.log(`[harness:behavior] ${scenario.description}`);
  }

  try {
    currentPhase = "boot";
    logPhase(logger, "boot", "booting scenario processes");
    for (const processDefinition of scenario.processes) {
      const runningProcess = await startProcess(rootDir, processDefinition, logger);
      runningProcesses.set(processDefinition.id, runningProcess);
    }

    currentPhase = "readiness";
    logPhase(logger, "readiness", "running readiness checks");
    for (const check of scenario.readiness) {
      if (check.kind === "http") {
        logPhase(
          logger,
          "readiness",
          `check "${check.name}" -> ${check.url} (expect ${check.expectedStatus ?? 200})`
        );
        await runHttpReadinessCheck(check, fetchImpl, sleepImpl);
        continue;
      }

      if (check.kind === "log") {
        const processHandle = processHandles()[check.processId];
        if (!processHandle) {
          throw new Error(
            `Readiness check "${check.name}" references unknown process "${check.processId}".`
          );
        }
        logPhase(
          logger,
          "readiness",
          `check "${check.name}" waiting for ${check.processId} output`
        );
        await processHandle.waitForOutput(check.pattern, {
          source: check.source ?? "combined",
          timeoutMs: check.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
        });
        continue;
      }

      logPhase(logger, "readiness", `check "${check.name}" (custom)`);
      await check.check(baseContext());
    }

    currentPhase = "browser";
    logPhase(logger, "browser", "running browser flow");
    browserResult = await scenario.browser({
      ...baseContext(),
      runPlaywrightFlow: runPlaywrightImpl,
    });

    currentPhase = "runtime";
    logPhase(logger, "runtime", "collecting runtime signals");
    runtimeSignals = collectRuntimeSignalMatches(
      scenario.runtimeSignals ?? [],
      processHandles()
    );

    for (const runtimeSignal of Object.values(runtimeSignals)) {
      logPhase(
        logger,
        "runtime",
        `${runtimeSignal.name}: matched ${runtimeSignal.matchCount} line(s)`
      );
    }

    currentPhase = "assertion";
    logPhase(logger, "assertion", "running scenario assertions");
    await scenario.assert({
      ...baseContext(),
      browserResult: browserResult as TBrowserResult,
      runtimeSignals,
    });
  } catch (error) {
    pendingError = wrapPhaseError(currentPhase, error);
  } finally {
    try {
      currentPhase = "cleanup";
      logPhase(logger, "cleanup", "tearing down scenario resources");

      if (scenario.cleanup && browserResult !== undefined) {
        await scenario.cleanup({
          ...baseContext(),
          browserResult,
          runtimeSignals,
        });
      } else if (scenario.cleanup) {
        await scenario.cleanup({
          ...baseContext(),
          browserResult: undefined as TBrowserResult,
          runtimeSignals,
        });
      }

      for (const runningProcess of [...runningProcesses.values()].reverse()) {
        await runningProcess.stop();
      }
    } catch (cleanupError) {
      const wrappedCleanupError = wrapPhaseError("cleanup", cleanupError);
      if (pendingError) {
        logger.error(
          `[cleanup] additional cleanup failure: ${wrappedCleanupError.details}`
        );
      } else {
        pendingError = wrappedCleanupError;
      }
    }
  }

  if (pendingError) {
    throw pendingError;
  }

  logger.log(`[harness:behavior] Scenario ${scenario.name} passed.`);
}

export function parseHarnessBehaviorArgs(
  args: string[]
): ParsedHarnessBehaviorArgs {
  let scenarioName: string | null = null;
  let list = false;
  let help = false;
  let recordVideo = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--list") {
      list = true;
      continue;
    }

    if (arg === "--record-video") {
      recordVideo = true;
      continue;
    }

    if (arg.startsWith("--record-video=")) {
      const rawValue = arg.split("=", 2)[1];
      if (rawValue === "true" || rawValue === "1") {
        recordVideo = true;
        continue;
      }

      if (rawValue === "false" || rawValue === "0") {
        recordVideo = false;
        continue;
      }

      throw new Error(
        `Invalid value for --record-video: "${rawValue}". Expected true, false, 1, or 0.`
      );
    }

    if (arg === "--scenario") {
      const nextValue = args[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing scenario name after --scenario.");
      }
      scenarioName = nextValue;
      index += 1;
      continue;
    }

    if (arg.startsWith("--scenario=")) {
      scenarioName = arg.split("=", 2)[1] ?? null;
      if (!scenarioName) {
        throw new Error("Missing scenario name after --scenario=.");
      }
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    help,
    list,
    recordVideo,
    scenarioName,
  };
}

function printHarnessBehaviorUsage(logger: HarnessBehaviorLogger) {
  logger.log("Usage:");
  logger.log("  bun run harness:behavior --scenario <name>");
  logger.log("  bun run harness:behavior --scenario <name> --record-video");
  logger.log("  bun run harness:behavior --list");
  logger.log("  bun run harness:behavior --help");
}

export async function runHarnessBehaviorCli(
  rootDir: string,
  args: string[],
  options: Omit<RunHarnessBehaviorOptions, "logger"> & {
    logger?: HarnessBehaviorLogger;
    scenarios?: HarnessBehaviorScenario[];
  } = {}
) {
  const logger = options.logger ?? console;
  const scenarios = options.scenarios ?? HARNESS_BEHAVIOR_SCENARIOS;
  const parsedArgs = parseHarnessBehaviorArgs(args);

  if (parsedArgs.help) {
    printHarnessBehaviorUsage(logger);
    return;
  }

  if (parsedArgs.list) {
    logger.log("Available harness behavior scenarios:");
    for (const scenario of scenarios) {
      const suffix = scenario.description ? ` - ${scenario.description}` : "";
      logger.log(`- ${scenario.name}${suffix}`);
    }
    return;
  }

  if (!parsedArgs.scenarioName) {
    throw new Error("Missing required argument: --scenario <name>.");
  }

  const selectedScenario = scenarios.find(
    (scenario) => scenario.name === parsedArgs.scenarioName
  );

  if (!selectedScenario) {
    throw new Error(
      `Unknown scenario "${parsedArgs.scenarioName}". Run with --list to inspect available scenarios.`
    );
  }

  const baseRunPlaywrightFlow = options.runPlaywrightFlow ?? runPlaywrightFlow;
  let runPlaywrightFlowOverride = options.runPlaywrightFlow;

  if (parsedArgs.recordVideo) {
    const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
    const videoDir = path.join(
      rootDir,
      "artifacts",
      "harness-behavior",
      "videos",
      selectedScenario.name,
      runStamp
    );

    logger.log(
      `[harness:behavior] Video capture enabled -> ${path.relative(
        rootDir,
        videoDir
      )}`
    );

    runPlaywrightFlowOverride = async <TStepResult>(
      playwrightOptions: HarnessBehaviorPlaywrightFlowOptions<TStepResult>
    ) => {
      const flowResult = await baseRunPlaywrightFlow({
        ...playwrightOptions,
        recordVideo: true,
        videoDir,
      });

      if (flowResult.videoPath) {
        logPhase(
          logger,
          "browser",
          `video artifact captured at ${flowResult.videoPath}`
        );
      }

      return flowResult;
    };
  }

  await runHarnessBehaviorScenario(rootDir, selectedScenario, {
    logger,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    runPlaywrightFlow: runPlaywrightFlowOverride,
  });
}

if (import.meta.main) {
  runHarnessBehaviorCli(process.cwd(), Bun.argv.slice(2)).catch(
    (error: unknown) => {
      if (error instanceof HarnessBehaviorPhaseError) {
        console.error(
          `[harness:behavior] Failed in ${error.phase} phase: ${error.details}`
        );
      } else {
        console.error(`[harness:behavior] ${formatError(error)}`);
      }
      process.exit(1);
    }
  );
}
