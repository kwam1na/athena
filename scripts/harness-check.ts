import { access, readFile } from "node:fs/promises";
import path from "node:path";

const APP_NAMES = ["athena-webapp", "storefront-webapp"] as const;
const REQUIRED_APP_FILES = [
  "AGENTS.md",
  "docs/agent/index.md",
  "docs/agent/architecture.md",
  "docs/agent/testing.md",
  "docs/agent/code-map.md",
] as const;
const REQUIRED_INDEX_LINKS = [
  "./architecture.md",
  "./testing.md",
  "./code-map.md",
] as const;
const MARKDOWN_LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g;

function stripLinkDecorations(linkTarget: string) {
  return linkTarget.split("#", 1)[0]?.split("?", 1)[0] ?? "";
}

function isRelativeLink(linkTarget: string) {
  if (!linkTarget) {
    return false;
  }

  return !/^(?:[a-z]+:|#|\/)/i.test(linkTarget);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectMarkdownLinkErrors(rootDir: string, filePath: string) {
  const contents = await readFile(path.join(rootDir, filePath), "utf8");
  const errors: string[] = [];

  for (const match of contents.matchAll(MARKDOWN_LINK_PATTERN)) {
    const rawTarget = match[1]?.trim() ?? "";
    const normalizedTarget = stripLinkDecorations(rawTarget);

    if (!isRelativeLink(normalizedTarget)) {
      continue;
    }

    const resolvedTarget = path.resolve(
      rootDir,
      path.dirname(filePath),
      normalizedTarget
    );

    if (!(await fileExists(resolvedTarget))) {
      errors.push(`Broken markdown link in ${filePath}: ${rawTarget}`);
    }
  }

  return {
    contents,
    errors,
  };
}

export async function validateHarnessDocs(rootDir: string) {
  const errors: string[] = [];
  const markdownFiles = ["packages/AGENTS.md"];

  if (!(await fileExists(path.join(rootDir, "packages/AGENTS.md")))) {
    errors.push("Missing required harness file: packages/AGENTS.md");
    return errors;
  }

  for (const appName of APP_NAMES) {
    for (const relativeFile of REQUIRED_APP_FILES) {
      const repoRelativePath = path.posix.join("packages", appName, relativeFile);
      if (!(await fileExists(path.join(rootDir, repoRelativePath)))) {
        errors.push(`Missing required harness file: ${repoRelativePath}`);
        continue;
      }

      if (repoRelativePath.endsWith(".md")) {
        markdownFiles.push(repoRelativePath);
      }
    }
  }

  for (const markdownFile of markdownFiles) {
    if (!(await fileExists(path.join(rootDir, markdownFile)))) {
      continue;
    }

    const { contents, errors: linkErrors } = await collectMarkdownLinkErrors(
      rootDir,
      markdownFile
    );
    errors.push(...linkErrors);

    if (!markdownFile.endsWith("/docs/agent/index.md")) {
      continue;
    }

    const linkTargets = new Set(
      [...contents.matchAll(MARKDOWN_LINK_PATTERN)]
        .map((match) => stripLinkDecorations(match[1]?.trim() ?? ""))
        .filter(Boolean)
    );

    for (const requiredLink of REQUIRED_INDEX_LINKS) {
      if (!linkTargets.has(requiredLink)) {
        errors.push(
          `Missing required index link in ${markdownFile}: ${requiredLink}`
        );
      }
    }
  }

  return errors;
}

export async function runHarnessCheck(rootDir: string) {
  const errors = await validateHarnessDocs(rootDir);

  if (errors.length === 0) {
    console.log("Harness docs check passed.");
    return;
  }

  for (const error of errors) {
    console.error(`- ${error}`);
  }

  throw new Error(`Harness docs check failed with ${errors.length} issue(s).`);
}

if (import.meta.main) {
  await runHarnessCheck(process.cwd());
}
