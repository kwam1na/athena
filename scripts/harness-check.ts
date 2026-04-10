import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { generateHarnessDocs, GENERATED_HARNESS_DOCS } from "./harness-generate";

const APP_NAMES = ["athena-webapp", "storefront-webapp"] as const;
const REQUIRED_APP_FILES = [
  "AGENTS.md",
  "docs/agent/index.md",
  "docs/agent/architecture.md",
  "docs/agent/testing.md",
  "docs/agent/code-map.md",
  ...GENERATED_HARNESS_DOCS,
] as const;
const REQUIRED_INDEX_LINKS = [
  "./architecture.md",
  "./testing.md",
  "./code-map.md",
  "./route-index.md",
  "./test-index.md",
  "./key-folder-index.md",
  "./validation-guide.md",
] as const;
const REQUIRED_TESTING_LINKS = [
  "./test-index.md",
  "./validation-guide.md",
] as const;
const REQUIRED_CODE_MAP_LINKS = [
  "./route-index.md",
  "./key-folder-index.md",
] as const;
const MARKDOWN_LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const PLAYWRIGHT_TEST_DIR_PATTERN =
  /testDir\s*:\s*["'`](.+?)["'`]/;

type HarnessAppConfig = {
  appName: (typeof APP_NAMES)[number];
  packageName: string;
  packageDir: string;
  scripts: Record<string, string>;
};

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

function extractInlineCode(contents: string) {
  return [...contents.matchAll(INLINE_CODE_PATTERN)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
}

function normalizePathReference(reference: string) {
  const trimmedReference = stripLinkDecorations(
    reference.trim().replace(/[),.;:]+$/, "")
  );
  const firstDynamicIndex = trimmedReference.search(/[*{[]/);
  const staticReference =
    firstDynamicIndex === -1
      ? trimmedReference
      : trimmedReference.slice(0, firstDynamicIndex);

  return staticReference.replace(/\/+$/, "");
}

function isLikelyPathReference(reference: string) {
  if (!reference || /\s/.test(reference) || /^[@a-z-]+:/i.test(reference)) {
    return false;
  }

  const normalizedReference = normalizePathReference(reference);

  if (!normalizedReference) {
    return false;
  }

  return (
    normalizedReference.startsWith("./") ||
    normalizedReference.startsWith("../") ||
    normalizedReference.startsWith("packages/") ||
    normalizedReference.startsWith("src/") ||
    normalizedReference.startsWith("convex/") ||
    normalizedReference.startsWith("tests/") ||
    normalizedReference === "src" ||
    normalizedReference === "convex" ||
    normalizedReference === "tests" ||
    /\.(?:[cm]?[jt]sx?|md|json)$/.test(normalizedReference)
  );
}

function resolvePathReference(
  rootDir: string,
  filePath: string,
  packageDir: string,
  reference: string
) {
  const normalizedReference = normalizePathReference(reference);

  if (!normalizedReference) {
    return null;
  }

  if (normalizedReference.startsWith("packages/")) {
    return path.join(rootDir, normalizedReference);
  }

  if (
    normalizedReference.startsWith("./") ||
    normalizedReference.startsWith("../")
  ) {
    return path.resolve(rootDir, path.dirname(filePath), normalizedReference);
  }

  return path.join(rootDir, packageDir, normalizedReference);
}

async function collectReferencedPathErrors(
  rootDir: string,
  filePath: string,
  packageDir: string,
  contents: string
) {
  const errors: string[] = [];
  const seenReferences = new Set<string>();

  for (const reference of extractInlineCode(contents)) {
    if (!isLikelyPathReference(reference)) {
      continue;
    }

    const normalizedReference = normalizePathReference(reference);
    if (!normalizedReference || seenReferences.has(normalizedReference)) {
      continue;
    }

    seenReferences.add(normalizedReference);
    const resolvedPath = resolvePathReference(
      rootDir,
      filePath,
      packageDir,
      reference
    );

    if (resolvedPath && !(await fileExists(resolvedPath))) {
      errors.push(`Missing referenced path in ${filePath}: ${normalizedReference}`);
    }
  }

  return errors;
}

async function readPackageConfig(rootDir: string, appName: (typeof APP_NAMES)[number]) {
  const packageDir = path.posix.join("packages", appName);
  const packageJsonPath = path.join(rootDir, packageDir, "package.json");

  if (!(await fileExists(packageJsonPath))) {
    return null;
  }

  const parsedPackage = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
  };

  if (!parsedPackage.name) {
    return null;
  }

  return {
    appName,
    packageDir,
    packageName: parsedPackage.name,
    scripts: parsedPackage.scripts ?? {},
  } satisfies HarnessAppConfig;
}

function extractTestScriptFromCommand(
  command: string,
  packageName: string
) {
  const bunFilterMatch = command.match(
    /^bun run --filter ["']([^"']+)["'] ([^\s`]+)$/
  );
  if (bunFilterMatch) {
    return bunFilterMatch[1] === packageName &&
      bunFilterMatch[2]?.startsWith("test")
      ? bunFilterMatch[2]
      : null;
  }

  const bunRunMatch = command.match(/^bun run ([^\s`]+)$/);
  if (bunRunMatch) {
    return bunRunMatch[1]?.startsWith("test") ? bunRunMatch[1] : null;
  }

  const npmRunMatch = command.match(/^(?:npm|pnpm) run ([^\s`]+)$/);
  if (npmRunMatch) {
    return npmRunMatch[1]?.startsWith("test") ? npmRunMatch[1] : null;
  }

  const yarnMatch = command.match(/^yarn ([^\s`]+)$/);
  if (yarnMatch) {
    return yarnMatch[1]?.startsWith("test") ? yarnMatch[1] : null;
  }

  return null;
}

async function walkFiles(dirPath: string): Promise<string[]> {
  if (!(await fileExists(dirPath))) {
    return [];
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(entryPath);
      }

      return [entryPath];
    })
  );

  return files.flat();
}

async function collectTestSurfaceRoots(
  rootDir: string,
  packageConfig: HarnessAppConfig
) {
  const packageRoot = path.join(rootDir, packageConfig.packageDir);
  const allFiles = await walkFiles(packageRoot);
  const surfaces = new Set<string>();

  for (const filePath of allFiles) {
    const repoRelativePath = path.relative(packageRoot, filePath);
    if (
      repoRelativePath.startsWith("node_modules") ||
      repoRelativePath.startsWith("dist") ||
      repoRelativePath.startsWith("coverage")
    ) {
      continue;
    }

    if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(repoRelativePath)) {
      continue;
    }

    const normalizedPath = repoRelativePath.split(path.sep).join("/");
    surfaces.add(normalizedPath.split("/", 1)[0] ?? normalizedPath);
  }

  const playwrightConfigPath = path.join(packageRoot, "playwright.config.ts");
  if (
    packageConfig.scripts["test:e2e"] &&
    (await fileExists(playwrightConfigPath))
  ) {
    const playwrightConfig = await readFile(playwrightConfigPath, "utf8");
    const testDirMatch = playwrightConfig.match(PLAYWRIGHT_TEST_DIR_PATTERN);
    const testDir = testDirMatch?.[1]?.replace(/^\.\//, "").replace(/\/+$/, "");
    if (testDir) {
      surfaces.add(testDir);
    }
  }

  return [...surfaces].sort();
}

async function collectTestingDocErrors(
  rootDir: string,
  filePath: string,
  packageConfig: HarnessAppConfig,
  contents: string
) {
  const errors: string[] = [];
  const documentedTestScripts = new Set<string>();

  for (const inlineCode of extractInlineCode(contents)) {
    const documentedScript = extractTestScriptFromCommand(
      inlineCode,
      packageConfig.packageName
    );
    if (!documentedScript) {
      continue;
    }

    documentedTestScripts.add(documentedScript);
    if (!packageConfig.scripts[documentedScript]) {
      errors.push(`Invalid documented test command in ${filePath}: ${inlineCode}`);
    }
  }

  const requiredScripts = new Set(["test"]);
  if (packageConfig.scripts["test:e2e"]) {
    requiredScripts.add("test:e2e");
  }

  for (const requiredScript of requiredScripts) {
    if (!documentedTestScripts.has(requiredScript)) {
      errors.push(`Missing documented test command in ${filePath}: ${requiredScript}`);
    }
  }

  const requiredSurfaces = await collectTestSurfaceRoots(rootDir, packageConfig);
  for (const surface of requiredSurfaces) {
    if (!contents.includes(surface)) {
      errors.push(`Missing documented test surface in ${filePath}: ${surface}`);
    }
  }

  return errors;
}

export async function validateHarnessDocs(rootDir: string) {
  const errors: string[] = [];
  const markdownFiles = ["packages/AGENTS.md"];
  const packageConfigs = new Map<
    (typeof APP_NAMES)[number],
    HarnessAppConfig
  >();
  const generatedDocs = await generateHarnessDocs(rootDir);

  if (!(await fileExists(path.join(rootDir, "packages/AGENTS.md")))) {
    errors.push("Missing required harness file: packages/AGENTS.md");
    return errors;
  }

  for (const appName of APP_NAMES) {
    const packageConfig = await readPackageConfig(rootDir, appName);
    if (packageConfig) {
      packageConfigs.set(appName, packageConfig);
    }

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
      const appName = APP_NAMES.find((candidate) =>
        markdownFile.startsWith(`packages/${candidate}/`)
      );
      const packageConfig = appName ? packageConfigs.get(appName) : null;
      const linkTargets = new Set(
        [...contents.matchAll(MARKDOWN_LINK_PATTERN)]
          .map((match) => stripLinkDecorations(match[1]?.trim() ?? ""))
          .filter(Boolean)
      );

      if (
        packageConfig &&
        (markdownFile.endsWith("/docs/agent/code-map.md") ||
          markdownFile.endsWith("/docs/agent/testing.md"))
      ) {
        errors.push(
          ...(
            await collectReferencedPathErrors(
              rootDir,
              markdownFile,
              packageConfig.packageDir,
              contents
            )
          )
        );
      }

      if (packageConfig && markdownFile.endsWith("/docs/agent/testing.md")) {
        for (const requiredLink of REQUIRED_TESTING_LINKS) {
          if (!linkTargets.has(requiredLink)) {
            errors.push(
              `Missing required testing link in ${markdownFile}: ${requiredLink}`
            );
          }
        }
        errors.push(
          ...(await collectTestingDocErrors(
            rootDir,
            markdownFile,
            packageConfig,
            contents
          ))
        );
      }

      if (packageConfig && markdownFile.endsWith("/docs/agent/code-map.md")) {
        for (const requiredLink of REQUIRED_CODE_MAP_LINKS) {
          if (!linkTargets.has(requiredLink)) {
            errors.push(
              `Missing required code-map link in ${markdownFile}: ${requiredLink}`
            );
          }
        }
      }

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

  for (const [generatedPath, expectedContents] of generatedDocs) {
    const absolutePath = path.join(rootDir, generatedPath);
    if (!(await fileExists(absolutePath))) {
      continue;
    }

    const currentContents = await readFile(absolutePath, "utf8");
    if (currentContents !== expectedContents) {
      errors.push(`Stale generated harness doc: ${generatedPath}`);
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
