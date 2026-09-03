---
title: Wrapping a CLI behind a bun run script needs an env-var payload channel
date: 2026-09-02
category: harness
module: root scripts
problem_type: tooling_decision
component: tooling
resolution_type: tooling_addition
severity: medium
applies_when:
  - "Exposing a third-party CLI to agents as a `bun run` script"
  - "Any argument that is JSON, or that contains braces, commas, spaces, or globs"
  - "The CLI offers a stdin payload path as an alternative to a flag"
tags: [bun, cli-wrapper, run-events, delivery-harness, argument-passing]
delivery_diff_fingerprint: 1e625455089f49bbc138ada7bab657a53e8da980933d62d3140c797479d0dd60
---

# Wrapping a CLI behind a bun run script needs an env-var payload channel

## Problem

Athena's run-event command has to hand the delivery harness CLI a JSON payload.
The obvious spelling — `bun run delivery:emit -- run.started --json '{"host":"claude-code"}'` —
loses the payload before the CLI ever parses it, and the CLI's documented stdin
alternative fails outright under bun.

## Solution

Pass the payload in an environment variable and let a thin wrapper script hand
it to the CLI through an argv array, where no shell can touch it:

```ts
// scripts/delivery-emit.ts
export function buildEmitArgs(argv: readonly string[], payload: string | undefined) {
  if (argv.includes("--json")) throw new Error(`The payload travels in ${PAYLOAD_ENV_VAR}, not in --json.`);
  return ["emit", ...argv, "--json", payload?.trim() || "{}"];
}
// ...
Bun.spawn(["bun", entry, ...args], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
```

The command is then `DELIVERY_EVENT='<json>' bun run delivery:emit -- <kind>`.
The outer shell owns the quoting, so the JSON reaches the wrapper intact.

Reject a caller-supplied `--json` rather than appending a second one: the
harness CLI's parser is last-wins, so a wrapper that appends its own flag
discards the caller's payload. When the environment variable also holds a valid
payload the command still exits 0, having recorded the wrong object — the
failure the caller can never see. When it holds nothing the CLI refuses the
resulting `{}` for its missing members and exits 1, which is loud but blames the
wrong input.

## Why This Matters

Two independent failures hide behind the obvious spelling:

1. `bun run <script> -- <args>` concatenates the trailing arguments into a
   string it hands to `/bin/bash -c`. Original quoting is gone by then, so
   `{"a":1,"b":2}` is brace-expanded into two words and the CLI reports
   `emit takes one kind`. Anything with braces, commas, spaces, or glob
   characters is affected, not just JSON.
2. The harness CLI accepts the payload on stdin, but reading stdin under bun
   leaves the process unable to `stat` a file handle it opens immediately
   afterwards, so the run store fails with `SystemError: Bad file descriptor`.
   The same command works when `--json` is supplied and stdin is never read.

Both failures are quiet in the wrong way: the first reports a usage error that
points at the kind rather than the payload, and the second reports an internal
error inside a dependency. Neither names the shell or the runtime as the cause.

## Prevention

- Never route a structured argument through `bun run <script> -- <args>`. Put it
  in an environment variable and forward it with `Bun.spawn(["cmd", ...args])`,
  which takes an argv array and spawns no shell.
- Prove a wrapper by running it, not by reading it. A one-line smoke invocation
  catches both failures above immediately; neither is visible to a unit test of
  the argument builder.
- Keep the wrapper's own diagnostics distinguishable from the CLI's. Athena's
  wrapper exits 2 for its own usage errors, matching the harness CLI's exit
  policy, and forwards the child's exit code verbatim otherwise.

## Examples

Before — payload destroyed by brace expansion:

```
$ bun run delivery:emit -- decision.recorded --json '{"fork":"x","choice":"y"}'
$ bun ... emit decision.recorded --json {"fork":"x","choice":"y"}
emit takes one kind.
```

After — payload arrives whole:

```
$ DELIVERY_EVENT='{"fork":"branch name","choice":"codex/..."}' bun run delivery:emit -- decision.recorded
emitted decision.recorded seq 3 to run run-c328c5fe25f8a66a
```

## Related

- `scripts/delivery-emit.ts` and its test
- Root `AGENTS.md` > `skills`, which declares the run-event command
