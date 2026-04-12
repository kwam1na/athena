import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { HARNESS_APP_REGISTRY, PACKAGES_AGENTS_PATH } from "./harness-app-registry";

const GRAPHIFY_OUTPUT_DIR = "graphify-out";
const GRAPHIFY_WIKI_DIR = path.posix.join(GRAPHIFY_OUTPUT_DIR, "wiki");
const GRAPHIFY_REPORT_PATH = path.posix.join(GRAPHIFY_OUTPUT_DIR, "GRAPH_REPORT.md");
const GRAPHIFY_HTML_PATH = path.posix.join(GRAPHIFY_OUTPUT_DIR, "graph.html");
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
const SKIP_DIRS = new Set([
  "node_modules",
  "worktrees",
  "graphify-out",
  "__pycache__",
  "coverage",
  "dist",
]);

type GraphifyNode = {
  label: string;
  file_type?: string;
  source_file: string;
  source_location?: string;
  id: string;
  community?: number;
};

type GraphifyLink = {
  source: string;
  target: string;
};

type GraphifyGraph = {
  nodes: GraphifyNode[];
  links: GraphifyLink[];
};

type GraphifyWikiPage = {
  path: string;
  contents: string;
};

export const GRAPHIFY_WIKI_ARTIFACTS = [
  path.posix.join(GRAPHIFY_WIKI_DIR, "index.md"),
  ...HARNESS_APP_REGISTRY.map((entry) =>
    path.posix.join(GRAPHIFY_WIKI_DIR, "packages", `${entry.appName}.md`)
  ),
] as const;

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
    const entries = await readDir(currentAbsoluteDir);

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

  return files.sort((left, right) => left.localeCompare(right));
}

async function readDir(dirPath: string) {
  const { readdir } = await import("node:fs/promises");
  return readdir(dirPath, { withFileTypes: true });
}

function normalizeRepoPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function toMarkdownLink(pagePath: string, targetPath: string, label?: string) {
  const relativePath = path.posix.relative(
    path.posix.dirname(pagePath),
    targetPath
  );
  return `[${label ?? targetPath}](${relativePath})`;
}

function toSourceLink(pagePath: string, sourceFile: string) {
  const relativePath = path.posix.relative(path.posix.dirname(pagePath), sourceFile);
  return `[\`${sourceFile}\`](${relativePath})`;
}

function formatList(lines: string[]) {
  return lines.join("\n");
}

function countCommunities(nodes: GraphifyNode[]) {
  return new Set(nodes.map((node) => node.community)).size;
}

function buildDegreeIndex(links: GraphifyLink[]) {
  const degreeByNodeId = new Map<string, number>();

  for (const link of links) {
    degreeByNodeId.set(link.source, (degreeByNodeId.get(link.source) ?? 0) + 1);
    degreeByNodeId.set(link.target, (degreeByNodeId.get(link.target) ?? 0) + 1);
  }

  return degreeByNodeId;
}

function scoreNode(
  node: GraphifyNode,
  degreeByNodeId: Map<string, number>
): number {
  return degreeByNodeId.get(node.id) ?? 0;
}

function compareHotspots(
  left: GraphifyNode,
  right: GraphifyNode,
  degreeByNodeId: Map<string, number>
) {
  const leftDegree = scoreNode(left, degreeByNodeId);
  const rightDegree = scoreNode(right, degreeByNodeId);

  if (leftDegree !== rightDegree) {
    return rightDegree - leftDegree;
  }

  const labelComparison = left.label.localeCompare(right.label);
  if (labelComparison !== 0) {
    return labelComparison;
  }

  return left.source_file.localeCompare(right.source_file);
}

function buildHotspotLines(
  pagePath: string,
  nodes: GraphifyNode[],
  degreeByNodeId: Map<string, number>,
  limit: number
) {
  const hotspots = [...nodes]
    .sort((left, right) => compareHotspots(left, right, degreeByNodeId))
    .slice(0, limit);

  if (hotspots.length === 0) {
    return ["- No graph hotspots were found for this scope."];
  }

  return hotspots.map((node) => {
    const degree = scoreNode(node, degreeByNodeId);
    const sourceLink = toSourceLink(pagePath, normalizeRepoPath(node.source_file));
    const community = node.community === undefined ? "unknown" : `Community ${node.community}`;

    return `- \`${node.label}\` (${degree} edge${degree === 1 ? "" : "s"}, ${community}) - ${sourceLink}`;
  });
}

async function loadGraphifyGraph(rootDir: string) {
  const graphPath = path.join(rootDir, GRAPHIFY_OUTPUT_DIR, "graph.json");
  if (!(await fileExists(graphPath))) {
    throw new Error(
      `Missing graphify graph output: ${path.posix.join(
        GRAPHIFY_OUTPUT_DIR,
        "graph.json"
      )}`
    );
  }

  return JSON.parse(await readFile(graphPath, "utf8")) as GraphifyGraph;
}

function buildRootIndexPage(params: {
  rootDir: string;
  graph: GraphifyGraph;
  codeFileCount: number;
  degreeByNodeId: Map<string, number>;
}) {
  const pagePath = path.posix.join(GRAPHIFY_WIKI_DIR, "index.md");
  const lines = [
    "# Graphify Wiki",
    "",
    "Graphify is the navigation layer for the repo graph. Use the entry docs below for operational rules and validation, and open `graphify-out/GRAPH_REPORT.md` for deeper analysis.",
    "",
    "## Entry Docs",
    `- ${toMarkdownLink(pagePath, "AGENTS.md", "AGENTS.md")} - repo-wide workflow, guardrails, and graphify usage rules`,
    `- ${toMarkdownLink(pagePath, "packages/AGENTS.md", "packages/AGENTS.md")} - package router plus the operational guides for each harnessed package`,
    "",
    "## Repo Summary",
    `- Code files discovered: ${params.codeFileCount}`,
    `- Graph nodes: ${params.graph.nodes.length}`,
    `- Graph edges: ${params.graph.links.length}`,
    `- Communities: ${countCommunities(params.graph.nodes)}`,
    "",
    "## Graph Hotspots",
    ...buildHotspotLines(pagePath, params.graph.nodes, params.degreeByNodeId, 8),
    "",
    "## Registered Packages",
    ...HARNESS_APP_REGISTRY.map((entry) => {
      const packagePagePath = path.posix.join(
        GRAPHIFY_WIKI_DIR,
        "packages",
        `${entry.appName}.md`
      );
      const link = toMarkdownLink(pagePath, packagePagePath, entry.label);

      return `- ${link}`;
    }),
    "",
    "## Deep Dives",
    `- ${toMarkdownLink(pagePath, GRAPHIFY_REPORT_PATH, "GRAPH_REPORT.md")} - canonical graph report`,
    `- ${toMarkdownLink(pagePath, GRAPHIFY_HTML_PATH, "graph.html")} - interactive graph view`,
  ];

  return formatList(lines);
}

function buildPackagePage(params: {
  packageEntry: (typeof HARNESS_APP_REGISTRY)[number];
  graph: GraphifyGraph;
  degreeByNodeId: Map<string, number>;
}) {
  const pagePath = path.posix.join(
    GRAPHIFY_WIKI_DIR,
    "packages",
    `${params.packageEntry.appName}.md`
  );
  const packageNodes = params.graph.nodes.filter((node) =>
    normalizeRepoPath(node.source_file).startsWith(`${params.packageEntry.packageDir}/`)
  );

  const lines = [
    `# ${params.packageEntry.label}`,
    "",
    `Landing page for ${params.packageEntry.packageDir}. Use this page to orient around graph hotspots, then switch to the package entry docs for operational rules and validation.`,
    "",
    "## Package Docs",
    `- ${toMarkdownLink(
      pagePath,
      normalizeRepoPath(params.packageEntry.harnessDocs.agentsPath),
      "AGENTS.md"
    )}`,
    `- ${toMarkdownLink(
      pagePath,
      normalizeRepoPath(params.packageEntry.harnessDocs.indexPath),
      "index.md"
    )}`,
    `- ${toMarkdownLink(
      pagePath,
      normalizeRepoPath(params.packageEntry.harnessDocs.architecturePath),
      "architecture.md"
    )}`,
    `- ${toMarkdownLink(
      pagePath,
      normalizeRepoPath(params.packageEntry.harnessDocs.testingPath),
      "testing.md"
    )}`,
    `- ${toMarkdownLink(
      pagePath,
      normalizeRepoPath(params.packageEntry.harnessDocs.codeMapPath),
      "code-map.md"
    )}`,
    "",
    "## Generated Harness Docs",
    ...params.packageEntry.harnessDocs.generatedDocs.map((docPath) =>
      `- ${toMarkdownLink(pagePath, normalizeRepoPath(docPath), path.posix.basename(docPath))}`
    ),
    "",
    "## Graph Hotspots",
    ...buildHotspotLines(pagePath, packageNodes, params.degreeByNodeId, 5),
    "",
    "## Navigation",
    `- ${toMarkdownLink(
      pagePath,
      path.posix.join(GRAPHIFY_WIKI_DIR, "index.md"),
      "wiki index"
    )} - back to the wiki index`,
    `- ${toMarkdownLink(pagePath, PACKAGES_AGENTS_PATH, "packages/AGENTS.md")} - package router and operational guide entrypoint`,
    `- ${toMarkdownLink(pagePath, GRAPHIFY_REPORT_PATH, "GRAPH_REPORT.md")} - full graph report`,
  ];

  return formatList(lines);
}

export async function generateGraphifyWikiPages(rootDir: string) {
  const [graph, codeFiles] = await Promise.all([
    loadGraphifyGraph(rootDir),
    collectRepoCodeFiles(rootDir),
  ]);
  const degreeByNodeId = buildDegreeIndex(graph.links);
  const pages = new Map<string, string>();

  pages.set(
    path.posix.join(GRAPHIFY_WIKI_DIR, "index.md"),
    buildRootIndexPage({
      rootDir,
      graph,
      codeFileCount: codeFiles.length,
      degreeByNodeId,
    })
  );

  for (const packageEntry of HARNESS_APP_REGISTRY) {
    pages.set(
      path.posix.join(GRAPHIFY_WIKI_DIR, "packages", `${packageEntry.appName}.md`),
      buildPackagePage({
        packageEntry,
        graph,
        degreeByNodeId,
      })
    );
  }

  return pages;
}

export async function writeGraphifyWikiPages(rootDir: string) {
  const wikiDir = path.join(rootDir, GRAPHIFY_WIKI_DIR);
  await rm(wikiDir, { recursive: true, force: true });
  const pages = await generateGraphifyWikiPages(rootDir);

  for (const [relativePath, contents] of pages) {
    const filePath = path.join(rootDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents.endsWith("\n") ? contents : `${contents}\n`);
  }
}
