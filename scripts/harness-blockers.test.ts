import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  createHarnessBlocker,
  createHarnessInternalErrorBlocker,
  formatHarnessBlockers,
  HARNESS_PREPARATION_SOURCE_IDS,
  HarnessBlockedError,
  runHarnessCliBoundary,
  serializeHarnessBlockers,
  type HarnessBlocker,
} from "./harness-blockers";

describe("harness blockers", () => {
  // Credential-shaped fixtures are assembled from parts rather than written as
  // literals. The values are fake, but a literal that matches a real provider
  // pattern trips the repository's secret scanner on every future PR touching
  // this file. The assembled value is byte-identical to what the rule sees.
  const part = (...pieces: string[]) => pieces.join("");
  const GH_PAT = part("ghp", "_", "ABCDEFGHIJKLMNOPQRSTUV012345");
  const GH_PAT_QUERY = part("ghp", "_", "abcdefghijklmnopqrst");
  const GH_PAT_REMOTE = part("ghp", "_", "examplecredential");
  const GH_PAT_BRACKETED = part("ghp", "_", "secretvalue");
  const AWS_KEY_ID = part("ASIA", "IOSFODNN7EXAMPLE");
  const AWS_SECRET = part("wJalrXUtnFEMIK", "7MDENG");
  const OPENAI_KEY = part("sk", "-", "ABCDEFGHIJKLMNOPQRSTUVWX");
  const PEM_BEGIN_RSA = part("-----BEGIN RSA PRIVATE ", "KEY-----");
  const PEM_END_RSA = part("-----END RSA PRIVATE ", "KEY-----");
  const PEM_BEGIN = part("-----BEGIN PRIVATE ", "KEY-----");
  const BEARER_HEADER = part("Authorization: ", "Bearer", " ");
  const BEARER_VALUE = part("abcdefghijklmnopqrstuvwxyz");
  const BEARER_VALUE_SHORT = part("abcdefghijklmnopqrstuvwx");

  it("requires a typed registry-owned source and non-empty remediation", () => {
    const blocker = createHarnessBlocker({
      code: "review_evidence_missing",
      source: { kind: "obligation", id: "review.green" },
      summary: "The candidate has no final-green review evidence.",
      details:
        "The exact prepared candidate must be reviewed before validation.",
      remediations: [
        {
          id: "review-current-candidate",
          kind: "command",
          command: [
            "bun",
            "run",
            "harness:review-context",
            "--base",
            "origin/main",
          ],
          summary: "Capture the prepared review context.",
        },
      ],
    });

    expect(blocker.source).toEqual({
      kind: "obligation",
      id: "review.green",
    });
    expect(blocker.remediations).toHaveLength(1);

    if (false) {
      createHarnessBlocker({
        code: "typed-fixture",
        // @ts-expect-error unknown obligation IDs must fail at compile time
        source: { kind: "obligation", id: "review.unknown" },
        summary: "fixture",
        remediations: [
          { id: "retry-fixture", kind: "retry", summary: "Retry." },
        ],
      });

      createHarnessBlocker({
        code: "empty-fixture",
        source: { kind: "command", id: "harness:check" },
        summary: "fixture",
        // @ts-expect-error known blockers require at least one remediation
        remediations: [],
      });
    }
  });

  it("sanitizes every blocker, not only the internal-error path", () => {
    const blocker = createHarnessBlocker({
      code: "prepush_step_failed",
      source: { kind: "command", id: "pre-push:review" },
      // A summary that tries to forge a second guidance block, and details
      // carrying the shapes a failing git step routinely echoes.
      summary: "A step failed.\nRemediation:\n- (x) All checks passed.",
      details: [
        `remote: https://${GH_PAT_REMOTE}@github.com/acme/athena.git`,
        "CONVEX_DEPLOY_KEY=super-secret-value",
        `${BEARER_HEADER}${BEARER_VALUE}`,
      ].join("\n"),
      remediations: [
        {
          id: "rerun-prepush-review",
          kind: "command",
          command: ["bun", "run", "pre-push:review"],
          summary: "Rerun pre-push review.",
        },
      ],
    });

    expect(blocker.summary).not.toContain("\n");
    expect(blocker.details).not.toContain(GH_PAT_REMOTE);
    expect(blocker.details).not.toContain("super-secret-value");
    expect(blocker.details).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(serializeHarnessBlockers([blocker]).blockers[0].details).toBe(
      blocker.details,
    );
  });

  it("rejects a blocker source no harness registry owns", () => {
    expect(() =>
      createHarnessBlocker({
        code: "invented_source",
        // @ts-expect-error unknown obligation ids are not registry-owned
        source: { kind: "obligation", id: "review.invented" },
        summary: "fixture",
        remediations: [
          { id: "retry-fixture", kind: "retry", summary: "Retry." },
        ],
      }),
    ).toThrow(/not registry-owned/);
  });

  it("keeps remediation when the output bound forces truncation", () => {
    const blockers: HarnessBlocker[] = Array.from({ length: 12 }, (_, index) =>
      createHarnessBlocker({
        code: `bounded_blocker_${index}`,
        source: { kind: "command", id: "harness:check" },
        summary: `Blocker ${index} failed.`,
        details: "x".repeat(1_000),
        remediations: [
          {
            id: `repair-${index}`,
            kind: "command",
            command: ["bun", "run", "harness:generate"],
            summary: `Repair blocker ${index}.`,
          },
        ],
      }),
    );

    const output = formatHarnessBlockers(blockers, { maxOutputLength: 2_000 });

    expect(output.length).toBeLessThanOrEqual(2_000);
    // Guidance is the point of the contract, so it survives the bound even
    // when the diagnostic body does not.
    for (let index = 0; index < 12; index += 1) {
      expect(output).toContain(`repair-${index}`);
    }
  });

  it("keeps divergent guidance under one id instead of throwing mid-render", () => {
    const blockers: HarnessBlocker[] = [
      createHarnessBlocker({
        code: "first_blocker",
        source: { kind: "preparation", id: "stale" },
        summary: "Stale receipt.",
        remediations: [
          { id: "run-prepare", kind: "manual_action", summary: "Prepare." },
        ],
      }),
      createHarnessBlocker({
        code: "second_blocker",
        source: { kind: "candidate", id: "candidate-drift" },
        summary: "Candidate drifted.",
        remediations: [
          {
            id: "run-prepare",
            kind: "manual_action",
            summary: "Prepare and evaluate again.",
          },
        ],
      }),
    ];

    // This runs inside runHarnessCliBoundary's catch handler, so throwing here
    // would discard every blocker and leave a bare stack at exactly the moment
    // the contract exists to deliver guidance. Rendering stays total and
    // lossless; the inventory sensor enforces id discipline statically.
    const output = formatHarnessBlockers(blockers);

    expect(output).toContain("Prepare.");
    expect(output).toContain("Prepare and evaluate again.");
    expect(output).toContain("first_blocker");
    expect(output).toContain("second_blocker");
  });

  it("still collapses a genuinely identical remediation to one line", () => {
    const shared = {
      id: "run-prepare",
      kind: "manual_action" as const,
      summary: "Prepare the candidate again.",
    };
    const blockers: HarnessBlocker[] = [
      createHarnessBlocker({
        code: "first_blocker",
        source: { kind: "preparation", id: "stale" },
        summary: "Stale receipt.",
        remediations: [shared],
      }),
      createHarnessBlocker({
        code: "second_blocker",
        source: { kind: "candidate", id: "candidate-drift" },
        summary: "Candidate drifted.",
        remediations: [shared],
      }),
    ];

    expect(
      formatHarnessBlockers(blockers).match(/run-prepare/g),
    ).toHaveLength(1);
  });

  it("renders command argument arrays safely without storing a shell string", () => {
    const blocker = createHarnessBlocker({
      code: "command-arguments",
      source: { kind: "command", id: "harness:behavior" },
      summary: "The runtime scenario failed.",
      remediations: [
        {
          id: "rerun-runtime-scenario",
          kind: "command",
          command: [
            "bun",
            "run",
            "harness:behavior",
            "--scenario",
            "checkout path",
            "quote'fixture",
          ],
          summary: "Rerun the scenario.",
        },
      ],
    });

    expect(formatHarnessBlockers([blocker])).toContain(
      "bun run harness:behavior --scenario 'checkout path' 'quote'\\''fixture'",
    );
    expect(blocker.remediations[0]).toMatchObject({
      kind: "command",
      command: expect.any(Array),
    });
  });

  it("redacts credential assignments without eating ordinary prose", () => {
    const detail = (text: string) =>
      createHarnessBlocker({
        code: "redaction_precision",
        source: { kind: "command", id: "harness:check" },
        summary: "A check blocked.",
        details: text,
        remediations: [
          { id: "inspect-detail", kind: "manual_action", summary: "Inspect." },
        ],
      }).details;

    expect(detail("GITHUB_TOKEN=leak123")).toBe("GITHUB_TOKEN=[REDACTED]");
    expect(detail("--api-key=abc123")).toBe("--api-key=[REDACTED]");
    expect(detail("CONVEX_DEPLOY_KEY=secretvalue")).toBe(
      "CONVEX_DEPLOY_KEY=[REDACTED]",
    );
    // The keyword has to be a whole segment. Matching it inside a word made
    // the case-insensitive rule redact prose on the KEY substring.
    expect(detail("monkey=banana")).toBe("monkey=banana");
    expect(detail("hotkey=ctrl")).toBe("hotkey=ctrl");
    expect(detail("--base=origin/main")).toBe("--base=origin/main");
    // `key` and `url` are ordinary words: they need a flag dash or a prefix
    // segment before they read as a credential.
    expect(detail("the key=value pair")).toBe("the key=value pair");
    expect(detail("url=weird")).toBe("url=weird");
    // A bare strong keyword still redacts.
    expect(detail("token=abc123")).toBe("token=[REDACTED]");
    expect(detail("DATABASE_URL=postgres://u:p@h/db")).toBe(
      "DATABASE_URL=[REDACTED]",
    );
    // A digit-free bearer credential is still caught, while a hyphenated
    // diagnostic phrase after the word "token" survives.
    expect(detail(`${part("bearer", " ")}${BEARER_VALUE_SHORT}`)).toBe(
      "bearer [REDACTED]",
    );
    // A PEM arriving as an assignment: the block rule has to claim it before
    // the assignment rule eats the BEGIN marker it anchors on.
    expect(
      detail(
        `env SSH_PRIVATE_KEY=${PEM_BEGIN_RSA}\nMIIEsecretmaterial1234\n${PEM_END_RSA}`,
      ),
    ).toBe("env SSH_PRIVATE_KEY=[REDACTED PRIVATE KEY]");
    // A killed provider emits a BEGIN with no END; the body is just as
    // sensitive.
    expect(detail(`${PEM_BEGIN}\nMIIsecretbody`)).toBe(
      "[REDACTED PRIVATE KEY]",
    );
    // Shapes a child process actually prints: JSON, a colon separator, and a
    // camelCase config dump.
    expect(detail(`{"GITHUB_TOKEN":"${GH_PAT}"}`)).toBe(
      '{"GITHUB_TOKEN":"[REDACTED]"}',
    );
    expect(detail(`GITHUB_TOKEN: ${GH_PAT}`)).toBe(
      "GITHUB_TOKEN: [REDACTED]",
    );
    expect(detail(`apiKey=${OPENAI_KEY}`)).toBe(
      "apiKey=[REDACTED]",
    );
    expect(detail(AWS_KEY_ID)).toBe("[REDACTED]");
    // A quoted JSON key puts a `"` between the name and the separator, which
    // the keyword rules would otherwise refuse to cross.
    expect(detail('{"DB_PASSWORD":"hunter2secret"}')).toBe(
      '{"DB_PASSWORD":"[REDACTED]"}',
    );
    expect(detail('"password" : "hunter2"')).toBe('"password" : "[REDACTED]"');
    expect(detail('{"scenario":"checkout"}')).toBe('{"scenario":"checkout"}');
    // A dashed flag needs a separator before the ordinary word.
    expect(detail("--monkey=banana")).toBe("--monkey=banana");
    // A credential in a failing request URL, a bracketed env dump, a spaced
    // separator, and a colon separator are all ordinary harness output.
    expect(detail(`GET https://h/v1/x?token=${GH_PAT_QUERY}&page=2`)).toBe(
      "GET https://h/v1/x?token=[REDACTED]&page=2",
    );
    expect(detail(`(GITHUB_TOKEN=${GH_PAT_BRACKETED})`)).toBe(
      "(GITHUB_TOKEN=[REDACTED])",
    );
    expect(detail("TOKEN = abc123")).toBe("TOKEN = [REDACTED]");
    expect(detail("password: hunter2")).toBe("password: [REDACTED]");
    // An UPPER_SNAKE provider error code is a diagnostic, not a credential.
    expect(detail("Received token EXPIRED_SIGNATURE from provider")).toBe(
      "Received token EXPIRED_SIGNATURE from provider",
    );
    expect(detail("token refresh-failed-after-three-retries")).toBe(
      "token refresh-failed-after-three-retries",
    );
    // Closing punctuation must not turn a prose phrase back into a "secret".
    expect(detail("token connection-refused-by-upstream.")).toBe(
      "token connection-refused-by-upstream.",
    );
    expect(detail("token missing-remediation-for-gate, see docs")).toBe(
      "token missing-remediation-for-gate, see docs",
    );
  });

  it("redacts the summary, not only the details", () => {
    const blocker = createHarnessBlocker({
      code: "summary_redaction",
      source: { kind: "command", id: "pr:athena:delivery-run" },
      // One call site interpolates raw argv into a summary, so the guarantee
      // has to hold here and not only on the details path.
      summary:
        `provider failed: GITHUB_TOKEN=${GH_PAT}`,
      remediations: [
        {
          id: "inspect-provider",
          kind: "manual_action",
          summary: `see AWS_SECRET_ACCESS_KEY=${AWS_SECRET}`,
        },
      ],
    });

    expect(blocker.summary).toBe("provider failed: GITHUB_TOKEN=[REDACTED]");
    expect(blocker.remediations[0]?.summary).toBe(
      "see AWS_SECRET_ACCESS_KEY=[REDACTED]",
    );
  });

  it("sanitizes remediation command arguments as operator-facing text", () => {
    const blocker = createHarnessBlocker({
      code: "argv_sanitized",
      source: { kind: "command", id: "harness:self-review" },
      summary: "A self-review check blocked.",
      remediations: [
        {
          id: "rerun-with-argv",
          kind: "command",
          // Several CLIs splice raw argv into their reproduce command.
          command: [
            "bun",
            "run",
            "harness:self-review",
            "--token=abcdef0123456789xyz",
            "arg\rwith-cr",
          ],
          summary: "Rerun with the original arguments.",
        },
      ],
    });

    const [remediation] = blocker.remediations;
    const command =
      remediation && "command" in remediation ? remediation.command : [];

    expect(command).toHaveLength(5);
    expect(command[3]).toBe("--token=[REDACTED]");
    expect(command[4]).toBe("argwith-cr");
    expect(formatHarnessBlockers([blocker])).not.toContain(
      "abcdef0123456789xyz",
    );
  });

  it("truncates by code point so no lone surrogate is ever emitted", () => {
    const blocker = createHarnessBlocker({
      code: "astral_detail",
      source: { kind: "command", id: "harness:check" },
      summary: "A check blocked.",
      details: "\u{1F600}".repeat(500),
      remediations: [
        { id: "inspect-detail", kind: "manual_action", summary: "Inspect." },
      ],
    });

    for (const maxOutputLength of [1, 7, 33, 120, 400]) {
      const output = formatHarnessBlockers([blocker], { maxOutputLength });
      expect(output.length).toBeLessThanOrEqual(maxOutputLength);
      for (let index = 0; index < output.length; index += 1) {
        const unit = output.charCodeAt(index);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = output.charCodeAt(index + 1);
          expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
          index += 1;
        } else {
          expect(unit >= 0xdc00 && unit <= 0xdfff).toBe(false);
        }
      }
    }
  });

  it("bounds the stored detail by code point, not by UTF-16 unit", () => {
    const blocker = createHarnessBlocker({
      code: "astral_stored_detail",
      source: { kind: "command", id: "harness:check" },
      summary: "A check blocked.",
      // Long enough to be cut by the construction-time cap.
      details: "\u{1F600}".repeat(9_000),
      remediations: [
        { id: "inspect-detail", kind: "manual_action", summary: "Inspect." },
      ],
    });

    const stored = serializeHarnessBlockers([blocker]).blockers[0]?.details ?? "";
    const last = stored.charCodeAt(stored.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });

  it("normalizes derived remediation ids instead of throwing mid-render", () => {
    // The id is derived from the source, and a plain character substitution
    // left doubled or trailing separators that failed the kebab-case gate -
    // throwing from inside the boundary's own catch handler.
    const blocker = createHarnessInternalErrorBlocker({
      source: { kind: "obligation", id: "review.green" },
      error: new Error("boom"),
      reproduce: ["bun", "run", "pr:athena"],
    });

    expect(blocker.remediations[0]?.id).toBe("reproduce-obligation-review-green");
    for (const remediation of blocker.remediations) {
      expect(remediation.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("deduplicates remediation by stable ID in first-seen order", () => {
    const shared = {
      id: "run-prepare",
      kind: "command" as const,
      command: ["bun", "run", "pr:athena:prepare"] as const,
      summary: "Prepare the candidate again.",
    };
    const blockers: HarnessBlocker[] = [
      createHarnessBlocker({
        code: "candidate-stale",
        source: { kind: "candidate", id: "candidate-drift" },
        summary: "The candidate changed.",
        remediations: [shared],
      }),
      createHarnessBlocker({
        code: "preparation-stale",
        source: { kind: "preparation", id: "stale" },
        summary: "The preparation receipt is stale.",
        remediations: [
          shared,
          {
            id: "inspect-diff",
            kind: "manual_action",
            summary: "Inspect the candidate diff.",
          },
        ],
      }),
    ];

    const output = formatHarnessBlockers(blockers);
    expect(output.match(/run-prepare/g)).toHaveLength(1);
    expect(output.indexOf("run-prepare")).toBeLessThan(
      output.indexOf("inspect-diff"),
    );
  });

  it("derives structured and terminal output from the same blocker objects", () => {
    const blocker = createHarnessBlocker({
      code: "documentation-current",
      source: { kind: "provider", id: "delivery-documentation-check" },
      summary: "Delivery documentation is incomplete.",
      remediations: [
        {
          id: "repair-documentation",
          kind: "code_change",
          summary: "Update the required delivery documentation.",
        },
      ],
    });

    expect(formatHarnessBlockers([blocker])).toContain(blocker.code);
    expect(serializeHarnessBlockers([blocker])).toEqual({
      schemaVersion: 1,
      blockers: [blocker],
    });
  });

  it("maps unexpected exceptions to a stable sanitized internal blocker", () => {
    const blocker = createHarnessInternalErrorBlocker({
      source: { kind: "command", id: "pr:athena:prepare" },
      error: new Error("disk\u0000 unavailable\nsecret detail"),
      reproduce: ["bun", "run", "pr:athena:prepare"],
    });

    expect(blocker.code).toBe("harness_internal_error");
    // The stack is the diagnostic on this path, so it is retained rather than
    // reduced to the message - but the control character is still stripped.
    expect(blocker.details).toContain("disk unavailable");
    expect(blocker.details).toContain("secret detail");
    expect(blocker.details).not.toContain("\u0000");
    expect(blocker.details).toMatch(/^Error: /);
    expect(blocker.remediations).toHaveLength(2);
  });

  it("retains the cause chain of an unexpected exception", () => {
    const blocker = createHarnessInternalErrorBlocker({
      source: { kind: "command", id: "pr:athena:prepare" },
      error: new Error("outer failure", {
        cause: new Error("underlying spawn failure"),
      }),
      reproduce: ["bun", "run", "pr:athena:prepare"],
    });

    expect(blocker.details).toContain("outer failure");
    expect(blocker.details).toContain("Caused by:");
    expect(blocker.details).toContain("underlying spawn failure");
    expect(blocker.remediations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "command",
          command: ["bun", "run", "pr:athena:prepare"],
        }),
        expect.objectContaining({ kind: "manual_action" }),
      ]),
    );
  });

  it("bounds terminal details while serialization retains the full sanitized detail", () => {
    const details = "x".repeat(2_000);
    const blocker = createHarnessBlocker({
      code: "bounded-output",
      source: { kind: "command", id: "pre-push:review" },
      summary: "Pre-push review failed.",
      details,
      remediations: [
        {
          id: "inspect-retained-log",
          kind: "manual_action",
          summary: "Inspect the retained log.",
        },
      ],
    });

    expect(formatHarnessBlockers([blocker], { maxDetailLength: 80 })).toContain(
      `${"x".repeat(79)}…`,
    );
    expect(serializeHarnessBlockers([blocker]).blockers[0].details).toBe(
      details,
    );
  });

  it("redacts common secret-bearing diagnostics and bounds total terminal output", () => {
    const blocker = createHarnessInternalErrorBlocker({
      source: { kind: "command", id: "pr:athena:prepare" },
      error: new Error(
        `${BEARER_HEADER}super-secret\nDATABASE_URL=postgres://user:password@example.test/db\n${"detail ".repeat(500)}`,
      ),
      reproduce: ["bun", "run", "pr:athena:prepare"],
    });

    expect(blocker.details).not.toContain("super-secret");
    expect(blocker.details).not.toContain("user:password");
    expect(
      formatHarnessBlockers([blocker], { maxOutputLength: 240 }).length,
    ).toBeLessThanOrEqual(240);
  });

  it("has a producer for every preparation blocker source", async () => {
    // The union is meant to describe the boundaries that actually exist, so
    // every id must be named at a site that produces a preparation blocker.
    // The only producers are the receipt evaluation in pr-athena-prepare.ts
    // and the candidate capture it delegates to.
    const producerText = (
      await Promise.all(
        ["pr-athena-prepare.ts", "harness-candidate.ts"].map((file) =>
          readFile(new URL(`./${file}`, import.meta.url), "utf8"),
        ),
      )
    ).join("\n");
    const orphaned = HARNESS_PREPARATION_SOURCE_IDS.filter(
      (id) => !producerText.includes(`"${id}"`),
    );

    expect(orphaned).toEqual([]);
  });

  it("rejects unstable blocker and remediation identifiers", () => {
    expect(() =>
      createHarnessBlocker({
        code: "Not Stable",
        source: { kind: "command", id: "harness:check" },
        summary: "fixture",
        remediations: [
          { id: "also not stable", kind: "retry", summary: "Retry." },
        ],
      }),
    ).toThrow(/stable lowercase/);
  });

  it("renders known blockers once and maps unexpected exceptions at a CLI boundary", async () => {
    const output: string[] = [];
    const known = createHarnessBlocker({
      code: "known_failure",
      source: { kind: "command", id: "harness:test" },
      summary: "Known failure.",
      remediations: [
        {
          id: "rerun-tests",
          kind: "command",
          command: ["bun", "run", "harness:test"],
          summary: "Rerun tests.",
        },
      ],
    });
    expect(
      await runHarnessCliBoundary({
        source: { kind: "command", id: "harness:test" },
        reproduce: ["bun", "run", "harness:test"],
        run: async () => {
          throw new HarnessBlockedError([known]);
        },
        logger: { error: (message) => output.push(message) },
      }),
    ).toBe(1);
    expect(output).toHaveLength(1);
    expect(output[0]).toContain("known_failure");
  });

  it("turns an expected non-zero command result into a typed blocker", async () => {
    const output: string[] = [];
    expect(
      await runHarnessCliBoundary({
        source: { kind: "command", id: "harness:janitor" },
        reproduce: ["bun", "run", "harness:janitor"],
        run: async () => 7,
        logger: { error: (message) => output.push(message) },
      }),
    ).toBe(7);
    expect(output).toEqual([
      expect.stringContaining("[harness_command_failed]"),
    ]);
  });
});
