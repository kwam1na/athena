import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { resolve } from "node:path";
import { SymphonyError } from "../errors";
import {
  createInitializeRequest,
  createInitializedNotification,
  createThreadStartRequest,
  createTurnStartRequest,
  extractRateLimits,
  extractThreadId,
  extractTurnId,
  extractUsage,
  getMethodName,
  getTurnTerminalState,
  isApprovalRequest,
  isUnsupportedToolCallRequest,
  isUserInputRequired,
  parseProtocolLine,
  type JsonRpcMessage,
} from "./protocol";

export type TurnOutcome = "completed" | "failed" | "cancelled" | "turn_timeout" | "port_exit" | "turn_input_required";

export interface CodexAppServerConfig {
  command: string;
  clientName?: string;
  clientVersion?: string;
  clientCapabilities?: Record<string, unknown>;
  approvalPolicy?: unknown;
  threadSandbox?: unknown;
  turnSandboxPolicy?: unknown;
  readTimeoutMs: number;
  turnTimeoutMs: number;
}

export interface CodexRuntimeEvent {
  event:
    | "session_started"
    | "startup_failed"
    | "turn_completed"
    | "turn_failed"
    | "turn_cancelled"
    | "turn_ended_with_error"
    | "turn_input_required"
    | "approval_auto_approved"
    | "unsupported_tool_call"
    | "notification"
    | "other_message"
    | "malformed";
  timestamp: string;
  codex_app_server_pid?: number;
  usage?: Record<string, number>;
  rate_limits?: Record<string, unknown>;
  message?: string;
  payload?: unknown;
  session_id?: string;
}

interface PendingRequest {
  resolve: (message: JsonRpcMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingTurn {
  resolve: (outcome: TurnOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CodexAppServerClient {
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutLineReader: ReadlineInterface | null = null;
  private nextRequestId = 1;
  private initialized = false;
  private pendingTurn: PendingTurn | null = null;

  constructor(
    private readonly config: CodexAppServerConfig,
    private readonly onEvent?: (event: CodexRuntimeEvent) => void,
  ) {}

  async startSession(input: { cwd: string }): Promise<{ threadId: string }> {
    this.assertAbsoluteCwd(input.cwd);
    await this.ensureProcess(input.cwd);

    if (!this.initialized) {
      await this.initializeProtocol();
      this.initialized = true;
    }

    const response = await this.sendRequest(
      createThreadStartRequest(this.allocateRequestId(), {
        cwd: input.cwd,
        approvalPolicy: this.config.approvalPolicy,
        sandbox: this.config.threadSandbox,
      }),
    );

    const threadId = extractThreadId(response);
    if (!threadId) {
      throw new SymphonyError("response_error", "thread/start response missing thread id", {
        details: { response },
      });
    }

    return { threadId };
  }

  async runTurn(input: {
    threadId: string;
    cwd: string;
    title: string;
    prompt: string;
  }): Promise<{ turnId: string; sessionId: string; outcome: TurnOutcome }> {
    this.assertAbsoluteCwd(input.cwd);

    if (!this.process) {
      throw new SymphonyError("response_error", "cannot start turn before starting a session");
    }

    const response = await this.sendRequest(
      createTurnStartRequest(this.allocateRequestId(), {
        threadId: input.threadId,
        cwd: input.cwd,
        title: input.title,
        inputText: input.prompt,
        approvalPolicy: this.config.approvalPolicy,
        sandboxPolicy: this.config.turnSandboxPolicy,
      }),
    );

    const turnId = extractTurnId(response);
    if (!turnId) {
      throw new SymphonyError("response_error", "turn/start response missing turn id", {
        details: { response },
      });
    }

    const sessionId = `${input.threadId}-${turnId}`;
    this.emit({ event: "session_started", session_id: sessionId });

    const outcome = await this.waitForTurnOutcome();
    return { turnId, sessionId, outcome };
  }

  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
    }

    this.teardown();
  }

  private async ensureProcess(cwd: string): Promise<void> {
    if (this.process) {
      return;
    }

    try {
      const proc = spawn("bash", ["-lc", this.config.command], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.process = proc;
      this.stdoutLineReader = createInterface({ input: proc.stdout });

      this.stdoutLineReader.on("line", (line) => {
        this.handleStdoutLine(line);
      });

      proc.stderr.on("data", (chunk: Buffer | string) => {
        const message = chunk.toString().trim();
        if (message) {
          this.emit({ event: "other_message", message });
        }
      });

      proc.on("exit", (code, signal) => {
        const exitMessage = `codex app-server exited (code=${String(code)} signal=${String(signal)})`;
        this.rejectAllPending(new SymphonyError("port_exit", exitMessage));

        if (this.pendingTurn) {
          this.pendingTurn.resolve("port_exit");
          clearTimeout(this.pendingTurn.timer);
          this.pendingTurn = null;
        }

        this.emit({ event: "turn_ended_with_error", message: exitMessage });
        this.teardown();
      });

      proc.on("error", (error) => {
        this.emit({ event: "startup_failed", message: error.message });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("enoent")) {
        throw new SymphonyError("codex_not_found", `failed to launch codex command: ${this.config.command}`, {
          cause: error,
        });
      }

      throw new SymphonyError("response_error", `failed to launch codex app-server: ${message}`, {
        cause: error,
      });
    }
  }

  private async initializeProtocol(): Promise<void> {
    await this.sendRequest(
      createInitializeRequest(this.allocateRequestId(), {
        clientName: this.config.clientName,
        clientVersion: this.config.clientVersion,
        capabilities: this.config.clientCapabilities,
      }),
    );
    this.sendNotification(createInitializedNotification());
  }

  private async sendRequest(message: JsonRpcMessage): Promise<JsonRpcMessage> {
    const id = typeof message.id === "number" ? message.id : null;
    if (id === null) {
      throw new SymphonyError("response_error", "cannot send request without numeric id");
    }

    const proc = this.process;
    if (!proc) {
      throw new SymphonyError("response_error", "codex process is not running");
    }

    const payload = JSON.stringify(message);

    return await new Promise<JsonRpcMessage>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        rejectRequest(new SymphonyError("response_timeout", `request timed out waiting for response (id=${id})`));
      }, this.config.readTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      });

      proc.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          rejectRequest(new SymphonyError("response_error", `failed writing request to codex stdin (id=${id})`, {
            cause: error,
          }));
        }
      });
    });
  }

  private sendNotification(message: JsonRpcMessage): void {
    const proc = this.process;
    if (!proc) {
      return;
    }

    proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleStdoutLine(line: string): void {
    const parsed = parseProtocolLine(line);

    if (parsed.kind === "malformed") {
      this.emit({
        event: "malformed",
        message: parsed.error,
        payload: { raw: parsed.raw },
      });
      return;
    }

    const message = parsed.message;

    if (this.resolvePendingRequest(message)) {
      return;
    }

    this.handleIncomingMessage(message);
  }

  private resolvePendingRequest(message: JsonRpcMessage): boolean {
    const id = typeof message.id === "number" ? message.id : null;
    if (id === null) {
      return false;
    }

    const pending = this.pendingRequests.get(id);
    if (!pending) {
      return false;
    }

    this.pendingRequests.delete(id);
    clearTimeout(pending.timer);

    if (message.error) {
      const err = new SymphonyError("response_error", `codex response included error for request id=${id}`, {
        details: { error: message.error },
      });
      pending.reject(err);
      return true;
    }

    pending.resolve(message);
    return true;
  }

  private handleIncomingMessage(message: JsonRpcMessage): void {
    const method = getMethodName(message);

    if (isApprovalRequest(message)) {
      this.sendRequestResult(message.id, { approved: true });
      this.emit({ event: "approval_auto_approved", payload: { method } });
      return;
    }

    if (isUnsupportedToolCallRequest(message)) {
      this.sendRequestResult(message.id, { success: false, error: "unsupported_tool_call" });
      this.emit({ event: "unsupported_tool_call", payload: { method } });
      return;
    }

    if (isUserInputRequired(message)) {
      this.emit({ event: "turn_input_required", payload: { method } });
      this.resolveTurnOutcome("turn_input_required");
      return;
    }

    const terminal = getTurnTerminalState(method);
    if (terminal === "completed") {
      this.emit({ event: "turn_completed", payload: { method } });
      this.resolveTurnOutcome("completed");
      return;
    }

    if (terminal === "failed") {
      this.emit({ event: "turn_failed", payload: { method } });
      this.resolveTurnOutcome("failed");
      return;
    }

    if (terminal === "cancelled") {
      this.emit({ event: "turn_cancelled", payload: { method } });
      this.resolveTurnOutcome("cancelled");
      return;
    }

    this.emit({
      event: "notification",
      payload: message,
      usage: extractUsage(message) ?? undefined,
      rate_limits: extractRateLimits(message) ?? undefined,
    });
  }

  private sendRequestResult(id: unknown, result: unknown): void {
    const proc = this.process;
    if (!proc) {
      return;
    }

    if (typeof id !== "number" && typeof id !== "string") {
      return;
    }

    proc.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  private waitForTurnOutcome(): Promise<TurnOutcome> {
    if (this.pendingTurn) {
      throw new SymphonyError("response_error", "a turn is already in progress");
    }

    return new Promise<TurnOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTurn = null;
        resolve("turn_timeout");
      }, this.config.turnTimeoutMs);

      this.pendingTurn = { resolve, timer };
    });
  }

  private resolveTurnOutcome(outcome: TurnOutcome): void {
    if (!this.pendingTurn) {
      return;
    }

    const pending = this.pendingTurn;
    this.pendingTurn = null;
    clearTimeout(pending.timer);
    pending.resolve(outcome);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      this.pendingRequests.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private teardown(): void {
    this.process = null;
    this.initialized = false;

    if (this.stdoutLineReader) {
      this.stdoutLineReader.removeAllListeners();
      this.stdoutLineReader.close();
      this.stdoutLineReader = null;
    }
  }

  private emit(event: Omit<CodexRuntimeEvent, "timestamp" | "codex_app_server_pid">): void {
    this.onEvent?.({
      timestamp: new Date().toISOString(),
      codex_app_server_pid: this.process?.pid ?? undefined,
      ...event,
    });
  }

  private allocateRequestId(): number {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return id;
  }

  private assertAbsoluteCwd(cwd: string): void {
    const absolute = resolve(cwd);
    if (absolute !== cwd) {
      throw new SymphonyError("invalid_workspace_cwd", `workspace cwd must be absolute: ${cwd}`);
    }
  }
}
