import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const GRAPHIFY_REBUILD_SNIPPET =
  [
    "import os",
    "from pathlib import Path",
    "from graphify.extract import extract",
    "from graphify.build import build_from_json",
    "from graphify.cluster import cluster, score_all",
    "from graphify.analyze import god_nodes, surprising_connections, suggest_questions",
    "from graphify.report import generate",
    "from graphify.export import to_json",
    "ROOT = Path('.')",
    "EXTENSIONS = {'.py', '.js', '.ts', '.tsx', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.rb', '.cs', '.kt', '.kts', '.scala', '.php', '.swift', '.lua', '.toc', '.zig', '.ps1', '.m', '.mm'}",
    "SKIP_DIRS = {'node_modules', 'worktrees', 'graphify-out', '__pycache__', 'coverage', 'dist'}",
    "def collect_repo_files(root: Path) -> list[Path]:",
    "    results = []",
    "    for dirpath, dirnames, filenames in os.walk(root):",
    "        dp = Path(dirpath)",
    "        if any(part.startswith('.') for part in dp.parts):",
    "            dirnames[:] = []",
    "            continue",
    "        dirnames[:] = [d for d in dirnames if not d.startswith('.') and d not in SKIP_DIRS]",
    "        for fname in filenames:",
    "            if fname.startswith('.'):",
    "                continue",
    "            file_path = dp / fname",
    "            if any(part in SKIP_DIRS for part in file_path.parts):",
    "                continue",
    "            if file_path.suffix in EXTENSIONS:",
    "                results.append(file_path)",
    "    return sorted(results)",
    "code_files = collect_repo_files(ROOT)",
    "if not code_files:",
    "    raise SystemExit('[graphify rebuild] No code files found - nothing to rebuild.')",
    "result = extract(code_files)",
    "detection = {'files': {'code': [str(f) for f in code_files], 'document': [], 'paper': [], 'image': []}, 'total_files': len(code_files), 'total_words': 0}",
    "graph = build_from_json(result)",
    "communities = cluster(graph)",
    "cohesion = score_all(graph, communities)",
    "gods = god_nodes(graph)",
    "surprises = surprising_connections(graph, communities)",
    "labels = {cid: 'Community ' + str(cid) for cid in communities}",
    "questions = suggest_questions(graph, communities, labels)",
    "out = ROOT / 'graphify-out'",
    "out.mkdir(exist_ok=True)",
    "report = generate(graph, communities, cohesion, labels, gods, surprises, detection, {'input': 0, 'output': 0}, str(ROOT), suggested_questions=questions)",
    "normalized_report = '\\n'.join(line.rstrip() for line in report.splitlines())",
    "if report.endswith('\\n'):",
    "    normalized_report += '\\n'",
    "(out / 'GRAPH_REPORT.md').write_text(normalized_report)",
    "to_json(graph, communities, str(out / 'graph.json'))",
    "flag = out / 'needs_update'",
    "if flag.exists():",
    "    flag.unlink()",
    "print(f'[graphify rebuild] Rebuilt: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges, {len(communities)} communities')",
    "print(f'[graphify rebuild] graph.json and GRAPH_REPORT.md updated in {out}')",
  ].join("\n");

type SpawnedProcess = {
  exited: Promise<number>;
  stderr?: ReadableStream | null;
};

type GraphifyRebuildOptions = {
  spawn?: (command: string[], options: { cwd: string }) => SpawnedProcess;
};

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveGraphifyPython(rootDir: string) {
  const configuredPythonPath = path.join(rootDir, ".graphify_python");
  if (!(await fileExists(configuredPythonPath))) {
    return "python3";
  }

  const configuredPython = (await readFile(configuredPythonPath, "utf8")).trim();
  return configuredPython || "python3";
}

export async function runGraphifyRebuild(
  rootDir: string,
  options: GraphifyRebuildOptions = {}
) {
  const graphifyPython = await resolveGraphifyPython(rootDir);
  const command = [graphifyPython, "-c", GRAPHIFY_REBUILD_SNIPPET];
  const subprocess =
    options.spawn?.(command, { cwd: rootDir }) ??
    Bun.spawn(command, {
      cwd: rootDir,
      stdout: "inherit",
      stderr: "pipe",
    });
  const exitCode = await subprocess.exited;

  if (exitCode === 0) {
    return;
  }

  const stderr = subprocess.stderr
    ? (await new Response(subprocess.stderr).text()).trim()
    : "";
  throw new Error(
    stderr || `Graphify rebuild failed (${exitCode}): ${command.join(" ")}`
  );
}

if (import.meta.main) {
  await runGraphifyRebuild(process.cwd());
}
