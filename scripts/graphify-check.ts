import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runGraphifyRebuild } from "./graphify-rebuild";
import { GRAPHIFY_WIKI_ARTIFACTS } from "./graphify-wiki";

export const TRACKED_GRAPHIFY_ARTIFACTS = [
  ...GRAPHIFY_WIKI_ARTIFACTS,
  "graphify-out/GRAPH_REPORT.md",
  "graphify-out/graph.json",
] as const;
const SKIP_DIRS = new Set([
  "node_modules",
  "worktrees",
  "graphify-out",
  "__pycache__",
  "coverage",
  "dist",
  "storybook-static",
]);
const CODE_EXTENSIONS = new Set([
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".rb",
  ".cs",
  ".kt",
  ".kts",
  ".scala",
  ".php",
  ".swift",
  ".lua",
  ".toc",
  ".zig",
  ".ps1",
  ".m",
  ".mm",
]);

type GraphifyCheckOptions = {
  runGraphifyRebuild?: (rootDir: string) => Promise<void>;
};

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectRepoCodeFiles(rootDir: string) {
  const files: string[] = [];
  const queue = [""];

  while (queue.length > 0) {
    const currentRelativeDir = queue.pop()!;
    const currentAbsoluteDir = path.join(rootDir, currentRelativeDir);
    const entries = await readdir(currentAbsoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const relativePath = currentRelativeDir
        ? path.join(currentRelativeDir, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          queue.push(relativePath);
        }
        continue;
      }

      if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(relativePath);
      }
    }
  }

  return files.sort();
}

async function copyGraphifyCheckInputs(rootDir: string, workspaceRoot: string) {
  const codeFiles = await collectRepoCodeFiles(rootDir);

  await Promise.all(
    codeFiles.map(async (relativePath) => {
      const sourcePath = path.join(rootDir, relativePath);
      const destinationPath = path.join(workspaceRoot, relativePath);
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
    })
  );

  const graphifyPythonPath = path.join(rootDir, ".graphify_python");
  if (await fileExists(graphifyPythonPath)) {
    await copyFile(graphifyPythonPath, path.join(workspaceRoot, ".graphify_python"));
  }
}

async function collectStaleGraphifyArtifacts(rootDir: string, workspaceRoot: string) {
  const staleArtifacts: string[] = [];

  for (const artifactName of TRACKED_GRAPHIFY_ARTIFACTS) {
    const trackedArtifactPath = path.join(rootDir, artifactName);
    const freshArtifactPath = path.join(workspaceRoot, artifactName);
    const trackedExists = await fileExists(trackedArtifactPath);
    const freshExists = await fileExists(freshArtifactPath);

    if (!trackedExists || !freshExists) {
      staleArtifacts.push(`- ${artifactName} (missing artifact)`);
      continue;
    }

    const [trackedContents, freshContents] = await Promise.all([
      readFile(trackedArtifactPath),
      readFile(freshArtifactPath),
    ]);

    if (!trackedContents.equals(freshContents)) {
      staleArtifacts.push(`- ${artifactName}`);
    }
  }

  return staleArtifacts;
}

export async function runGraphifyCheck(
  rootDir: string,
  options: GraphifyCheckOptions = {}
) {
  const rebuild = options.runGraphifyRebuild ?? runGraphifyRebuild;
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "athena-graphify-check-"));

  try {
    await copyGraphifyCheckInputs(rootDir, workspaceRoot);
    await rebuild(workspaceRoot);
    const staleArtifacts = await collectStaleGraphifyArtifacts(rootDir, workspaceRoot);

    if (staleArtifacts.length === 0) {
      console.log("[graphify check] Graphify artifacts are fresh.");
      return;
    }

    throw new Error(
      [
        "[graphify check] Graphify artifacts are stale:",
        ...staleArtifacts,
        "Run `bun run graphify:rebuild` from repo root to refresh tracked graphify artifacts.",
      ].join("\n")
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  runGraphifyCheck(process.cwd()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
