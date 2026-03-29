import { readFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import { SymphonyError } from "./errors";
import type { WorkflowConfigMap, WorkflowDocument } from "./types";

export const DEFAULT_WORKFLOW_FILE = "WORKFLOW.md";

export async function loadWorkflowFile(filePath: string): Promise<WorkflowDocument> {
  const absolutePath = resolve(filePath);

  let raw: string;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new SymphonyError("missing_workflow_file", `workflow file not found: ${absolutePath}`, {
      cause: error,
      details: { path: absolutePath },
    });
  }

  const parsed = parseWorkflowContent(raw);

  return {
    path: absolutePath,
    config: parsed.config,
    promptTemplate: parsed.promptTemplate,
  };
}

export function parseWorkflowContent(raw: string): {
  config: WorkflowConfigMap;
  promptTemplate: string;
} {
  const lines = raw.split(/\r?\n/);

  if (lines[0]?.trim() !== "---") {
    return {
      config: {},
      promptTemplate: raw.trim(),
    };
  }

  let fmEnd = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      fmEnd = i;
      break;
    }
  }

  if (fmEnd < 0) {
    throw new SymphonyError(
      "workflow_parse_error",
      "invalid workflow front matter: missing closing --- delimiter",
    );
  }

  const frontMatterRaw = lines.slice(1, fmEnd).join("\n");
  const promptBody = lines.slice(fmEnd + 1).join("\n").trim();

  const config = parseFrontMatter(frontMatterRaw);

  return {
    config,
    promptTemplate: promptBody,
  };
}

function parseFrontMatter(raw: string): WorkflowConfigMap {
  const doc = YAML.parseDocument(raw);

  if (doc.errors.length > 0) {
    const [first] = doc.errors;
    throw new SymphonyError("workflow_parse_error", `invalid workflow front matter YAML: ${first.message}`, {
      cause: first,
    });
  }

  const parsed = doc.toJS();

  if (parsed === null || parsed === undefined) {
    return {};
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SymphonyError(
      "workflow_front_matter_not_a_map",
      "workflow front matter must decode to an object/map",
    );
  }

  return parsed as WorkflowConfigMap;
}

export function watchWorkflowFile(
  workflowPath: string,
  onReloadRequested: () => void,
): FSWatcher {
  const absolutePath = resolve(workflowPath);
  const parent = dirname(absolutePath);

  return watch(parent, { persistent: true }, (_eventType, filename) => {
    if (!filename) {
      return;
    }

    if (resolve(parent, filename.toString()) === absolutePath) {
      onReloadRequested();
    }
  });
}
