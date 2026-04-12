import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  HARNESS_APP_REGISTRY,
  type HarnessAppRegistryEntry,
} from "./harness-app-registry";
import { HARNESS_BEHAVIOR_SCENARIOS } from "./harness-behavior-scenarios";

const DEFAULT_OUTPUT_PATH = "artifacts/harness-scorecard/latest.json";
const REQUIRED_TESTING_SNIPPETS = [
  "`bun run harness:check`",
  "`bun run harness:review`",
  "`bun run harness:audit`",
  "(./validation-map.json)",
] as const;
const SCENARIO_SECTION_MARKERS = [
  "Current shared scenarios include",
  "Bundled scenarios include",
] as const;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const RUNTIME_SCENARIO_NAME_PATTERN = /^(?:sample-runtime-smoke|[a-z0-9]+(?:-[a-z0-9]+)+)$/;

type ScorecardStatus = "healthy" | "mixed" | "degraded";
type ArtifactStatus = "healthy" | "mixed" | "missing" | "skipped" | "pass" | "fail" | "error";
type GraphifyStatus = "paired" | "partial" | "missing";
type DocumentationStatus = "healthy" | "degraded" | "missing";

type ScorecardLogger = Pick<Console, "log" | "error">;

type ScorecardFileSystem = {
  fileExists: (filePath: string) => Promise<boolean>;
  listDir: (directoryPath: string) => Promise<string[]>;
  readText: (filePath: string) => Promise<string>;
  readJson: <T>(filePath: string) => Promise<T>;
};

type HarnessInferentialArtifact = {
  version?: string;
  generatedAt?: string;
  reviewMode?: string;
  baseRef?: string;
  status?: ArtifactStatus;
  summary?: string;
  providerName?: string;
  changedFiles?: string[];
  targetFiles?: string[];
  findings?: unknown[];
  errors?: unknown[];
  shadow?: {
    generatedAt?: string;
    status?: ArtifactStatus;
    summary?: string;
    providerName?: string;
    findings?: unknown[];
    errors?: unknown[];
  };
};

type HarnessRuntimeTrendsArtifact = {
  version?: string;
  generatedAt?: string;
  scenarios?: Array<{ scenarioName?: string }>;
  summary?: {
    reportCount?: number;
    scenarioCount?: number;
    status?: ArtifactStatus;
    regressions?: unknown[];
  };
};

type HarnessScorecardHistoryMetric = {
  directoryPath: string;
  present: boolean;
  sampleCount: number;
  latestGeneratedAt: string | null;
  parseErrorCount: number;
  shadowErrorCount?: number;
  shadowErrorRate?: number | null;
  degradedSampleCount?: number;
};

type HarnessScorecardAppDocumentationMetric = {
  appName: string;
  label: string;
  testingDocPresent: boolean;
  validationMapPresent: boolean;
  validationSurfaceCount: number;
  requiredSnippetMissingCount: number;
  documentedScenarioCount: number;
  expectedScenarioCount: number;
  missingScenarios: string[];
  unexpectedScenarios: string[];
  status: DocumentationStatus;
};

type HarnessScorecardOutput = {
  version: "1.0";
  generatedAt: string;
  metrics: {
    registry: {
      definition: string;
      appCount: number;
      activeAppCount: number;
      plannedAppCount: number;
      scenarioCount: number;
      apps: Array<{
        appName: string;
        label: string;
        onboardingStatus: "active" | "planned";
        validationSurfaceCount: number;
        scenarioCount: number;
      }>;
      scenarioNames: string[];
    };
    documentation: {
      definition: string;
      appCount: number;
      healthyAppCount: number;
      degradedAppCount: number;
      missingAppCount: number;
      totalSurfaceCount: number;
      appStatuses: HarnessScorecardAppDocumentationMetric[];
    };
    inferential: {
      definition: string;
      artifactPath: string;
      present: boolean;
      status: ArtifactStatus | "missing";
      reviewMode: string | null;
      baseRef: string | null;
      generatedAt: string | null;
      summary: string;
      findingCount: number;
      errorCount: number;
      changedFileCount: number;
      targetFileCount: number;
      shadow: {
        present: boolean;
        status: ArtifactStatus | "missing";
        providerName: string | null;
        findingCount: number;
        errorCount: number;
      };
      history: HarnessScorecardHistoryMetric;
    };
    runtimeTrends: {
      definition: string;
      artifactPath: string;
      present: boolean;
      status: ArtifactStatus | "missing";
      generatedAt: string | null;
      reportCount: number;
      scenarioCount: number;
      regressionCount: number;
      history: HarnessScorecardHistoryMetric;
    };
    graphify: {
      definition: string;
      reportPath: string;
      graphPath: string;
      reportPresent: boolean;
      graphPresent: boolean;
      status: GraphifyStatus;
      detail: string;
    };
  };
  summary: {
    status: ScorecardStatus;
    healthySignals: number;
    degradedSignals: number;
    missingSignals: number;
    note: string;
  };
};

type HarnessScorecardOptions = {
  nowIso?: () => string;
  fs?: Partial<ScorecardFileSystem>;
  logger?: ScorecardLogger;
  outputPath?: string;
};

type HarnessScorecardRunResult = {
  output: HarnessScorecardOutput;
  outputPath: string;
};

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/");
}

function sortUnique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function isRuntimeScenarioName(value: string) {
  return RUNTIME_SCENARIO_NAME_PATTERN.test(value);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function listDirectory(directoryPath: string) {
  return readdir(directoryPath);
}

async function readTextFile(filePath: string) {
  return readFile(filePath, "utf8");
}

function createFileSystem(overrides?: Partial<ScorecardFileSystem>): ScorecardFileSystem {
  return {
    fileExists: overrides?.fileExists ?? fileExists,
    listDir: overrides?.listDir ?? listDirectory,
    readText: overrides?.readText ?? readTextFile,
    readJson: overrides?.readJson ?? readJsonFile,
  };
}

function extractScenarioSection(contents: string) {
  const lines = contents.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) =>
    SCENARIO_SECTION_MARKERS.some((marker) => line.includes(marker))
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

function extractScenarioNames(contents: string) {
  const section = extractScenarioSection(contents);
  if (!section) {
    return [];
  }

  return sortUnique(
    [...section.matchAll(INLINE_CODE_PATTERN)]
      .map((match) => match[1]?.trim() ?? "")
      .filter((scenarioName) => isRuntimeScenarioName(scenarioName))
  );
}

function countMissingSnippets(contents: string) {
  return REQUIRED_TESTING_SNIPPETS.reduce(
    (count, snippet) => count + (contents.includes(snippet) ? 0 : 1),
    0
  );
}

function buildDocumentationStatus(params: {
  testingDocPresent: boolean;
  validationMapPresent: boolean;
  requiredSnippetMissingCount: number;
  missingScenarios: string[];
  unexpectedScenarios: string[];
  validationSurfaceCount: number;
}): DocumentationStatus {
  if (!params.testingDocPresent || !params.validationMapPresent) {
    return "missing";
  }

  if (
    params.requiredSnippetMissingCount > 0 ||
    params.missingScenarios.length > 0 ||
    params.unexpectedScenarios.length > 0 ||
    params.validationSurfaceCount === 0
  ) {
    return "degraded";
  }

  return "healthy";
}

function buildGraphifyStatus(reportPresent: boolean, graphPresent: boolean) {
  if (reportPresent && graphPresent) {
    return "paired" as const;
  }

  if (reportPresent || graphPresent) {
    return "partial" as const;
  }

  return "missing" as const;
}

function buildSummary(
  documentation: HarnessScorecardOutput["metrics"]["documentation"],
  inferential: HarnessScorecardOutput["metrics"]["inferential"],
  runtimeTrends: HarnessScorecardOutput["metrics"]["runtimeTrends"],
  graphify: HarnessScorecardOutput["metrics"]["graphify"]
): HarnessScorecardOutput["summary"] {
  const healthySignals =
    documentation.healthyAppCount +
    (inferential.status === "missing" ? 0 : 1) +
    (runtimeTrends.status === "missing" ? 0 : 1) +
    (graphify.status === "paired" ? 1 : 0);
  const degradedSignals =
    documentation.degradedAppCount +
    (inferential.status === "fail" || inferential.status === "error" ? 1 : 0) +
    ((inferential.history.shadowErrorCount ?? 0) >= 2 ? 1 : 0) +
    (inferential.history.parseErrorCount > 0 ? 1 : 0) +
    (runtimeTrends.status === "mixed" || runtimeTrends.status === "degraded" ? 1 : 0) +
    (runtimeTrends.history.parseErrorCount > 0 ? 1 : 0) +
    (graphify.status === "partial" ? 1 : 0);
  const missingSignals =
    documentation.missingAppCount +
    (inferential.status === "missing" ? 1 : 0) +
    (runtimeTrends.status === "missing" ? 1 : 0) +
    (graphify.status === "missing" ? 1 : 0);

  let status: ScorecardStatus = "healthy";
  if (missingSignals > 0) {
    status = "degraded";
  } else if (degradedSignals > 0) {
    status = "mixed";
  }

  const noteParts: string[] = [];
  noteParts.push(
    `${documentation.healthyAppCount} documentation apps healthy, ${documentation.degradedAppCount} degraded, and ${documentation.missingAppCount} missing.`
  );
  noteParts.push(
    inferential.status === "missing"
      ? "Inferential artifact missing."
      : `Inferential artifact ${inferential.status}.`
  );
  noteParts.push(
    runtimeTrends.status === "missing"
      ? "Runtime trend artifact missing."
      : `Runtime trend artifact ${runtimeTrends.status}.`
  );
  noteParts.push(
    graphify.status === "paired"
      ? "Graphify artifacts paired."
      : graphify.status === "partial"
      ? "Graphify artifact set is partial."
      : "Graphify artifacts missing."
  );

  return {
    status,
    healthySignals,
    degradedSignals,
    missingSignals,
    note: noteParts.join(" "),
  };
}

async function hasAnyHarnessDocs(
  rootDir: string,
  app: HarnessAppRegistryEntry,
  fsApi: ScorecardFileSystem
) {
  for (const repoRelativePath of [
    ...app.harnessDocs.requiredEntryDocs,
    ...app.harnessDocs.generatedDocs,
  ]) {
    if (await fsApi.fileExists(path.join(rootDir, repoRelativePath))) {
      return true;
    }
  }

  return false;
}

async function inspectAppDocumentation(
  rootDir: string,
  app: HarnessAppRegistryEntry,
  fsApi: ScorecardFileSystem,
  expectedScenarios: string[]
): Promise<HarnessScorecardAppDocumentationMetric> {
  const testingDocPath = path.join(rootDir, app.harnessDocs.testingPath);
  const validationMapPath = path.join(rootDir, app.harnessDocs.validationMapPath);
  const testingDocPresent = await fsApi.fileExists(testingDocPath);
  const validationMapPresent = await fsApi.fileExists(validationMapPath);

  const testingDocContents = testingDocPresent
    ? await fsApi.readText(testingDocPath)
    : "";
  const requiredSnippetMissingCount = testingDocPresent
    ? countMissingSnippets(testingDocContents)
    : REQUIRED_TESTING_SNIPPETS.length;
  const documentedScenarios = testingDocPresent
    ? extractScenarioNames(testingDocContents)
    : [];

  let validationSurfaceCount = 0;
  if (validationMapPresent) {
    const validationMap = await fsApi.readJson<{
      surfaces?: Array<{
        pathPrefixes?: string[];
      }>;
    }>(validationMapPath);
    validationSurfaceCount = Array.isArray(validationMap.surfaces)
      ? validationMap.surfaces.length
      : 0;
  }

  const missingScenarios = expectedScenarios.filter(
    (scenarioName) => !documentedScenarios.includes(scenarioName)
  );
  const unexpectedScenarios = documentedScenarios.filter(
    (scenarioName) => !expectedScenarios.includes(scenarioName)
  );

  const status = buildDocumentationStatus({
    testingDocPresent,
    validationMapPresent,
    requiredSnippetMissingCount,
    missingScenarios,
    unexpectedScenarios,
    validationSurfaceCount,
  });

  return {
    appName: app.appName,
    label: app.label,
    testingDocPresent,
    validationMapPresent,
    validationSurfaceCount,
    requiredSnippetMissingCount,
    documentedScenarioCount: documentedScenarios.length,
    expectedScenarioCount: expectedScenarios.length,
    missingScenarios,
    unexpectedScenarios,
    status,
  };
}

function getDocumentedScenarioExpectations(
  app: HarnessAppRegistryEntry,
  sharedScenarios: string[]
) {
  const appBehaviorScenarioCount = sortUnique(
    app.validationScenarios.flatMap(
      (scenario) => scenario.behaviorScenarios ?? []
    )
  ).length;

  return appBehaviorScenarioCount > 0 ? sharedScenarios : [];
}

async function inspectInferentialArtifact(rootDir: string, fsApi: ScorecardFileSystem, nowIso: string) {
  const artifactPath = path.join(
    rootDir,
    "artifacts/harness-inferential-review/latest.json"
  );
  const present = await fsApi.fileExists(artifactPath);
  if (!present) {
    return {
      definition:
        "Latest inferential review artifact state from artifacts/harness-inferential-review/latest.json.",
      artifactPath: "artifacts/harness-inferential-review/latest.json",
      present: false,
      status: "missing" as const,
      reviewMode: null,
      baseRef: null,
      generatedAt: null,
      summary: "Inferential artifact not found.",
      findingCount: 0,
      errorCount: 0,
      changedFileCount: 0,
      targetFileCount: 0,
      shadow: {
        present: false,
        status: "missing" as const,
        providerName: null,
        findingCount: 0,
        errorCount: 0,
      },
      history: {
        directoryPath: "artifacts/harness-inferential-review/history",
        present: false,
        sampleCount: 0,
        latestGeneratedAt: null,
        parseErrorCount: 0,
        shadowErrorCount: 0,
        shadowErrorRate: null,
      },
    };
  }

  const artifact = await fsApi.readJson<HarnessInferentialArtifact>(artifactPath);
  const changedFiles = Array.isArray(artifact.changedFiles) ? artifact.changedFiles : [];
  const targetFiles = Array.isArray(artifact.targetFiles) ? artifact.targetFiles : [];
  const findings = Array.isArray(artifact.findings) ? artifact.findings : [];
  const errors = Array.isArray(artifact.errors) ? artifact.errors : [];
  const shadowFindings = Array.isArray(artifact.shadow?.findings)
    ? artifact.shadow?.findings
    : [];
  const shadowErrors = Array.isArray(artifact.shadow?.errors)
    ? artifact.shadow?.errors
    : [];

  return {
    definition:
      "Latest inferential review artifact state from artifacts/harness-inferential-review/latest.json.",
    artifactPath: "artifacts/harness-inferential-review/latest.json",
    present: true,
    status: artifact.status ?? "missing",
    reviewMode: artifact.reviewMode ?? null,
    baseRef: artifact.baseRef ?? null,
    generatedAt: artifact.generatedAt ?? null,
    summary:
      artifact.summary ?? "Inferential artifact was present but did not include a summary.",
    findingCount: findings.length,
    errorCount: errors.length,
    changedFileCount: changedFiles.length,
    targetFileCount: targetFiles.length,
    shadow: {
      present: artifact.shadow !== undefined,
      status: artifact.shadow?.status ?? "missing",
      providerName: artifact.shadow?.providerName ?? null,
      findingCount: shadowFindings.length,
      errorCount: shadowErrors.length,
    },
    history: {
      directoryPath: "artifacts/harness-inferential-review/history",
      present: false,
      sampleCount: 0,
      latestGeneratedAt: null,
      parseErrorCount: 0,
      shadowErrorCount: 0,
      shadowErrorRate: null,
    },
  };
}

function buildEmptyHistoryMetric(directoryPath: string): HarnessScorecardHistoryMetric {
  return {
    directoryPath,
    present: false,
    sampleCount: 0,
    latestGeneratedAt: null,
    parseErrorCount: 0,
  };
}

async function inspectInferentialHistory(
  rootDir: string,
  fsApi: ScorecardFileSystem
) {
  const directoryPath = "artifacts/harness-inferential-review/history";
  const absoluteDirectoryPath = path.join(rootDir, directoryPath);
  if (!(await fsApi.fileExists(absoluteDirectoryPath))) {
    return {
      ...buildEmptyHistoryMetric(directoryPath),
      shadowErrorCount: 0,
      shadowErrorRate: null,
    };
  }

  const entries = (await fsApi.listDir(absoluteDirectoryPath))
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  let parseErrorCount = 0;
  let shadowErrorCount = 0;
  let sampleCount = 0;
  let latestGeneratedAt: string | null = null;

  for (const entry of entries) {
    try {
      const artifact = await fsApi.readJson<HarnessInferentialArtifact>(
        path.join(absoluteDirectoryPath, entry)
      );
      sampleCount += 1;
      latestGeneratedAt = artifact.generatedAt ?? latestGeneratedAt;
      const shadowErrors = Array.isArray(artifact.shadow?.errors)
        ? artifact.shadow?.errors
        : [];
      if ((artifact.shadow?.status === "error") || shadowErrors.length > 0) {
        shadowErrorCount += 1;
      }
    } catch {
      parseErrorCount += 1;
    }
  }

  return {
    directoryPath,
    present: true,
    sampleCount,
    latestGeneratedAt,
    parseErrorCount,
    shadowErrorCount,
    shadowErrorRate: sampleCount > 0 ? shadowErrorCount / sampleCount : null,
  };
}

async function inspectRuntimeTrendArtifact(
  rootDir: string,
  fsApi: ScorecardFileSystem
) {
  const artifactPath = path.join(
    rootDir,
    "artifacts/harness-behavior/trends/latest.json"
  );
  const present = await fsApi.fileExists(artifactPath);
  if (!present) {
    return {
      definition:
        "Latest runtime trend artifact state from artifacts/harness-behavior/trends/latest.json.",
      artifactPath: "artifacts/harness-behavior/trends/latest.json",
      present: false,
      status: "missing" as const,
      generatedAt: null,
      reportCount: 0,
      scenarioCount: 0,
      regressionCount: 0,
      history: buildEmptyHistoryMetric("artifacts/harness-behavior/trends/history"),
    };
  }

  const artifact = await fsApi.readJson<HarnessRuntimeTrendsArtifact>(artifactPath);
  const regressions = Array.isArray(artifact.summary?.regressions)
    ? artifact.summary?.regressions
    : [];

  return {
    definition:
      "Latest runtime trend artifact state from artifacts/harness-behavior/trends/latest.json.",
    artifactPath: "artifacts/harness-behavior/trends/latest.json",
    present: true,
    status: artifact.summary?.status ?? "missing",
    generatedAt: artifact.generatedAt ?? null,
    reportCount: artifact.summary?.reportCount ?? 0,
    scenarioCount: artifact.summary?.scenarioCount ?? 0,
    regressionCount: regressions.length,
    history: buildEmptyHistoryMetric("artifacts/harness-behavior/trends/history"),
  };
}

async function inspectRuntimeTrendHistory(
  rootDir: string,
  fsApi: ScorecardFileSystem
) {
  const directoryPath = "artifacts/harness-behavior/trends/history";
  const absoluteDirectoryPath = path.join(rootDir, directoryPath);
  if (!(await fsApi.fileExists(absoluteDirectoryPath))) {
    return {
      ...buildEmptyHistoryMetric(directoryPath),
      degradedSampleCount: 0,
    };
  }

  const entries = (await fsApi.listDir(absoluteDirectoryPath))
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  let parseErrorCount = 0;
  let degradedSampleCount = 0;
  let sampleCount = 0;
  let latestGeneratedAt: string | null = null;

  for (const entry of entries) {
    try {
      const artifact = await fsApi.readJson<HarnessRuntimeTrendsArtifact>(
        path.join(absoluteDirectoryPath, entry)
      );
      sampleCount += 1;
      latestGeneratedAt = artifact.generatedAt ?? latestGeneratedAt;
      if (
        artifact.summary?.status === "mixed" ||
        artifact.summary?.status === "degraded"
      ) {
        degradedSampleCount += 1;
      }
    } catch {
      parseErrorCount += 1;
    }
  }

  return {
    directoryPath,
    present: true,
    sampleCount,
    latestGeneratedAt,
    parseErrorCount,
    degradedSampleCount,
  };
}

async function inspectGraphifyArtifacts(rootDir: string, fsApi: ScorecardFileSystem) {
  const reportPath = path.join(rootDir, "graphify-out/GRAPH_REPORT.md");
  const graphPath = path.join(rootDir, "graphify-out/graph.json");
  const [reportPresent, graphPresent] = await Promise.all([
    fsApi.fileExists(reportPath),
    fsApi.fileExists(graphPath),
  ]);

  const status = buildGraphifyStatus(reportPresent, graphPresent);
  const detail =
    status === "paired"
      ? "Both tracked Graphify artifacts are present."
      : status === "partial"
      ? "Only one tracked Graphify artifact is present."
      : "No tracked Graphify artifacts are present.";

  return {
    definition:
      "Presence and freshness signal for graphify-out/GRAPH_REPORT.md and graphify-out/graph.json.",
    reportPath: "graphify-out/GRAPH_REPORT.md",
    graphPath: "graphify-out/graph.json",
    reportPresent,
    graphPresent,
    status,
    detail,
  };
}

export async function collectHarnessScorecard(
  rootDir: string,
  options: HarnessScorecardOptions = {}
): Promise<HarnessScorecardOutput> {
  const fsApi = createFileSystem(options.fs);
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const generatedAt = nowIso();
  const expectedScenarios = sortUnique(
    HARNESS_BEHAVIOR_SCENARIOS.map((scenario) => scenario.name)
  );
  const materializedApps: HarnessAppRegistryEntry[] = [];

  for (const app of HARNESS_APP_REGISTRY) {
    if (await hasAnyHarnessDocs(rootDir, app, fsApi)) {
      materializedApps.push(app);
    }
  }

  const appStatuses = await Promise.all(
    materializedApps.map((app) =>
      inspectAppDocumentation(
        rootDir,
        app,
        fsApi,
        getDocumentedScenarioExpectations(app, expectedScenarios)
      )
    )
  );

  const registry = {
    definition:
      "Registered harness apps, onboarding states, and shared runtime scenario inventory from scripts/harness-app-registry.ts and scripts/harness-behavior-scenarios.ts.",
    appCount: HARNESS_APP_REGISTRY.length,
    activeAppCount: HARNESS_APP_REGISTRY.filter(
      (app) => app.onboardingStatus === "active"
    ).length,
    plannedAppCount: HARNESS_APP_REGISTRY.filter(
      (app) => app.onboardingStatus === "planned"
    ).length,
    scenarioCount: expectedScenarios.length,
    apps: HARNESS_APP_REGISTRY.map((app) => ({
      appName: app.appName,
      label: app.label,
      onboardingStatus: app.onboardingStatus,
      validationSurfaceCount: app.validationScenarios.length,
      scenarioCount: sortUnique(
        app.validationScenarios.flatMap(
          (scenario) => scenario.behaviorScenarios ?? []
        )
      ).length,
    })),
    scenarioNames: expectedScenarios,
  };

  const documentation = {
    definition:
      "Validation-map presence, testing-doc freshness, and runtime-scenario documentation parity for each registered harness app.",
    appCount: appStatuses.length,
    healthyAppCount: appStatuses.filter((metric) => metric.status === "healthy").length,
    degradedAppCount: appStatuses.filter((metric) => metric.status === "degraded").length,
    missingAppCount: appStatuses.filter((metric) => metric.status === "missing").length,
    totalSurfaceCount: appStatuses.reduce(
      (count, metric) => count + metric.validationSurfaceCount,
      0
    ),
    appStatuses,
  };

  const inferential = await inspectInferentialArtifact(rootDir, fsApi, generatedAt);
  inferential.history = await inspectInferentialHistory(rootDir, fsApi);
  const runtimeTrends = await inspectRuntimeTrendArtifact(rootDir, fsApi);
  runtimeTrends.history = await inspectRuntimeTrendHistory(rootDir, fsApi);
  const graphify = await inspectGraphifyArtifacts(rootDir, fsApi);

  const summary = buildSummary(documentation, inferential, runtimeTrends, graphify);

  return {
    version: "1.0",
    generatedAt,
    metrics: {
      registry,
      documentation,
      inferential,
      runtimeTrends,
      graphify,
    },
    summary,
  };
}

export async function runHarnessScorecard(
  rootDir: string,
  options: HarnessScorecardOptions = {}
): Promise<HarnessScorecardRunResult> {
  const output = await collectHarnessScorecard(rootDir, options);
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH;
  const absoluteOutputPath = path.join(rootDir, outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(output, null, 2)}\n`);
  return {
    output,
    outputPath,
  };
}

if (import.meta.main) {
  const rootDir = process.cwd();
  const result = await runHarnessScorecard(rootDir);
  console.log(JSON.stringify(result.output, null, 2));
}
