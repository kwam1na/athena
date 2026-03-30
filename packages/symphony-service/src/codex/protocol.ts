export interface JsonRpcMessage {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export type TurnTerminalState = "completed" | "failed" | "cancelled";

export interface InitializeRequestOptions {
  clientName?: string;
  clientVersion?: string;
  capabilities?: Record<string, unknown>;
}

export function createInitializeRequest(id: number, options?: InitializeRequestOptions): JsonRpcMessage {
  const clientName = options?.clientName?.trim() || "symphony";
  const clientVersion =
    options?.clientVersion?.trim() || process.env.SYMPHONY_CLIENT_VERSION || process.env.npm_package_version || "unknown";

  return {
    id,
    method: "initialize",
    params: {
      clientInfo: {
        name: clientName,
        version: clientVersion,
      },
      capabilities: options?.capabilities ?? {},
    },
  };
}

export function createInitializedNotification(): JsonRpcMessage {
  return {
    method: "initialized",
    params: {},
  };
}

export function createThreadStartRequest(
  id: number,
  params: {
    cwd: string;
    approvalPolicy?: unknown;
    sandbox?: unknown;
  },
): JsonRpcMessage {
  return {
    id,
    method: "thread/start",
    params: {
      cwd: params.cwd,
      approvalPolicy: params.approvalPolicy,
      sandbox: params.sandbox,
    },
  };
}

export function createTurnStartRequest(
  id: number,
  params: {
    threadId: string;
    cwd: string;
    title: string;
    inputText: string;
    approvalPolicy?: unknown;
    sandboxPolicy?: unknown;
  },
): JsonRpcMessage {
  return {
    id,
    method: "turn/start",
    params: {
      threadId: params.threadId,
      input: [{ type: "text", text: params.inputText }],
      cwd: params.cwd,
      title: params.title,
      approvalPolicy: params.approvalPolicy,
      sandboxPolicy: params.sandboxPolicy,
    },
  };
}

export function parseProtocolLine(line: string):
  | { kind: "json"; message: JsonRpcMessage }
  | { kind: "malformed"; raw: string; error: string } {
  try {
    const parsed = JSON.parse(line) as JsonRpcMessage;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        kind: "malformed",
        raw: line,
        error: "parsed payload is not an object",
      };
    }

    return {
      kind: "json",
      message: parsed,
    };
  } catch (error) {
    return {
      kind: "malformed",
      raw: line,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function extractThreadId(message: JsonRpcMessage): string | null {
  const result = asObject(message.result);
  const thread = asObject(result?.thread);

  const nested = asString(thread?.id);
  if (nested) {
    return nested;
  }

  return asString(result?.threadId) || null;
}

export function extractTurnId(message: JsonRpcMessage): string | null {
  const result = asObject(message.result);
  const turn = asObject(result?.turn);

  const nested = asString(turn?.id);
  if (nested) {
    return nested;
  }

  return asString(result?.turnId) || null;
}

export function getMethodName(message: JsonRpcMessage): string {
  return asString(message.method) || "";
}

export function getTurnTerminalState(method: string): TurnTerminalState | null {
  if (method === "turn/completed") {
    return "completed";
  }

  if (method === "turn/failed") {
    return "failed";
  }

  if (method === "turn/cancelled") {
    return "cancelled";
  }

  return null;
}

export function isApprovalRequest(message: JsonRpcMessage): boolean {
  const method = getMethodName(message).toLowerCase();
  return hasRequestId(message) && method.includes("approval") && method.includes("request");
}

export function isUnsupportedToolCallRequest(message: JsonRpcMessage): boolean {
  const method = getMethodName(message).toLowerCase();
  return hasRequestId(message) && method.includes("item/tool/call");
}

export function isUserInputRequired(message: JsonRpcMessage): boolean {
  const method = getMethodName(message).toLowerCase();
  if (method.includes("requestuserinput") || method.includes("turn_input_required") || method.includes("input_required")) {
    return true;
  }

  const params = asObject(message.params);
  if (typeof params?.inputRequired === "boolean") {
    return params.inputRequired;
  }

  if (typeof params?.userInputRequired === "boolean") {
    return params.userInputRequired;
  }

  return false;
}

export function extractUsage(message: JsonRpcMessage): Record<string, number> | null {
  const params = asObject(message.params);
  const tokenUsage = asObject(params?.tokenUsage);
  const msg = asObject(params?.msg);
  const msgInfo = asObject(msg?.info);

  const absoluteUsage = firstObject(
    params?.total_token_usage,
    params?.token_usage,
    tokenUsage?.total,
    params?.tokenUsage,
    params?.usage,
    msgInfo?.total_token_usage,
    msgInfo?.token_usage,
    asObject(msgInfo?.tokenUsage)?.total,
    msgInfo?.tokenUsage,
    msg?.total_token_usage,
    msg?.token_usage,
    asObject(msg?.tokenUsage)?.total,
    msg?.tokenUsage,
    msg?.usage,
  );

  if (!absoluteUsage) {
    return null;
  }

  const inputTokens = asNumber(
    absoluteUsage.input_tokens ?? absoluteUsage.inputTokens ?? absoluteUsage.prompt_tokens ?? absoluteUsage.promptTokens,
  );
  const outputTokens = asNumber(
    absoluteUsage.output_tokens ?? absoluteUsage.outputTokens ?? absoluteUsage.completion_tokens ?? absoluteUsage.completionTokens,
  );
  const totalTokens = asNumber(absoluteUsage.total_tokens ?? absoluteUsage.totalTokens);

  const out: Record<string, number> = {};
  if (inputTokens !== null) {
    out.input_tokens = inputTokens;
  }
  if (outputTokens !== null) {
    out.output_tokens = outputTokens;
  }
  if (totalTokens !== null) {
    out.total_tokens = totalTokens;
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function extractRateLimits(message: JsonRpcMessage): Record<string, unknown> | null {
  const params = asObject(message.params);
  const msg = asObject(params?.msg);
  const msgInfo = asObject(msg?.info);
  const limits = firstObject(params?.rate_limits, params?.rateLimits, msg?.rate_limits, msg?.rateLimits, msgInfo?.rate_limits, msgInfo?.rateLimits);
  return limits || null;
}

function hasRequestId(message: JsonRpcMessage): boolean {
  const id = message.id;
  return typeof id === "number" || typeof id === "string";
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function firstObject(...candidates: unknown[]): Record<string, unknown> | null {
  for (const candidate of candidates) {
    const obj = asObject(candidate);
    if (obj) {
      return obj;
    }
  }

  return null;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}
