import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  HARNESS_APP_REGISTRY,
  HARNESS_PACKAGE_REGISTRY,
  PACKAGES_AGENTS_PATH,
  REQUIRED_TESTING_LINKS,
  type HarnessAppName,
  type HarnessAppRegistryEntry,
} from "./harness-app-registry";
import { HARNESS_BEHAVIOR_SCENARIOS } from "./harness-behavior-scenarios";
import { generateHarnessDocs } from "./harness-generate";

const MARKDOWN_LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const PLAYWRIGHT_TEST_DIR_PATTERN =
  /testDir\s*:\s*["'`](.+?)["'`]/;
const RUNTIME_SCENARIO_INLINE_CODE_PATTERN = /`([a-z0-9]+(?:-[a-z0-9]+)+)`/g;
const CODE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const RUNTIME_SCENARIO_SECTION_MARKERS = [
  "Current shared scenarios include",
  "Bundled scenarios include",
] as const;
const RUNTIME_SCENARIO_DOCS = [
  "README.md",
  "packages/athena-webapp/docs/agent/testing.md",
  "packages/storefront-webapp/docs/agent/testing.md",
] as const;

type HarnessAppConfig = {
  appName: HarnessAppName;
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

function sortUniqueEntries(entries: string[]) {
  return [...new Set(entries.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function formatScenarioList(scenarios: string[]) {
  return scenarios.map((scenarioName) => `\`${scenarioName}\``).join(", ");
}

function isRuntimeScenarioName(value: string) {
  return (
    value === "sample-runtime-smoke" ||
    value.startsWith("athena-") ||
    value.startsWith("storefront-")
  );
}

function extractRuntimeScenarioSection(contents: string) {
  const lines = contents.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) =>
    RUNTIME_SCENARIO_SECTION_MARKERS.some((marker) => line.includes(marker))
  );

  if (markerIndex === -1) {
    return null;
  }

  const sectionLines: string[] = [];
  for (let index = markerIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > markerIndex && /^##\s+/.test(line.trim())) {
      break;
    }
    sectionLines.push(line);
  }

  return sectionLines.join("\n");
}

async function collectRuntimeScenarioDocSyncErrors(rootDir: string) {
  const errors: string[] = [];
  const expectedScenarios = sortUniqueEntries(
    HARNESS_BEHAVIOR_SCENARIOS.map((scenario) => scenario.name)
  );

  for (const repoRelativePath of RUNTIME_SCENARIO_DOCS) {
    const absolutePath = path.join(rootDir, repoRelativePath);
    if (!(await fileExists(absolutePath))) {
      errors.push(`Missing runtime behavior scenario doc: ${repoRelativePath}`);
      continue;
    }

    const contents = await readFile(absolutePath, "utf8");
    const runtimeSection = extractRuntimeScenarioSection(contents);
    if (!runtimeSection) {
      errors.push(
        `Missing runtime behavior scenario list in ${repoRelativePath}. Include a section with "Current shared scenarios include" or "Bundled scenarios include".`
      );
      continue;
    }

    const documentedScenarios = sortUniqueEntries(
      [...runtimeSection.matchAll(RUNTIME_SCENARIO_INLINE_CODE_PATTERN)]
        .map((match) => match[1]?.trim() ?? "")
        .filter((scenarioName) => isRuntimeScenarioName(scenarioName))
    );

    const missingScenarios = expectedScenarios.filter(
      (scenarioName) => !documentedScenarios.includes(scenarioName)
    );
    const unexpectedScenarios = documentedScenarios.filter(
      (scenarioName) => !expectedScenarios.includes(scenarioName)
    );

    if (missingScenarios.length === 0 && unexpectedScenarios.length === 0) {
      continue;
    }

    const mismatchSegments: string[] = [];
    if (missingScenarios.length > 0) {
      mismatchSegments.push(`missing ${formatScenarioList(missingScenarios)}`);
    }
    if (unexpectedScenarios.length > 0) {
      mismatchSegments.push(
        `unexpected ${formatScenarioList(unexpectedScenarios)}`
      );
    }

    errors.push(
      `Runtime behavior scenario docs drift in ${repoRelativePath}: ${mismatchSegments.join(
        "; "
      )}. Run \`bun run harness:behavior --list\` and sync this list to scripts/harness-behavior-scenarios.ts.`
    );
  }

  return errors;
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

async function readPackageConfig(
  rootDir: string,
  app: Pick<HarnessAppRegistryEntry, "appName" | "packageDir">
) {
  const packageDir = app.packageDir;
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
    appName: app.appName,
    packageDir,
    packageName: parsedPackage.name,
    scripts: parsedPackage.scripts ?? {},
  } satisfies HarnessAppConfig;
}

async function listWorkspacePackageDirs(rootDir: string) {
  const packagesRoot = path.join(rootDir, "packages");
  if (!(await fileExists(packagesRoot))) {
    return [];
  }

  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const packageDirs: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const packageDir = path.posix.join("packages", entry.name);
    if (await fileExists(path.join(rootDir, packageDir, "package.json"))) {
      packageDirs.push(packageDir);
    }
  }

  return packageDirs.sort();
}

async function collectHarnessOnboardingErrors(rootDir: string) {
  const errors: string[] = [];
  const registeredPackageDirs = new Set(
    HARNESS_PACKAGE_REGISTRY.map((entry) => entry.packageDir)
  );

  for (const packageDir of await listWorkspacePackageDirs(rootDir)) {
    if (!registeredPackageDirs.has(packageDir)) {
      errors.push(
        `Harness onboarding gap: ${packageDir} exists under packages/* but is not registered in scripts/harness-app-registry.ts.`
      );
    }
  }

  for (const registration of HARNESS_PACKAGE_REGISTRY) {
    if (registration.kind !== "harness-app") {
      continue;
    }

    for (const requiredEntryDoc of registration.requiredEntryDocs) {
      if (!(await fileExists(path.join(rootDir, requiredEntryDoc)))) {
        errors.push(
          `Harness onboarding gap: ${registration.packageDir} is registered but missing required harness entry doc ${requiredEntryDoc}.`
        );
      }
    }
  }

  return errors;
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

async function collectServiceCodeFiles(
  rootDir: string,
  packageDir: string
) {
  const packageRoot = path.join(rootDir, packageDir);
  const allFiles = await walkFiles(packageRoot);

  return allFiles
    .map((filePath) => path.relative(packageRoot, filePath).split(path.sep).join("/"))
    .filter(
      (repoRelativePath) =>
        !repoRelativePath.startsWith("node_modules/") &&
        !repoRelativePath.startsWith("dist/") &&
        !repoRelativePath.startsWith("coverage/") &&
        CODE_FILE_PATTERN.test(repoRelativePath)
    )
    .sort();
}

async function collectTestSurfaceRoots(
  rootDir: string,
  app: Pick<HarnessAppRegistryEntry, "archetype" | "packageDir">,
  packageConfig: HarnessAppConfig
) {
  if (app.archetype === "service-package") {
    return collectServiceCodeFiles(rootDir, packageConfig.packageDir);
  }

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
  app: Pick<HarnessAppRegistryEntry, "archetype" | "packageDir">,
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

  const requiredScripts =
    app.archetype === "service-package"
      ? new Set(["test:connection"])
      : new Set(["test"]);
  if (app.archetype === "webapp" && packageConfig.scripts["test:e2e"]) {
    requiredScripts.add("test:e2e");
  }

  for (const requiredScript of requiredScripts) {
    if (!documentedTestScripts.has(requiredScript)) {
      errors.push(`Missing documented test command in ${filePath}: ${requiredScript}`);
    }
  }

  const requiredSurfaces = await collectTestSurfaceRoots(rootDir, app, packageConfig);
  for (const surface of requiredSurfaces) {
    if (!contents.includes(surface)) {
      errors.push(`Missing documented test surface in ${filePath}: ${surface}`);
    }
  }

  return errors;
}

export async function validateHarnessDocs(rootDir: string) {
  const errors = await collectHarnessOnboardingErrors(rootDir);
  const markdownFiles = [PACKAGES_AGENTS_PATH];
  const packageConfigs = new Map<HarnessAppName, HarnessAppConfig>();
  const generatedDocs = await generateHarnessDocs(rootDir);

  if (!(await fileExists(path.join(rootDir, PACKAGES_AGENTS_PATH)))) {
    errors.push(`Missing required harness file: ${PACKAGES_AGENTS_PATH}`);
    return errors;
  }

  for (const app of HARNESS_APP_REGISTRY) {
    const packageConfig = await readPackageConfig(rootDir, app);
    if (packageConfig) {
      packageConfigs.set(app.appName, packageConfig);
    }

    const requiredAppFiles = [
      ...app.harnessDocs.requiredEntryDocs,
      ...app.harnessDocs.generatedDocs,
    ];

    for (const repoRelativePath of requiredAppFiles) {
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

    const app = HARNESS_APP_REGISTRY.find((candidate) =>
      markdownFile.startsWith(`${candidate.packageDir}/`)
    );
    const packageConfig = app ? packageConfigs.get(app.appName) : null;
    const linkTargets = new Set(
      [...contents.matchAll(MARKDOWN_LINK_PATTERN)]
        .map((match) => stripLinkDecorations(match[1]?.trim() ?? ""))
        .filter(Boolean)
    );

    if (!markdownFile.endsWith("/docs/agent/index.md")) {
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
            app,
            packageConfig,
            contents
          ))
        );
      }

      if (packageConfig && markdownFile.endsWith("/docs/agent/code-map.md")) {
        for (const requiredLink of app.harnessDocs.requiredCodeMapLinks) {
          if (!linkTargets.has(requiredLink)) {
            errors.push(
              `Missing required code-map link in ${markdownFile}: ${requiredLink}`
            );
          }
        }
      }

      continue;
    }

    if (!app) {
      continue;
    }

    for (const requiredLink of app.harnessDocs.requiredIndexLinks) {
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

  errors.push(...(await collectRuntimeScenarioDocSyncErrors(rootDir)));

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
