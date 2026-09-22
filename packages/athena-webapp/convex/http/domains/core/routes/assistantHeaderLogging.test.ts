/**
 * A lint, expressed as a test: no assistant header ever reaches `console.*`.
 *
 * The shopper's question travels in `X-Assistant-Query` and the caller's
 * credential in `X-Assistant-Token`, precisely so that neither is in a URL or
 * in `operationArgs`. That is undone the moment somebody debugs the route with
 * a `console.log` of the header, so the prohibition is checked mechanically
 * over every Convex source file rather than remembered.
 *
 * The rule is proved to bite: the same scanner is run over a violating
 * snippet, and it has to report it.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CONVEX_ROOT = join(__dirname, "..", "..", "..", "..");
const SKIPPED_DIRECTORIES = new Set(["_generated", "node_modules"]);

/** Anything that names an assistant header, however it is spelled. */
const ASSISTANT_HEADER = /x-assistant|assistantQuery|assistantToken/i;

function convexSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry) ? [] : convexSourceFiles(path);
    }
    return entry.endsWith(".ts") || entry.endsWith(".tsx") ? [path] : [];
  });
}

/** The argument text of every `console.<method>(…)` call in a source file. */
export function consoleArguments(source: string): string[] {
  const calls: string[] = [];
  const opener = /console\s*\.\s*\w+\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(source)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      const character = source[index];
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      index += 1;
    }
    calls.push(source.slice(start, index - 1));
  }

  return calls;
}

describe("assistant headers never reach a log line", () => {
  it("finds no console call naming an assistant header anywhere in convex/", () => {
    const offenders: string[] = [];

    for (const path of convexSourceFiles(CONVEX_ROOT)) {
      // This file quotes the header names to state the rule.
      if (path.endsWith("assistantHeaderLogging.test.ts")) continue;
      for (const argumentText of consoleArguments(readFileSync(path, "utf8"))) {
        if (ASSISTANT_HEADER.test(argumentText)) {
          offenders.push(`${path}: console(${argumentText.trim()})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("reports a violation, so the rule is known to bite", () => {
    const violating = `
      const q = c.req.header("X-Assistant-Query");
      console.warn("assistant query", c.req.header("x-assistant-query"));
      console.error(assistantQuery);
    `;

    const flagged = consoleArguments(violating).filter((argumentText) =>
      ASSISTANT_HEADER.test(argumentText),
    );

    expect(flagged).toHaveLength(2);
  });

  it("does not flag a reason code that merely mentions the feature", () => {
    const compliant = `console.warn("assistant_catalog_token_stamp_failed");`;

    expect(
      consoleArguments(compliant).filter((argumentText) =>
        ASSISTANT_HEADER.test(argumentText),
      ),
    ).toEqual([]);
  });
});
