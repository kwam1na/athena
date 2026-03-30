import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { SymphonyService } from "./service";

export interface StatusServer {
  host: string;
  port: number;
  stop: () => Promise<void>;
}

export interface StartStatusServerOptions {
  service: SymphonyService;
  port: number;
  host?: string;
  onRefreshError?: (error: unknown) => void;
}

interface RefreshQueueState {
  queued: boolean;
  inFlight: boolean;
}

export async function startStatusServer(options: StartStatusServerOptions): Promise<StatusServer> {
  const host = options.host ?? "127.0.0.1";
  const refreshState: RefreshQueueState = {
    queued: false,
    inFlight: false,
  };

  const server = createServer((request, response) => {
    void handleRequest(options, request, response, refreshState);
  });

  await listen(server, {
    host,
    port: options.port,
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("status server failed to resolve listening address");
  }

  return {
    host,
    port: address.port,
    stop: () => closeServer(server),
  };
}

async function handleRequest(
  options: StartStatusServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
  refreshState: RefreshQueueState,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (path === "/") {
    if (method !== "GET") {
      sendMethodNotAllowed(response, ["GET"]);
      return;
    }

    const runtime = options.service.getRuntimeSnapshot();
    const html = renderDashboardHtml(runtime);
    sendText(response, 200, html, "text/html; charset=utf-8");
    return;
  }

  if (path === "/api/v1/state") {
    if (method !== "GET") {
      sendMethodNotAllowed(response, ["GET"]);
      return;
    }

    sendJson(response, 200, toStateResponse(options.service));
    return;
  }

  if (path === "/api/v1/refresh") {
    if (method !== "POST") {
      sendMethodNotAllowed(response, ["POST"]);
      return;
    }

    const coalesced = refreshState.queued || refreshState.inFlight;
    queueRefresh(options, refreshState);

    sendJson(response, 202, {
      queued: true,
      coalesced,
      requested_at: new Date().toISOString(),
      operations: ["poll", "reconcile"],
    });
    return;
  }

  if (path.startsWith("/api/v1/")) {
    const issueIdentifier = decodeURIComponent(path.slice("/api/v1/".length));
    if (!issueIdentifier || issueIdentifier === "state" || issueIdentifier === "refresh") {
      sendJsonError(response, 404, "route_not_found", "route not found");
      return;
    }

    if (method !== "GET") {
      sendMethodNotAllowed(response, ["GET"]);
      return;
    }

    const issueResponse = toIssueResponse(options.service, issueIdentifier);
    if (!issueResponse) {
      sendJsonError(response, 404, "issue_not_found", `issue not found: ${issueIdentifier}`);
      return;
    }

    sendJson(response, 200, issueResponse);
    return;
  }

  if (path.startsWith("/api/v1")) {
    sendJsonError(response, 404, "route_not_found", "route not found");
    return;
  }

  sendText(response, 404, "Not Found\n");
}

function queueRefresh(options: StartStatusServerOptions, refreshState: RefreshQueueState): void {
  refreshState.queued = true;
  if (refreshState.inFlight) {
    return;
  }

  queueMicrotask(() => {
    void drainRefreshQueue(options, refreshState);
  });
}

async function drainRefreshQueue(options: StartStatusServerOptions, refreshState: RefreshQueueState): Promise<void> {
  if (!refreshState.queued || refreshState.inFlight) {
    return;
  }

  refreshState.queued = false;
  refreshState.inFlight = true;

  try {
    await options.service.runTickOnce();
  } catch (error) {
    options.onRefreshError?.(error);
  } finally {
    refreshState.inFlight = false;
    if (refreshState.queued) {
      queueMicrotask(() => {
        void drainRefreshQueue(options, refreshState);
      });
    }
  }
}

function toStateResponse(service: SymphonyService): Record<string, unknown> {
  const runtime = service.getRuntimeSnapshot();

  return {
    generated_at: new Date().toISOString(),
    counts: {
      running: runtime.running.length,
      retrying: runtime.retrying.length,
    },
    running: runtime.running.map((row) => ({
      issue_id: row.issue_id,
      issue_identifier: row.issue_identifier,
      state: row.state,
      session_id: row.session_id,
      turn_count: row.turn_count,
      retry_attempt: row.retry_attempt,
      started_at: toIso(row.started_at_ms),
      last_event_at: toIsoNullable(row.last_codex_timestamp_ms),
      tokens: {
        input_tokens: row.codex_input_tokens,
        output_tokens: row.codex_output_tokens,
        total_tokens: row.codex_total_tokens,
      },
    })),
    retrying: runtime.retrying.map((row) => ({
      issue_id: row.issue_id,
      issue_identifier: row.issue_identifier,
      attempt: row.attempt,
      due_at: toIso(row.due_at_ms),
      error: row.error,
    })),
    codex_totals: runtime.codex_totals,
    rate_limits: runtime.rate_limits,
  };
}

function toIssueResponse(
  service: SymphonyService,
  issueIdentifier: string,
): Record<string, unknown> | null {
  const runtime = service.getRuntimeSnapshot();
  const running = runtime.running.find((row) => row.issue_identifier === issueIdentifier);
  const retry = runtime.retrying.find((row) => row.issue_identifier === issueIdentifier);

  if (!running && !retry) {
    return null;
  }

  return {
    issue_identifier: issueIdentifier,
    issue_id: running?.issue_id ?? retry?.issue_id ?? "",
    status: running ? "running" : "retrying",
    running: running
      ? {
          state: running.state,
          session_id: running.session_id,
          turn_count: running.turn_count,
          retry_attempt: running.retry_attempt,
          started_at: toIso(running.started_at_ms),
          last_event_at: toIsoNullable(running.last_codex_timestamp_ms),
          tokens: {
            input_tokens: running.codex_input_tokens,
            output_tokens: running.codex_output_tokens,
            total_tokens: running.codex_total_tokens,
          },
        }
      : null,
    retry: retry
      ? {
          attempt: retry.attempt,
          due_at: toIso(retry.due_at_ms),
          error: retry.error,
        }
      : null,
    codex_totals: runtime.codex_totals,
    rate_limits: runtime.rate_limits,
  };
}

function renderDashboardHtml(runtime: ReturnType<SymphonyService["getRuntimeSnapshot"]>): string {
  const generatedAt = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Symphony Status</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px; background: #0b0f14; color: #d8e0ea; }
    h1 { margin: 0 0 12px; font-size: 20px; }
    .card { border: 1px solid #263241; border-radius: 8px; padding: 12px; margin-bottom: 12px; background: #121922; }
    .muted { color: #8aa1ba; }
    code { color: #8dd3ff; }
  </style>
</head>
<body>
  <h1>Symphony Runtime Status</h1>
  <div class="card">
    <div>Generated: <span class="muted">${generatedAt}</span></div>
    <div>Running: <code>${runtime.running.length}</code></div>
    <div>Retrying: <code>${runtime.retrying.length}</code></div>
  </div>
  <div class="card">
    <div>Total tokens: <code>${runtime.codex_totals.total_tokens}</code></div>
    <div>Runtime seconds: <code>${runtime.codex_totals.seconds_running.toFixed(2)}</code></div>
    <div>API: <code>/api/v1/state</code></div>
  </div>
</body>
</html>`;
}

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function toIsoNullable(epochMs: number | null): string | null {
  if (epochMs === null) {
    return null;
  }
  return toIso(epochMs);
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(body);
}

function sendJsonError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, {
    error: {
      code,
      message,
    },
  });
}

function sendText(response: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void {
  response.statusCode = status;
  response.setHeader("content-type", contentType);
  response.end(body);
}

function sendMethodNotAllowed(response: ServerResponse, allow: string[]): void {
  response.statusCode = 405;
  response.setHeader("allow", allow.join(", "));
  sendJsonError(response, 405, "method_not_allowed", "method not allowed");
}

function listen(server: Server, options: { host: string; port: number }): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(options.port, options.host, () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
}

