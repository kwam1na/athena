import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type DesignSystemPolicyRule =
  | "raw-hex"
  | "raw-status-hue"
  | "arbitrary-value"
  | "legacy-alias";

export type DesignSystemPolicyViolation = {
  rule: DesignSystemPolicyRule;
  message: string;
};

type PolicyException = {
  path: string;
  rules: DesignSystemPolicyRule[];
  reason: string;
};

const foundationPaths = new Set([
  "src/index.css",
  "tailwind.config.js",
  "postcss.config.js",
  "scripts/design-system-policy.ts",
]);

const policyExceptions: readonly PolicyException[] = [
  {
    path: "src/routes/shop/receipt/-PosReceiptPage.tsx",
    rules: ["arbitrary-value"],
    reason:
      "Receipt print geometry may require exact physical dimensions that do not belong in normal page tokens.",
  },
];

const rawHexPattern = /#[\da-f]{3,8}\b/i;
const rawStatusHuePattern =
  /(?:^|[\s"'`])(?:[\w-]+:)*(?:bg|border|decoration|fill|from|outline|ring|stroke|text|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|cyan|sky|blue|rose)-\d{2,3}(?:\/\d{1,3})?(?=$|[\s"'`])/;
const arbitraryValuePattern =
  /(?:^|[\s"'`])(?:[\w-]+:)*(?:-?[\w]+(?:-[\w]+)*)-\[[^\]]+\](?=$|[\s"'`])/;
const legacyAliasPattern =
  /(?:^|[\s"'`])(?:[\w-]+:)*(?:[\w-]+-)?accent(?:-?[2-5])(?:-[\w-]+)?(?:\/\d{1,3})?(?=$|[\s"'`])/;

export function getDesignSystemPolicyExceptions() {
  return policyExceptions.map((exception) => ({
    ...exception,
    rules: [...exception.rules],
  }));
}

function isRuleAllowed(path: string, rule: DesignSystemPolicyRule) {
  if (
    foundationPaths.has(path) ||
    /\.test\.[cm]?[jt]sx?$/.test(path) ||
    /\.d\.ts$/.test(path)
  ) {
    return true;
  }

  return policyExceptions.some(
    (exception) =>
      exception.path === path && exception.rules.includes(rule),
  );
}

export function checkDesignSystemLine(
  path: string,
  line: string,
): DesignSystemPolicyViolation[] {
  const candidates: Array<{
    rule: DesignSystemPolicyRule;
    pattern: RegExp;
    message: string;
  }> = [
    {
      rule: "raw-hex",
      pattern: rawHexPattern,
      message: "Use a semantic color token instead of a raw hex value.",
    },
    {
      rule: "raw-status-hue",
      pattern: rawStatusHuePattern,
      message: "Use a semantic status role instead of a raw palette hue.",
    },
    {
      rule: "arbitrary-value",
      pattern: arbitraryValuePattern,
      message: "Use a named design-system utility instead of an arbitrary value.",
    },
    {
      rule: "legacy-alias",
      pattern: legacyAliasPattern,
      message:
        "Use a supported semantic role instead of a deprecated accent alias.",
    },
  ];

  return candidates
    .filter(
      ({ pattern, rule }) =>
        pattern.test(line) && !isRuleAllowed(path, rule),
    )
    .map(({ rule, message }) => ({ rule, message }));
}

function readAddedLines(base: string, path: string) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", path], {
      stdio: "ignore",
    });
  } catch {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line, index) => ({ line, lineNumber: index + 1 }));
  }

  const diff = execFileSync(
    "git",
    ["diff", "--unified=0", "--no-color", base, "--", path],
    { encoding: "utf8" },
  );
  const additions: Array<{ line: string; lineNumber: number }> = [];
  let nextLineNumber = 0;

  for (const diffLine of diff.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(diffLine);
    if (hunk) {
      nextLineNumber = Number(hunk[1]);
      continue;
    }
    if (diffLine.startsWith("+++") || diffLine.startsWith("---")) {
      continue;
    }
    if (diffLine.startsWith("+")) {
      additions.push({
        line: diffLine.slice(1),
        lineNumber: nextLineNumber,
      });
      nextLineNumber += 1;
      continue;
    }
    if (!diffLine.startsWith("-") && !diffLine.startsWith("\\")) {
      nextLineNumber += 1;
    }
  }

  return additions;
}

function runCli() {
  const args = process.argv.slice(2);
  const baseFlagIndex = args.indexOf("--base");
  const base =
    baseFlagIndex >= 0 && args[baseFlagIndex + 1]
      ? args[baseFlagIndex + 1]
      : "origin/main";
  const paths = args.filter(
    (_arg, index) => index !== baseFlagIndex && index !== baseFlagIndex + 1,
  );
  let violationCount = 0;

  for (const path of paths) {
    for (const { line, lineNumber } of readAddedLines(base, path)) {
      for (const violation of checkDesignSystemLine(path, line)) {
        violationCount += 1;
        console.error(
          `${path}:${lineNumber} [${violation.rule}] ${violation.message}`,
        );
      }
    }
  }

  if (violationCount > 0) {
    console.error(
      `Storefront design-system policy found ${violationCount} introduced violation(s).`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Storefront design-system policy passed for ${paths.length} changed file(s).`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runCli();
}
