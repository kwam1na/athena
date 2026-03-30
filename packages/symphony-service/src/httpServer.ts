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

interface StateApiResponse {
  generated_at: string;
  counts: {
    running: number;
    retrying: number;
  };
  running: Array<{
    issue_id: string;
    issue_identifier: string;
    state: string;
    session_id: string | null;
    turn_count: number;
    retry_attempt: number;
    started_at: string;
    last_event_at: string | null;
    tokens: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
  }>;
  retrying: Array<{
    issue_id: string;
    issue_identifier: string;
    attempt: number;
    due_at: string;
    error: string;
  }>;
  codex_totals: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    seconds_running: number;
  };
  rate_limits: Record<string, unknown> | null;
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

    const state = toStateResponse(options.service);
    const html = renderDashboardHtml(state);
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

function toStateResponse(service: SymphonyService): StateApiResponse {
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

function renderDashboardHtml(state: StateApiResponse): string {
  const initialStateJson = safeJsonForScript(state);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Symphony Status</title>
  <style>
    :root {
      color-scheme: dark;
    }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      margin: 24px;
      background: #0b0f14;
      color: #d8e0ea;
    }
    h1 {
      margin: 0;
      font-size: 20px;
    }
    h2 {
      margin: 0 0 8px;
      font-size: 15px;
      color: #a9bfd8;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    button {
      border: 1px solid #305075;
      background: #12233a;
      color: #d8e0ea;
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
    }
    button[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .card {
      border: 1px solid #263241;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      background: #121922;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(180px, 1fr));
      gap: 8px;
    }
    .muted {
      color: #8aa1ba;
    }
    code {
      color: #8dd3ff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      border-bottom: 1px solid #233244;
      text-align: left;
      padding: 7px 6px;
      vertical-align: top;
    }
    th {
      color: #99b3cd;
      font-weight: 600;
    }
    .empty {
      color: #8aa1ba;
      font-style: italic;
    }
    .split {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
      color: #b7cce1;
    }
    a {
      color: #8dd3ff;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    @media (max-width: 860px) {
      .stats {
        grid-template-columns: 1fr;
      }
      .topbar {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>Symphony Runtime Status</h1>
    <div class="controls">
      <button id="refresh-btn" type="button">Refresh Now</button>
      <span class="muted" id="refresh-status"></span>
    </div>
  </div>
  <div class="card">
    <div>Generated: <span class="muted" id="generated-at"></span></div>
    <div class="stats">
      <div>Running: <code id="count-running"></code></div>
      <div>Retrying: <code id="count-retrying"></code></div>
      <div>Total tokens: <code id="total-tokens"></code></div>
      <div>Input tokens: <code id="input-tokens"></code></div>
      <div>Output tokens: <code id="output-tokens"></code></div>
      <div>Runtime seconds: <code id="runtime-seconds"></code></div>
    </div>
  </div>
  <div class="split">
    <div class="card">
      <h2>Running Issues</h2>
      <table>
        <thead>
          <tr>
            <th>Issue</th>
            <th>State</th>
            <th>Turns</th>
            <th>Retry</th>
            <th>Started</th>
            <th>Last event</th>
            <th>Tokens</th>
            <th>Session</th>
          </tr>
        </thead>
        <tbody id="running-body"></tbody>
      </table>
      <div id="running-empty" class="empty" style="display:none;">No running issues.</div>
    </div>

    <div class="card">
      <h2>Retry Queue</h2>
      <table>
        <thead>
          <tr>
            <th>Issue</th>
            <th>Attempt</th>
            <th>Due at</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody id="retrying-body"></tbody>
      </table>
      <div id="retrying-empty" class="empty" style="display:none;">No retrying issues.</div>
    </div>

    <div class="card">
      <h2>Rate Limits</h2>
      <pre id="rate-limits"></pre>
      <div class="muted">API endpoints: <code>/api/v1/state</code>, <code>/api/v1/refresh</code></div>
    </div>
  </div>
  <script>
    const initialState = ${initialStateJson};
    const refreshBtn = document.getElementById("refresh-btn");
    const refreshStatus = document.getElementById("refresh-status");

    function esc(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function formatDate(value) {
      if (!value) return "—";
      const date = new Date(value);
      if (Number.isNaN(date.valueOf())) return esc(value);
      return esc(date.toLocaleString());
    }

    function formatNumber(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "0";
      return value.toLocaleString();
    }

    function renderRows(state) {
      document.getElementById("generated-at").textContent = state.generated_at || "";
      document.getElementById("count-running").textContent = formatNumber(state.counts?.running ?? 0);
      document.getElementById("count-retrying").textContent = formatNumber(state.counts?.retrying ?? 0);
      document.getElementById("total-tokens").textContent = formatNumber(state.codex_totals?.total_tokens ?? 0);
      document.getElementById("input-tokens").textContent = formatNumber(state.codex_totals?.input_tokens ?? 0);
      document.getElementById("output-tokens").textContent = formatNumber(state.codex_totals?.output_tokens ?? 0);
      document.getElementById("runtime-seconds").textContent = Number(state.codex_totals?.seconds_running ?? 0).toFixed(2);

      const running = Array.isArray(state.running) ? state.running : [];
      const retrying = Array.isArray(state.retrying) ? state.retrying : [];

      const runningBody = document.getElementById("running-body");
      runningBody.innerHTML = running
        .map((row) => \`<tr>
          <td><a href="/api/v1/\${encodeURIComponent(row.issue_identifier)}">\${esc(row.issue_identifier)}</a></td>
          <td>\${esc(row.state)}</td>
          <td>\${formatNumber(row.turn_count)}</td>
          <td>\${formatNumber(row.retry_attempt)}</td>
          <td>\${formatDate(row.started_at)}</td>
          <td>\${formatDate(row.last_event_at)}</td>
          <td>\${formatNumber(row.tokens?.total_tokens ?? 0)}</td>
          <td>\${esc(row.session_id ?? "—")}</td>
        </tr>\`)
        .join("");
      document.getElementById("running-empty").style.display = running.length > 0 ? "none" : "block";

      const retryingBody = document.getElementById("retrying-body");
      retryingBody.innerHTML = retrying
        .map((row) => \`<tr>
          <td><a href="/api/v1/\${encodeURIComponent(row.issue_identifier)}">\${esc(row.issue_identifier)}</a></td>
          <td>\${formatNumber(row.attempt)}</td>
          <td>\${formatDate(row.due_at)}</td>
          <td>\${esc(row.error)}</td>
        </tr>\`)
        .join("");
      document.getElementById("retrying-empty").style.display = retrying.length > 0 ? "none" : "block";

      const rateLimits = state.rate_limits == null ? "null" : JSON.stringify(state.rate_limits, null, 2);
      document.getElementById("rate-limits").textContent = rateLimits;
    }

    async function fetchState() {
      const response = await fetch("/api/v1/state");
      if (!response.ok) {
        throw new Error(\`state request failed: \${response.status}\`);
      }
      return await response.json();
    }

    async function refreshNow() {
      refreshBtn.disabled = true;
      refreshStatus.textContent = "refreshing...";
      try {
        const response = await fetch("/api/v1/refresh", { method: "POST" });
        if (!response.ok) {
          throw new Error(\`refresh request failed: \${response.status}\`);
        }
        const state = await fetchState();
        renderRows(state);
        refreshStatus.textContent = "updated";
      } catch (error) {
        refreshStatus.textContent = String(error instanceof Error ? error.message : error);
      } finally {
        refreshBtn.disabled = false;
      }
    }

    async function pollState() {
      try {
        const state = await fetchState();
        renderRows(state);
      } catch (error) {
        refreshStatus.textContent = String(error instanceof Error ? error.message : error);
      }
    }

    refreshBtn.addEventListener("click", () => {
      void refreshNow();
    });

    renderRows(initialState);
    setInterval(() => {
      void pollState();
    }, 2000);
  </script>
</body>
</html>`;
}

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
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
