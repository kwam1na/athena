"use node";
/**
 * Direct QuickJS program runtime (the chosen sandbox; see
 * `docs/agent/agent-harness-runtime.md` for the decision against
 * `@ai-sdk/code-mode`). The plan named this file `codeMode.ts`; it is
 * `quickJsRuntime.ts` because the chosen adapter is not code-mode.
 *
 * Isolation model:
 * - one fresh QuickJS runtime + context per execution inside the WebAssembly
 *   heap (`quickjs-emscripten-core`, single-file wasm variant so the Convex
 *   Node bundle carries the engine with no file or network loading);
 * - the guest sees only a deep-frozen `athena.<package>.<resource>.<verb>`
 *   facade built from the bridge's facade entries; every call crosses the
 *   boundary as JSON text through one host function and back as JSON text;
 * - `Date` and `Proxy` intrinsics are not installed; `eval`, `Reflect`,
 *   `Math.random`, and every function-prototype `constructor` are removed or
 *   replaced with throwing stubs before the program runs (host `evalCode`
 *   needs the engine's eval intrinsic, so dynamic code is blocked at the
 *   prototype level rather than by omitting the intrinsic);
 * - ceilings: heap and stack via the engine, elapsed time via the interrupt
 *   handler and the driver deadline, calls / in-flight / args / per-call
 *   output / cumulative bridge bytes / result bytes via the host bridge;
 * - cancellation aborts the interrupt handler and finalizes immediately; host
 *   results that arrive afterwards are dropped before they touch the context.
 *
 * The runtime executes JavaScript only: callers go through `execute`, which
 * runs Athena's static validation and type stripping first.
 */
import {
  DefaultIntrinsics,
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-singlefile-mjs-release-sync";

import type { JsonValue } from "../../../shared/agentHarness/manifest";
import { measureUtf8Bytes } from "./outputCeiling";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { AGENT_PROGRAM_ENTRY, validateProgramSource } from "./programValidation";
import type {
  AgentProgramDiagnostics,
  AgentProgramExecutionInput,
  AgentProgramFacadeVerb,
  AgentProgramFailureCode,
  AgentProgramHostBridge,
  AgentProgramOutcome,
  AgentProgramRuntime,
  AgentProgramRuntimeCeilings,
} from "./types";
import { AGENT_PROGRAM_FACADE_VERBS } from "./types";

export const AGENT_PROGRAM_RUNTIME_KIND_QUICKJS = "quickjs_wasm" as const;

const GUEST_ERROR_PREFIX = "__athena__:";

/**
 * Evaluated once per context. Receives the host call function, the facade
 * JSON, and the ceiling config JSON; returns `{ athena, serialize }`. Besides
 * the read facade it installs `athena.dates` (pure date arithmetic),
 * `athena.budget.remaining()`, a guest-side call budget that REFUSES (rather
 * than crashes) reads past the ceiling, and an in-flight throttle that queues
 * (rather than fails) calls above the concurrency ceiling. Written as ES2020
 * so QuickJS parses it.
 */
const PRELUDE = `(function (hostCall, facadeJson, configJson) {
  "use strict";
  function fail(code) { throw new Error(${JSON.stringify(GUEST_ERROR_PREFIX)} + code); }
  function serialize(value, code) {
    var seen = new Set();
    function walk(v) {
      if (v === null) return null;
      var t = typeof v;
      if (t === "string" || t === "boolean") return v;
      if (t === "number") { if (!isFinite(v)) fail(code); return v; }
      if (t === "undefined" || t === "function" || t === "symbol" || t === "bigint") fail(code);
      if (Array.isArray(v)) {
        if (seen.has(v)) fail(code);
        seen.add(v);
        var out = [];
        for (var i = 0; i < v.length; i += 1) out.push(walk(v[i]));
        seen.delete(v);
        return out;
      }
      var proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) fail(code);
      if (seen.has(v)) fail(code);
      seen.add(v);
      var obj = {};
      var keys = Object.keys(v);
      for (var k = 0; k < keys.length; k += 1) {
        var w = v[keys[k]];
        if (w === undefined) continue;
        obj[keys[k]] = walk(w);
      }
      seen.delete(v);
      return obj;
    }
    return JSON.stringify(walk(value === undefined ? null : value));
  }
  function deepFreeze(o) {
    var names = Object.getOwnPropertyNames(o);
    for (var i = 0; i < names.length; i += 1) {
      var value = o[names[i]];
      if (value && typeof value === "object") deepFreeze(value);
    }
    return Object.freeze(o);
  }
  var entries = JSON.parse(facadeJson);
  var config = JSON.parse(configJson);

  // Guest-side budget and throttle. The budget refusal is a value, not a
  // crash: a program that overruns the call budget keeps everything it
  // already read and decides what to return. The throttle queues calls above
  // the in-flight ceiling instead of failing a wide Promise.all. The host
  // bridge keeps both hard checks as the backstop.
  var callsUsed = 0;
  var inFlight = 0;
  var waiters = [];
  function acquire() {
    if (inFlight < config.maxInFlightCalls) { inFlight += 1; return Promise.resolve(); }
    return new Promise(function (resolve) { waiters.push(resolve); });
  }
  function release() {
    if (waiters.length > 0) waiters.shift()();
    else inFlight -= 1;
  }

  var root = {};
  for (var e = 0; e < entries.length; e += 1) {
    var entry = entries[e];
    if (!root[entry.package]) root[entry.package] = {};
    var pkg = root[entry.package];
    if (!pkg[entry.resource]) pkg[entry.resource] = {};
    var resource = pkg[entry.resource];
    for (var v = 0; v < entry.verbs.length; v += 1) {
      resource[entry.verbs[v]] = (function (p, r, verb) {
        return function (args) {
          var json = serialize(args === undefined ? {} : args, "call_args_not_serializable");
          if (callsUsed >= config.maxCapabilityCalls) {
            return Promise.resolve({
              kind: "denied",
              code: "budget_exhausted",
              message: "This run's " + config.maxCapabilityCalls + "-capability-call budget is spent; no further reads will be served. Return your result now with what was already read.",
              retryable: false,
            });
          }
          callsUsed += 1;
          return acquire().then(function () {
            return hostCall(p, r, verb, json).then(
              function (text) { release(); return JSON.parse(text); },
              function (error) { release(); throw error; }
            );
          });
        };
      })(entry.package, entry.resource, entry.verbs[v]);
    }
  }

  // Pure date arithmetic (days-from-civil), so a program can enumerate
  // operating dates without the Date global the sandbox forbids.
  function isIsoDate(value) { return typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value); }
  function toDays(iso) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400);
    var yoe = y - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function fromDays(z) {
    z += 719468;
    var era = Math.floor(z / 146097);
    var doe = z - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var y = yoe + era * 400;
    var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    var mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    var m = mp + (mp < 10 ? 3 : -9);
    y += m <= 2 ? 1 : 0;
    function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
    return pad(y, 4) + "-" + pad(m, 2) + "-" + pad(d, 2);
  }
  root.dates = {
    shift: function (iso, days) {
      if (!isIsoDate(iso) || typeof days !== "number" || !isFinite(days) || Math.floor(days) !== days || Math.abs(days) > 3660) {
        throw new Error('athena.dates.shift takes ("YYYY-MM-DD", wholeDays) with wholeDays within \\u00b13660.');
      }
      return fromDays(toDays(iso) + days);
    },
    range: function (startIso, endIso) {
      if (!isIsoDate(startIso) || !isIsoDate(endIso)) {
        throw new Error('athena.dates.range takes ("YYYY-MM-DD", "YYYY-MM-DD") and returns the inclusive ascending dates.');
      }
      var a = toDays(startIso), b = toDays(endIso);
      if (b < a) return [];
      if (b - a + 1 > 400) throw new Error("athena.dates.range covers " + (b - a + 1) + " days; the ceiling is 400.");
      var out = [];
      for (var i = a; i <= b; i += 1) out.push(fromDays(i));
      return out;
    },
  };
  root.budget = {
    remaining: function () {
      return {
        callsRemaining: Math.max(0, config.maxCapabilityCalls - callsUsed),
        callCeiling: config.maxCapabilityCalls,
        maxInFlight: config.maxInFlightCalls,
      };
    },
  };
  deepFreeze(root);

  // Remove host-reaching and nondeterministic surface that intrinsics alone cannot drop.
  var g = globalThis;
  delete g.eval;
  delete g.Reflect;
  delete g.Proxy;
  delete g.Date;
  delete Math.random;
  function blocked() { throw new Error("Dynamic code is not available to programs."); }
  var protos = [
    Function.prototype,
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {}),
  ];
  for (var q = 0; q < protos.length; q += 1) {
    Object.defineProperty(protos[q], "constructor", { value: blocked, writable: false, configurable: false, enumerable: false });
  }
  g.Function = blocked;
  Object.freeze(Math);
  return { athena: root, serialize: serialize };
})`;

/**
 * QuickJS checks its own stack against the wasm stack; above this size the
 * wasm stack overflows first and corrupts the runtime, so larger ceilings are
 * clamped (see the stack probe recorded in `agent-harness-runtime.md`).
 */
export const AGENT_PROGRAM_STACK_CEILING_BYTES = 256 * 1024;

let modulePromise: Promise<QuickJSWASMModule> | undefined;
let wasmLoadMs = 0;

function loadModule(): Promise<QuickJSWASMModule> {
  if (!modulePromise) {
    const startedAt = Date.now();
    modulePromise = newQuickJSWASMModuleFromVariant(variant).then((loaded) => {
      wasmLoadMs = Date.now() - startedAt;
      return loaded;
    });
  }
  return modulePromise;
}

type Failure = { readonly code: AgentProgramFailureCode; readonly message: string };

type GuestError = { name?: string; message?: string };

function classifyGuestError(error: unknown): { code: AgentProgramFailureCode; message: string } {
  const guest = (typeof error === "object" && error !== null ? error : { message: String(error) }) as GuestError;
  const message = String(guest.message ?? "");
  if (message.startsWith(GUEST_ERROR_PREFIX)) {
    const code = message.slice(GUEST_ERROR_PREFIX.length) as AgentProgramFailureCode;
    return { code, message: `Program ${code.replace(/_/g, " ")}.` };
  }
  if (guest.name === "InternalError") {
    if (/out of memory/i.test(message)) return { code: "memory_limit", message: "Program exceeded the heap ceiling." };
    if (/stack overflow/i.test(message)) return { code: "stack_overflow", message: "Program exceeded the stack ceiling." };
    if (/interrupted/i.test(message)) return { code: "timeout", message: "Program exceeded the elapsed-time ceiling." };
  }
  const name = guest.name ?? "Error";
  return { code: "runtime_error", message: `${name}: ${message}`.slice(0, 500) };
}

export async function createQuickJsProgramRuntime(): Promise<AgentProgramRuntime> {
  const QuickJS = await loadModule();

  const run = async (
    program: string,
    sourceBytes: number,
    bridge: AgentProgramHostBridge,
    ceilings: AgentProgramRuntimeCeilings,
    signal: AbortSignal | undefined,
  ): Promise<AgentProgramOutcome> => {
    const startedAt = Date.now();
    const deadline = startedAt + ceilings.maxElapsedMs;
    const callController = new AbortController();
    const stats = { hostCalls: 0, inFlight: 0, maxInFlight: 0, argsBytes: 0, outputBytes: 0, resultBytes: 0 };
    const diagnostics = (memoryUsedBytes?: number): AgentProgramDiagnostics => ({
      elapsedMs: Date.now() - startedAt,
      hostCalls: stats.hostCalls,
      maxInFlight: stats.maxInFlight,
      bridgeArgsBytes: stats.argsBytes,
      bridgeOutputBytes: stats.outputBytes,
      resultBytes: stats.resultBytes,
      sourceBytes,
      ...(memoryUsedBytes !== undefined ? { memoryUsedBytes } : {}),
    });

    if (signal?.aborted) return { status: "canceled", reason: "aborted", diagnostics: diagnostics() };

    let failure: Failure | undefined;
    let interrupted = false;
    let finalized = false;
    let wake: () => void = () => undefined;
    let wakePromise = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const notify = () => {
      wake();
      wakePromise = new Promise<void>((resolve) => {
        wake = resolve;
      });
    };
    const fail = (code: AgentProgramFailureCode, message: string) => {
      failure ??= { code, message };
      interrupted = true;
      notify();
    };
    const onAbort = () => {
      interrupted = true;
      notify();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(ceilings.maxHeapBytes);
    runtime.setMaxStackSize(Math.min(ceilings.maxStackBytes, AGENT_PROGRAM_STACK_CEILING_BYTES));
    runtime.setInterruptHandler(() => interrupted || Date.now() > deadline);
    const context: QuickJSContext = runtime.newContext({
      intrinsics: { ...DefaultIntrinsics, Date: false, Proxy: false },
    });
    const deferreds = new Set<QuickJSDeferredPromise>();
    const handles: QuickJSHandle[] = [];
    const track = <H extends QuickJSHandle>(handle: H): H => {
      handles.push(handle);
      return handle;
    };

    const verbs = new Set<string>(AGENT_PROGRAM_FACADE_VERBS);
    const facadeIndex = new Set(bridge.facade.flatMap((entry) => entry.verbs.map((verb) => `${entry.package}.${entry.resource}.${verb}`)));

    const hostCall = context.newFunction("athenaCall", (pkgHandle, resourceHandle, verbHandle, argsHandle) => {
      const pkg = context.getString(pkgHandle);
      const resource = context.getString(resourceHandle);
      const verb = context.getString(verbHandle);
      const argsJson = context.getString(argsHandle);
      const deferred = context.newPromise();
      deferreds.add(deferred);

      if (!verbs.has(verb) || !facadeIndex.has(`${pkg}.${resource}.${verb}`)) {
        fail("facade_violation", "Program called a capability outside its facade.");
        return deferred.handle;
      }
      const argsBytes = measureUtf8Bytes(argsJson);
      if (argsBytes > ceilings.maxCallArgsBytes) {
        fail("call_args_too_large", `Call arguments are ${argsBytes} bytes; the ceiling is ${ceilings.maxCallArgsBytes}.`);
        return deferred.handle;
      }
      if (stats.hostCalls >= ceilings.maxCapabilityCalls) {
        fail("call_limit", `Program exceeded the ${ceilings.maxCapabilityCalls} capability-call ceiling.`);
        return deferred.handle;
      }
      if (stats.inFlight >= ceilings.maxInFlightCalls) {
        fail("in_flight_limit", `Program exceeded the ${ceilings.maxInFlightCalls} in-flight call ceiling.`);
        return deferred.handle;
      }
      if (stats.argsBytes + argsBytes > ceilings.maxRunBridgeBytes) {
        fail("bridge_bytes_exceeded", "Program exceeded the run bridge byte ceiling.");
        return deferred.handle;
      }
      const callIndex = stats.hostCalls;
      stats.hostCalls += 1;
      stats.inFlight += 1;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      stats.argsBytes += argsBytes;

      let args: JsonValue;
      try {
        args = JSON.parse(argsJson) as JsonValue;
      } catch {
        stats.inFlight -= 1;
        fail("call_args_not_serializable", "Call arguments were not JSON.");
        return deferred.handle;
      }

      Promise.resolve()
        .then(() => bridge.invoke({ package: pkg, resource, verb: verb as AgentProgramFacadeVerb, args, callIndex, signal: callController.signal }))
        .then(
          (value) => {
            stats.inFlight -= 1;
            if (finalized) return;
            let text: string;
            try {
              text = JSON.stringify(value === undefined ? null : value) ?? "null";
            } catch {
              fail("host_error", "Host bridge returned a value that is not JSON.");
              return;
            }
            const outputBytes = measureUtf8Bytes(text);
            if (outputBytes > ceilings.maxCallOutputBytes) {
              fail("call_output_too_large", `A call output is ${outputBytes} bytes; the ceiling is ${ceilings.maxCallOutputBytes}.`);
              return;
            }
            if (stats.argsBytes + stats.outputBytes + outputBytes > ceilings.maxRunBridgeBytes) {
              fail("bridge_bytes_exceeded", "Program exceeded the run bridge byte ceiling.");
              return;
            }
            stats.outputBytes += outputBytes;
            if (!deferred.alive) return;
            const handle = context.newString(text);
            deferred.resolve(handle);
            handle.dispose();
            deferred.dispose();
            deferreds.delete(deferred);
            notify();
          },
          () => {
            stats.inFlight -= 1;
            if (finalized) return;
            fail("host_error", "Host bridge invocation failed.");
          },
        );
      return deferred.handle;
    });
    track(hostCall);

    const finalize = (outcome: AgentProgramOutcome): AgentProgramOutcome => {
      if (finalized) return outcome;
      finalized = true;
      signal?.removeEventListener("abort", onAbort);
      callController.abort();
      for (const deferred of deferreds) {
        if (deferred.alive) deferred.dispose();
      }
      deferreds.clear();
      for (const handle of handles.reverse()) {
        if (handle.alive) handle.dispose();
      }
      context.dispose();
      runtime.dispose();
      return outcome;
    };

    const memoryUsed = (): number | undefined => {
      try {
        const handle = runtime.computeMemoryUsage();
        const usage = context.dump(handle) as { memory_used_size?: number } | undefined;
        handle.dispose();
        return typeof usage?.memory_used_size === "number" ? usage.memory_used_size : undefined;
      } catch {
        return undefined;
      }
    };

    const failedOutcome = (error: unknown): AgentProgramOutcome => {
      const memory = memoryUsed();
      if (failure) return finalize({ status: "failed", code: failure.code, message: failure.message, diagnostics: diagnostics(memory) });
      if (signal?.aborted) return finalize({ status: "canceled", reason: "aborted", diagnostics: diagnostics(memory) });
      const classified = classifyGuestError(error);
      if (classified.code === "timeout" && Date.now() <= deadline) {
        // Interrupted for a reason other than the deadline: only cancellation or a failure do that.
        return finalize({ status: "canceled", reason: "aborted", diagnostics: diagnostics(memory) });
      }
      return finalize({ status: "failed", code: classified.code, message: classified.message, diagnostics: diagnostics(memory) });
    };

    // Install the facade and the strict serializer without touching guest globals beyond `athena`.
    const preludeResult = context.evalCode(PRELUDE, "athena-prelude.js", { type: "global" });
    if (preludeResult.error) {
      const error = context.dump(preludeResult.error);
      preludeResult.error.dispose();
      return failedOutcome(error);
    }
    const preludeFn = track(preludeResult.value);
    const facadeJson = track(context.newString(JSON.stringify(bridge.facade)));
    const configJson = track(
      context.newString(
        JSON.stringify({ maxCapabilityCalls: ceilings.maxCapabilityCalls, maxInFlightCalls: ceilings.maxInFlightCalls }),
      ),
    );
    const installed = context.callFunction(preludeFn, context.undefined, hostCall, facadeJson, configJson);
    if (installed.error) {
      const error = context.dump(installed.error);
      installed.error.dispose();
      return failedOutcome(error);
    }
    const installedHandle = track(installed.value);
    const athenaHandle = track(context.getProp(installedHandle, "athena"));
    const serializeHandle = track(context.getProp(installedHandle, "serialize"));
    context.setProp(context.global, "athena", athenaHandle);

    const runnerSource = `(function (serialize) {\n${program}\nreturn ${AGENT_PROGRAM_ENTRY}().then(function (value) { return serialize(value, "result_not_serializable"); });\n})`;
    const runnerResult = context.evalCode(runnerSource, "athena-program.js", { type: "global" });
    if (runnerResult.error) {
      const error = context.dump(runnerResult.error);
      runnerResult.error.dispose();
      return failedOutcome(error);
    }
    const runnerFn = track(runnerResult.value);
    const programResult = context.callFunction(runnerFn, context.undefined, serializeHandle);
    if (programResult.error) {
      const error = context.dump(programResult.error);
      programResult.error.dispose();
      return failedOutcome(error);
    }
    const programPromise = track(programResult.value);

    // Drive the guest event loop: pending jobs, host settlements, deadline, cancellation.
    while (true) {
      if (failure || signal?.aborted) return failedOutcome(undefined);
      const jobs = runtime.executePendingJobs();
      if (jobs.error) {
        const error = context.dump(jobs.error);
        jobs.error.dispose();
        return failedOutcome(error);
      }
      if (failure || signal?.aborted) return failedOutcome(undefined);
      const state = context.getPromiseState(programPromise);
      if (state.type === "fulfilled") {
        const text = context.getString(state.value);
        state.value.dispose();
        if (stats.inFlight > 0) {
          return finalize({
            status: "failed",
            code: "detached_call",
            message: "Program finished while capability calls were still in flight.",
            diagnostics: diagnostics(memoryUsed()),
          });
        }
        const resultBytes = measureUtf8Bytes(text);
        stats.resultBytes = resultBytes;
        if (resultBytes > ceilings.maxResultBytes) {
          return finalize({
            status: "failed",
            code: "result_too_large",
            message: `Program result is ${resultBytes} bytes; the ceiling is ${ceilings.maxResultBytes}.`,
            diagnostics: diagnostics(memoryUsed()),
          });
        }
        const output = JSON.parse(text) as JsonValue;
        return finalize({ status: "completed", output, diagnostics: diagnostics(memoryUsed()) });
      }
      if (state.type === "rejected") {
        const error = context.dump(state.error);
        state.error.dispose();
        return failedOutcome(error);
      }
      // Pending: wait for a host settlement, the deadline, or cancellation.
      if (stats.inFlight === 0 && deferreds.size === 0) {
        return finalize({
          status: "failed",
          code: "stalled",
          message: "Program is waiting on something that can never settle.",
          diagnostics: diagnostics(memoryUsed()),
        });
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        interrupted = true;
        return finalize({
          status: "failed",
          code: "timeout",
          message: "Program exceeded the elapsed-time ceiling.",
          diagnostics: diagnostics(memoryUsed()),
        });
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        wakePromise,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, remaining);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const runtime: AgentProgramRuntime = {
    kind: AGENT_PROGRAM_RUNTIME_KIND_QUICKJS,
    startupMs: wasmLoadMs,
    execute: async (input: AgentProgramExecutionInput) => {
      const validation = validateProgramSource(input.source, {
        facade: input.bridge.facade,
        maxSourceBytes: input.ceilings.maxSourceBytes,
      });
      if (!validation.ok) return { status: "rejected", issues: validation.issues };
      return run(validation.source, validation.sourceBytes, input.bridge, input.ceilings, input.signal);
    },
    executeUnvalidated: async (input: AgentProgramExecutionInput) => {
      const program = `async function ${AGENT_PROGRAM_ENTRY}() {\n"use strict";\n${input.source}\n}`;
      return run(program, measureUtf8Bytes(input.source), input.bridge, input.ceilings, input.signal);
    },
  };
  return runtime;
}
