import {
  ATHENA_PR_VALIDATION_GATE_ID,
  HARNESS_GATE_REGISTRY,
  type HarnessGateId,
  type HarnessObligationId,
  type HarnessProviderId,
} from "./harness-gate-registry";

export const HARNESS_BLOCKER_SCHEMA_VERSION = 1 as const;

/**
 * Bound applied when a blocker is constructed, so the serialized envelope
 * and any retained log inherit it. The terminal renderer bounds further for
 * the screen; this cap is what stops a runaway provider report from being
 * kept in full.
 */
export const MAX_BLOCKER_DETAIL_LENGTH = 8_000;

export const HARNESS_COMMAND_IDS = [
  "architecture:check",
  "delivery:documentation-check",
  "delivery:telemetry-check",
  "graphify:check",
  "graphify:rebuild",
  "harness:audit",
  "harness:behavior",
  "harness:check",
  "harness:generate",
  "harness:inferential-review",
  "harness:janitor",
  "pr:athena:mechanical",
  "pr:athena:preflight",
  "harness:review",
  "harness:review-context",
  "harness:review-evidence",
  "harness:runtime-trends",
  "harness:scorecard",
  "harness:self-review",
  "harness:test",
  "harness:waive-documentation",
  "pre-push:review",
  "pr:athena",
  "pr:athena:delivery-run",
  "pr:athena:prepare",
  "pr:athena:validate-provider",
] as const;

export type HarnessCommandId = (typeof HARNESS_COMMAND_IDS)[number];
export type NonEmptyTuple<T> = readonly [T, ...T[]];
export type CommandArguments = NonEmptyTuple<string>;

export const HARNESS_PREPARATION_SOURCE_IDS = [
  "missing",
  "invalid",
  "stale",
  "base_changed",
  "wiring_mismatch",
  "candidate_unprepared",
  "candidate_ambiguous",
] as const;

export type HarnessPreparationSourceId =
  (typeof HARNESS_PREPARATION_SOURCE_IDS)[number];

export const HARNESS_CANDIDATE_SOURCE_IDS = [
  "candidate-capture",
  "candidate-drift",
] as const;

export type HarnessCandidateSourceId =
  (typeof HARNESS_CANDIDATE_SOURCE_IDS)[number];

export type HarnessBlockerSource =
  | { kind: "gate"; id: HarnessGateId }
  | { kind: "obligation"; id: HarnessObligationId }
  | { kind: "provider"; id: HarnessProviderId }
  | { kind: "preparation"; id: HarnessPreparationSourceId }
  | { kind: "candidate"; id: HarnessCandidateSourceId }
  | { kind: "command"; id: HarnessCommandId };

type RemediationBase = {
  /** Stable identity used to deduplicate repeated guidance. */
  id: string;
  summary: string;
  details?: string;
};

export type HarnessRemediation =
  | (RemediationBase & { kind: "command"; command: CommandArguments })
  | (RemediationBase & { kind: "manual_action" })
  | (RemediationBase & { kind: "code_change" })
  | (RemediationBase & { kind: "retry"; command?: CommandArguments });

export type HarnessBlocker = {
  code: string;
  source: HarnessBlockerSource;
  summary: string;
  details?: string;
  remediations: NonEmptyTuple<HarnessRemediation>;
};

export type SerializedHarnessBlockers = {
  schemaVersion: typeof HARNESS_BLOCKER_SCHEMA_VERSION;
  blockers: HarnessBlocker[];
};

export class HarnessBlockedError extends Error {
  constructor(
    readonly blockers: readonly HarnessBlocker[],
    message = "Harness command blocked.",
  ) {
    super(message);
    this.name = "HarnessBlockedError";
  }
}

/**
 * Tab and newline survive; every other C0/C1 control, the Unicode line and
 * paragraph separators, and the bidi overrides do not. Carriage return is
 * stripped deliberately: the terminal renderer is line-oriented, and a stray
 * CR lets diagnostic text overwrite the `[code]` and `Source:` lines an
 * operator relies on to identify who is blocking them.
 */
function withoutControlCharacters(value: string) {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "");
}

/**
 * Order matters here, and it is the whole reason this is a chain rather than a
 * set. Block-scoped rules run first: a PEM body arriving as
 * `SSH_PRIVATE_KEY=-----BEGIN ...` would otherwise have its header eaten by
 * the assignment rule, destroying the anchor the PEM rule needs and printing
 * the key material in full.
 *
 * The keyword rules are split by how specific the word is. `token`, `secret`
 * and `password` are credential words, so they redact standing alone. `key`
 * and `url` are ordinary English, so an uppercase env-style name or a dashed
 * flag has to vouch for them - otherwise "monkey=banana" loses its value and a
 * real diagnostic is destroyed, which fails an operator the same way a leak
 * fails a secret.
 */
function redactSecrets(value: string) {
  return (
    value
      // Paired PEM blocks, then a truncated one: killed providers emit a BEGIN
      // with no END, and the body is just as sensitive.
      .replace(
        /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/gi,
        "[REDACTED PRIVATE KEY]",
      )
      .replace(
        /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*/gi,
        "[REDACTED PRIVATE KEY]",
      )
      // Unambiguous provider prefixes: no context needed, no false positives.
      .replace(
        /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprse]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,})\b/g,
        "[REDACTED]",
      )
      .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED]")
      .replace(
        /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
        "[REDACTED]",
      )
      .replace(/\b(?:prod|dev):[a-z0-9-]+\|\S{16,}/gi, "[REDACTED]")
      .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
      .replace(
        /\b(bearer|token)[ \t]+([A-Za-z0-9._~+/-]{16,}=*)/gi,
        (match, label: string, candidate: string) =>
          // A run of hyphenated alphabetic words, with or without closing
          // punctuation, is prose: "token connection-refused-by-upstream."
          // must stay readable. Anything else is treated as a credential,
          // including a digit-free one.
          // Hyphenated prose, or an UPPER_SNAKE provider error code: both are
          // diagnostics an operator needs, and neither is a credential shape.
          /^[A-Za-z]+(?:-[A-Za-z]+)+[.,;:!?]?$|^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+[.,;:!?]?$/.test(
            candidate,
          )
            ? match
            : `${label} [REDACTED]`,
      )
      // Credential words, standing alone or prefixed, assigned with = or :.
      .replace(
        /((?:^|[\s"'`(\[{,?&;])-{0,2}(?:[A-Za-z0-9]+[_-])*(?:TOKEN|SECRET|PASSWORD)"?\s*[:=]\s*"?)(?!\[REDACTED)[^\s",}\])]+/gi,
        "$1[REDACTED]",
      )
      // camelCase config dumps: `apiKey=`, `accessToken=`. Case-sensitive on
      // the capital, so "monkey=" cannot match on the Key suffix.
      .replace(
        /((?:^|[\s"'`(\[{,?&;])[A-Za-z][A-Za-z0-9]*(?:Token|Secret|Password|Key)"?\s*[:=]\s*"?)(?!\[REDACTED)[^\s",}\])]+/g,
        "$1[REDACTED]",
      )
      // Ordinary words as an UPPERCASE env-style name.
      .replace(
        /((?:^|[\s"'`(\[{,?&;])(?:[A-Z0-9]+[_-])*(?:KEY|URL)"?\s*[:=]\s*"?)(?!\[REDACTED)[^\s",}\])]+/g,
        "$1[REDACTED]",
      )
      // Or as a dashed flag, where a separator has to precede the word so
      // `--api-key=` redacts and `--monkey=` does not.
      .replace(
        /((?:^|[\s"'`(\[{,?&;])-{1,2}[A-Za-z0-9-]*[-_](?:KEY|URL)"?\s*[:=]\s*"?)(?!\[REDACTED)[^\s",}\])]+/gi,
        "$1[REDACTED]",
      )
      // Userinfo with or without a password. The scheme run is bounded: an
      // unbounded one backtracks quadratically over a long alphanumeric line.
      .replace(/([a-z][a-z0-9+.-]{0,32}:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
  );
}

function bounded(value: string, maximum: number) {
  if (value.length <= maximum) return value;
  if (maximum <= 0) return "";
  // Walk code points rather than slicing units: a plain slice can cut a
  // surrogate pair in half and emit a lone surrogate just before the ellipsis.
  let truncated = "";
  for (const character of value) {
    if (truncated.length + character.length > maximum - 1) break;
    truncated += character;
  }
  return `${truncated}…`;
}

/**
 * Operator-facing summaries are single lines by construction. Collapsing
 * whitespace stops provider-supplied text from forging a second `Remediation:`
 * block, which would otherwise read as harness-authored guidance.
 */
function sanitizedLine(value: string, label: string) {
  // Redact before collapsing whitespace: the rules key off `=`, `:` and `://`,
  // and a summary is no less likely to carry provider text than a detail.
  const sanitized = redactSecrets(withoutControlCharacters(value))
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized) throw new Error(`${label} must be non-empty.`);
  return sanitized;
}

/**
 * Details keep their newlines - a stack or a provider report is unreadable as
 * one line - but are redacted and bounded here rather than at the renderer, so
 * the structured envelope can never retain more than the operator was shown.
 */
function sanitizedDetail(value: string) {
  // Pre-slice before redacting so a multi-megabyte provider report cannot make
  // the regex pass quadratic. The window is a generous multiple of the cap, so
  // a secret straddling the final cut is still scanned.
  const windowed = value.slice(0, MAX_BLOCKER_DETAIL_LENGTH * 8);
  const redacted = redactSecrets(withoutControlCharacters(windowed)).trim();
  // Bounded by code point, like the renderer: a raw slice can cut a surrogate
  // pair and leave a lone half in the stored and serialized detail.
  return bounded(redacted, MAX_BLOCKER_DETAIL_LENGTH);
}

/**
 * Derived ids have to satisfy the same kebab-case gate as authored ones. A
 * plain character substitution left doubled or trailing separators, which
 * would throw from inside the boundary's catch handler - the one place a
 * throw destroys the output it was meant to produce.
 */
function remediationIdFor(prefix: string, source: HarnessBlockerSource) {
  const slug = `${source.kind}-${source.id}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${slug}`;
}

function sanitizedCommand(command: CommandArguments): CommandArguments {
  const [first, ...rest] = command.map((argument) =>
    // Windowed like details: an unbounded argument spliced in from argv would
    // otherwise let the redaction pass run for minutes on a failure path.
    redactSecrets(
      withoutControlCharacters(
        argument.slice(0, MAX_BLOCKER_DETAIL_LENGTH * 8),
      ),
    ),
  );
  return [first as string, ...rest];
}

function sanitizedRemediation(remediation: HarnessRemediation) {
  sanitizedLine(remediation.id, "Harness remediation id");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(remediation.id)) {
    throw new Error(
      "Harness remediation id must be a stable kebab-case identifier.",
    );
  }
  if (
    (remediation.kind === "command" ||
      (remediation.kind === "retry" && remediation.command)) &&
    remediation.command.length === 0
  ) {
    throw new Error("Harness remediation command must be non-empty.");
  }
  return {
    ...remediation,
    summary: sanitizedLine(remediation.summary, "Harness remediation summary"),
    ...(remediation.details
      ? { details: sanitizedDetail(remediation.details) }
      : {}),
    // Several CLIs splice raw argv into their reproduce command, so arguments
    // are operator-facing text like everything else here: a CR in one would
    // overwrite the lines identifying who is blocking, and a `--token=` value
    // would be echoed and stored verbatim.
    ...("command" in remediation && remediation.command
      ? {
          command: sanitizedCommand(remediation.command),
        }
      : {}),
  };
}

/**
 * The type system already restricts these ids, but nothing typechecks
 * `scripts/`, so the discriminated union is a convention rather than a gate
 * until it is also checked at runtime. A free-form source id is exactly the
 * drift this contract exists to prevent, so it fails loudly at construction.
 */
function validatedSource(source: HarnessBlockerSource) {
  const registryOwned = (() => {
    switch (source?.kind) {
      case "gate":
        return source.id === ATHENA_PR_VALIDATION_GATE_ID;
      case "obligation":
        return Object.hasOwn(HARNESS_GATE_REGISTRY.obligations, source.id);
      case "provider":
        return Object.hasOwn(HARNESS_GATE_REGISTRY.providers, source.id);
      case "preparation":
        return (HARNESS_PREPARATION_SOURCE_IDS as readonly string[]).includes(
          source.id,
        );
      case "candidate":
        return (HARNESS_CANDIDATE_SOURCE_IDS as readonly string[]).includes(
          source.id,
        );
      case "command":
        return (HARNESS_COMMAND_IDS as readonly string[]).includes(source.id);
      default:
        return false;
    }
  })();
  if (!registryOwned) {
    throw new Error(
      `Harness blocker source ${String(source?.kind)}:${String(
        source?.id,
      )} is not registry-owned.`,
    );
  }
  return source;
}

/**
 * The single constructor every blocker passes through, so sanitization is a
 * property of the contract rather than something each call site has to
 * remember. It returns a normalized copy on purpose: validating the cleaned
 * text and then discarding it, as an earlier revision did, left the guarantee
 * documented but unenforced everywhere except the internal-error path.
 *
 * It returns `HarnessBlocker` rather than the caller's literal type on
 * purpose: the values really are rewritten here, and a `const` type parameter
 * would promise callers a `summary` string the function does not return.
 */
export function createHarnessBlocker(blocker: HarnessBlocker): HarnessBlocker {
  const code = sanitizedLine(blocker.code, "Harness blocker code");
  if (!/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(code)) {
    throw new Error(
      "Harness blocker code must be a stable lowercase identifier.",
    );
  }
  if (blocker.remediations.length === 0) {
    throw new Error("Harness blocker remediation must be non-empty.");
  }
  validatedSource(blocker.source);
  return {
    ...blocker,
    code,
    summary: sanitizedLine(blocker.summary, "Harness blocker summary"),
    ...(blocker.details ? { details: sanitizedDetail(blocker.details) } : {}),
    remediations: blocker.remediations.map(
      sanitizedRemediation,
    ) as unknown as HarnessBlocker["remediations"],
  };
}

export function serializeHarnessBlockers(
  blockers: readonly HarnessBlocker[],
): SerializedHarnessBlockers {
  return {
    schemaVersion: HARNESS_BLOCKER_SCHEMA_VERSION,
    blockers: blockers.map((blocker) => structuredClone(blocker)),
  };
}

function quoteCommandArgument(value: string) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function formatHarnessCommand(command: readonly string[]) {
  return command.map(quoteCommandArgument).join(" ");
}


function remediationInstruction(remediation: HarnessRemediation) {
  const command =
    remediation.kind === "command" ||
    (remediation.kind === "retry" && remediation.command)
      ? ` Command: ${formatHarnessCommand(remediation.command)}`
      : "";
  const details = remediation.details ? ` ${remediation.details}` : "";
  return `- (${remediation.id}) ${remediation.summary}${command}${details}`;
}

export function remediationBody(remediation: HarnessRemediation) {
  return JSON.stringify({
    kind: remediation.kind,
    summary: remediation.summary,
    details: remediation.details ?? null,
    command: "command" in remediation ? remediation.command : null,
  });
}

/**
 * Deduplicates on the whole remediation, not on its id alone.
 *
 * Identical guidance collapses, which is the point of a stable id. Divergent
 * guidance under one id is kept rather than dropped or thrown on: this runs
 * inside `runHarnessCliBoundary`'s catch handler, so a throw here would
 * discard every blocker and leave the operator a bare stack at exactly the
 * moment the contract exists to deliver guidance. Rendering is total; the
 * inventory sensor enforces id discipline statically, where failing loudly is
 * the right outcome.
 */
export function uniqueHarnessRemediations(blockers: readonly HarnessBlocker[]) {
  const seen = new Set<string>();
  return blockers.flatMap((blocker) =>
    blocker.remediations.filter((remediation) => {
      const key = `${remediation.id}\u0000${remediationBody(remediation)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

export function formatHarnessBlockers(
  blockers: readonly HarnessBlocker[],
  options: { maxDetailLength?: number; maxOutputLength?: number } = {},
) {
  if (blockers.length === 0) return "";
  const maxDetailLength = options.maxDetailLength ?? 600;
  const maxOutputLength = options.maxOutputLength ?? 12_000;
  const remediations = uniqueHarnessRemediations(blockers);
  const remediationText =
    remediations.length > 0
      ? ["Remediation:", ...remediations.map(remediationInstruction)].join("\n")
      : "";
  // Remediation claims its budget before the diagnostic body. Bounding the
  // joined string instead, as an earlier revision did, let a few verbose
  // blockers push the guidance off the end - silently removing the one thing
  // this contract exists to deliver.
  if (remediationText.length >= maxOutputLength) {
    return bounded(remediationText, maxOutputLength);
  }
  const bodyBudget = remediationText
    ? maxOutputLength - remediationText.length - 1
    : maxOutputLength;
  const body = bounded(
    blockers
      .flatMap((blocker) => [
        `[${blocker.code}] ${blocker.summary}`,
        `  Source: ${blocker.source.kind}:${blocker.source.id}`,
        ...(blocker.details
          ? [
              `  Details: ${bounded(blocker.details, maxDetailLength).replaceAll("\n", "\n    ")}`,
            ]
          : []),
      ])
      .join("\n"),
    bodyBudget,
  );
  if (!remediationText) return body;
  return body ? `${body}\n${remediationText}` : remediationText;
}

function formatUnexpectedError(error: unknown, depth = 0): string {
  if (!(error instanceof Error)) return String(error);
  const base = error.stack || `${error.name}: ${error.message}`;
  if (error.cause === undefined || depth >= 3) return base;
  return `${base}\nCaused by: ${formatUnexpectedError(error.cause, depth + 1)}`;
}

export function createHarnessInternalErrorBlocker(input: {
  source: HarnessBlockerSource;
  error: unknown;
  reproduce: CommandArguments;
  retainedLogPath?: string;
}) {
  // The stack is the diagnostic on this path: an unexpected TypeError with only
  // its message names no file or line, and wrapped fs/exec failures keep the
  // real reason on `cause`. Both are sanitized and bounded by the constructor.
  const rawDetail = formatUnexpectedError(input.error);
  const details = rawDetail || "Unknown internal error.";
  return createHarnessBlocker({
    code: "harness_internal_error",
    source: input.source,
    summary: "The harness encountered an unexpected internal error.",
    details,
    remediations: [
      {
        id: remediationIdFor("reproduce", input.source),
        kind: "command",
        command: input.reproduce,
        summary: "Reproduce the failure with the authoritative command.",
      },
      {
        id: "inspect-harness-log",
        kind: "manual_action",
        summary: input.retainedLogPath
          ? `Inspect the retained harness log at ${input.retainedLogPath}.`
          : "Inspect the complete harness output or retained log before retrying.",
      },
    ],
  });
}

export const HARNESS_USAGE_ERROR_CODE = "harness_usage_error";

/**
 * A bad flag or malformed invocation is an expected outcome of a CLI that
 * parses arguments, not a crash. Thrown bare from a parser, it reached the CLI
 * boundary as `harness_internal_error` with a stack - the form the contract
 * reserves for genuinely unexpected exceptions - and the operator had to read
 * source to learn which flags exist.
 */
export function createHarnessUsageErrorBlocker(input: {
  source: HarnessBlockerSource;
  message: string;
  validFlags: readonly string[];
}): HarnessBlocker {
  return createHarnessBlocker({
    code: HARNESS_USAGE_ERROR_CODE,
    source: input.source,
    summary: input.message,
    remediations: [
      {
        id: remediationIdFor("rerun-with-supported-flags", input.source),
        kind: "manual_action",
        summary: `Rerun with supported flags: ${input.validFlags.join(", ")}.`,
      },
    ],
  });
}

/**
 * Extends HarnessBlockedError on purpose: several CLIs (harness:review,
 * harness:behavior, harness:review-evidence) wrap every non-contract throw in
 * their own blocked blocker, and a usage error must survive that wrapping
 * unchanged rather than being reclassified as a domain block. The invocation
 * message stays the Error message so existing diagnostics keep reading true.
 */
export class HarnessUsageError extends HarnessBlockedError {
  constructor(input: {
    source: HarnessBlockerSource;
    message: string;
    validFlags: readonly string[];
  }) {
    super([createHarnessUsageErrorBlocker(input)], input.message);
    this.name = "HarnessUsageError";
  }
}

export async function runHarnessCliBoundary(input: {
  source: HarnessBlockerSource;
  reproduce: CommandArguments;
  run: () => void | number | Promise<void | number>;
  retainedLogPath?: string;
  logger?: Pick<Console, "error">;
  renderNonZero?: boolean;
}): Promise<number> {
  try {
    const result = await input.run();
    if (typeof result !== "number" || result === 0) return 0;
    if (input.renderNonZero ?? true) {
      const blocker = createHarnessBlocker({
        code: "harness_command_failed",
        source: input.source,
        summary: `The harness command exited with code ${result}.`,
        remediations: [
          {
            id: remediationIdFor("rerun", input.source),
            kind: "command",
            command: input.reproduce,
            summary:
              "Rerun the command after addressing its reported findings.",
          },
        ],
      });
      (input.logger ?? console).error(formatHarnessBlockers([blocker]));
    }
    return result;
  } catch (error) {
    const blockers =
      error instanceof HarnessBlockedError
        ? error.blockers
        : [
            createHarnessInternalErrorBlocker({
              source: input.source,
              error,
              reproduce: input.reproduce,
              retainedLogPath: input.retainedLogPath,
            }),
          ];
    (input.logger ?? console).error(formatHarnessBlockers(blockers));
    return 1;
  }
}
