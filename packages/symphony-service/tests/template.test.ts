import { describe, expect, it } from "vitest";
import { SymphonyError } from "../src/errors";
import { buildIssuePrompt, renderPromptTemplate } from "../src/template";

const input = {
  issue: {
    id: "1",
    identifier: "ATH-123",
    title: "Sample",
    state: "Todo",
  },
  attempt: null,
};

describe("renderPromptTemplate", () => {
  it("renders known variables", async () => {
    const output = await renderPromptTemplate("Issue {{ issue.identifier }}", input);
    expect(output).toBe("Issue ATH-123");
  });

  it("fails on unknown variables", async () => {
    await expect(renderPromptTemplate("{{ issue.unknown }}", input)).rejects.toMatchObject({
      code: "template_render_error",
    });
  });

  it("fails on unknown filters", async () => {
    await expect(renderPromptTemplate("{{ issue.identifier | not_a_filter }}", input)).rejects.toMatchObject({
      code: "template_parse_error",
    });
  });

  it("returns fallback prompt when template is empty", async () => {
    const output = await buildIssuePrompt("   ", input);
    expect(output).toContain("issue from Linear");
  });

  it("surfaces template errors as SymphonyError", async () => {
    try {
      await renderPromptTemplate("{{ issue.identifier | nofilter }}", input);
    } catch (error) {
      expect(error).toBeInstanceOf(SymphonyError);
    }
  });
});
