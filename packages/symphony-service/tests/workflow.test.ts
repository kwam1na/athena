import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SymphonyError } from "../src/errors";
import { loadWorkflowFile, parseWorkflowContent } from "../src/workflow";

describe("parseWorkflowContent", () => {
  it("parses markdown body when front matter is absent", () => {
    const workflow = parseWorkflowContent("# Hello\n\nPrompt body");
    expect(workflow.config).toEqual({});
    expect(workflow.promptTemplate).toBe("# Hello\n\nPrompt body");
  });

  it("parses YAML front matter object", () => {
    const workflow = parseWorkflowContent(`---\ntracker:\n  kind: linear\n---\nhello {{ issue.identifier }}`);
    expect(workflow.config).toEqual({ tracker: { kind: "linear" } });
    expect(workflow.promptTemplate).toBe("hello {{ issue.identifier }}");
  });

  it("throws for non-map front matter", () => {
    expect(() => parseWorkflowContent("---\n- one\n- two\n---\nbody")).toThrowError(SymphonyError);

    try {
      parseWorkflowContent("---\n- one\n- two\n---\nbody");
    } catch (error) {
      expect(error).toBeInstanceOf(SymphonyError);
      expect((error as SymphonyError).code).toBe("workflow_front_matter_not_a_map");
    }
  });

  it("throws for malformed YAML", () => {
    expect(() => parseWorkflowContent("---\ntracker: [\n---\nbody")).toThrowError(SymphonyError);

    try {
      parseWorkflowContent("---\ntracker: [\n---\nbody");
    } catch (error) {
      expect(error).toBeInstanceOf(SymphonyError);
      expect((error as SymphonyError).code).toBe("workflow_parse_error");
    }
  });
});

describe("loadWorkflowFile", () => {
  it("throws missing_workflow_file when path does not exist", async () => {
    await expect(loadWorkflowFile("/definitely/missing/workflow.md")).rejects.toMatchObject({
      code: "missing_workflow_file",
    });
  });

  it("loads workflow from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "symphony-workflow-test-"));
    const path = join(dir, "WORKFLOW.md");
    await writeFile(path, "---\ntracker:\n  kind: linear\n---\nPrompt", "utf8");

    const workflow = await loadWorkflowFile(path);
    expect(workflow.path).toContain("WORKFLOW.md");
    expect(workflow.config).toEqual({ tracker: { kind: "linear" } });
    expect(workflow.promptTemplate).toBe("Prompt");
  });
});
