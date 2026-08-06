import fs from "fs";
import path from "path";
import type { Plugin } from "vite";

import {
  compareByDateDesc,
  deliveryReportMetaFromFile,
  solutionDocMetaFromFile,
  type DocsIndex,
} from "./src/lib/docs/parsing";

export const DOCS_INDEX_MODULE_ID = "virtual:athena-docs-index";
const RESOLVED_MODULE_ID = "\0" + DOCS_INDEX_MODULE_ID;

/** Repo-root docs content, relative to this package. */
const DOCS_ROOT = path.resolve(__dirname, "../../docs");
const SOLUTIONS_ROOT = path.join(DOCS_ROOT, "solutions");
const REPORTS_ROOT = path.join(DOCS_ROOT, "reports");

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export function buildDocsIndex(): DocsIndex {
  const solutions = safeReadDir(SOLUTIONS_ROOT)
    .filter((entry) =>
      fs.statSync(path.join(SOLUTIONS_ROOT, entry)).isDirectory(),
    )
    .flatMap((category) =>
      safeReadDir(path.join(SOLUTIONS_ROOT, category))
        .filter((file) => file.endsWith(".md"))
        .map((file) =>
          solutionDocMetaFromFile(
            category,
            file,
            fs.readFileSync(path.join(SOLUTIONS_ROOT, category, file), "utf8"),
          ),
        ),
    )
    .sort(compareByDateDesc);

  const reports = safeReadDir(REPORTS_ROOT)
    .filter((file) => file.endsWith(".html"))
    .map((file) =>
      deliveryReportMetaFromFile(
        file,
        fs.readFileSync(path.join(REPORTS_ROOT, file), "utf8"),
      ),
    )
    .sort(compareByDateDesc);

  return { solutions, reports };
}

/**
 * Serves `virtual:athena-docs-index` — metadata for every solution doc and
 * delivery report under the repo-root docs/ directory. Only metadata is
 * bundled eagerly; document bodies lazy-load through import.meta.glob in
 * src/lib/docs/content.ts.
 */
export function athenaDocsContentPlugin(): Plugin {
  return {
    name: "athena-docs-content",
    resolveId(id) {
      if (id === DOCS_INDEX_MODULE_ID) return RESOLVED_MODULE_ID;
    },
    load(id) {
      if (id !== RESOLVED_MODULE_ID) return;
      const index = buildDocsIndex();
      return `export const docsIndex = ${JSON.stringify(index)};`;
    },
    configureServer(server) {
      // New or edited docs should refresh the index without a manual restart.
      const invalidate = (file: string) => {
        if (!file.startsWith(DOCS_ROOT)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_MODULE_ID);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: "full-reload" });
        }
      };
      server.watcher.add([SOLUTIONS_ROOT, REPORTS_ROOT]);
      server.watcher.on("add", invalidate);
      server.watcher.on("change", invalidate);
      server.watcher.on("unlink", invalidate);
    },
  };
}
